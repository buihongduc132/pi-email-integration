/**
 * Regression test — THE-703: bus must not strand the pi process after session end.
 *
 * Worst-first coverage: this test is the most valuable because it's the one that
 * would have caught the original defect. Without the `stream.unref()` fix, the
 * child process stays alive past the timeout (exit 124 from `timeout` wrapper)
 * and the test fails. With the fix, the child drains naturally after the keepalive
 * timer is cleared — simulating what `agent_end` + `session_shutdown` do in pi.
 *
 * Mechanism:
 *   1. Spawn a real Node child importing `src/pubsub/bus.ts` (not a mock).
 *   2. The child opens a Redis connection via publish, then releases a ref'd
 *      setInterval "keepalive" to simulate pi's agent loop releasing control.
 *   3. The child is expected to exit within ~3s with code 0.
 *   4. If ioredis' socket still holds a ref, the child stays alive → timeout.
 *
 * Requires local Redis reachable at the default bus URL (localhost:6379) —
 * same assumption the existing bus tests rely on. When Redis is unreachable
 * the child can't publish and the test skips with a clear message instead of
 * passing spuriously.
 */

import { describe, it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Child script ───────────────────────────────────────────────

const CHILD_SCRIPT = `
import { createMessageBus } from "./src/pubsub/bus.ts";
const t0 = Date.now();
const log = (m) => process.stdout.write("[" + (Date.now()-t0) + "ms] " + m + "\\n");

// Active-session keepalive: a ref'd setInterval so the event loop stays busy
// during the bus publish (mimics pi's agent loop holding control).
let keepalive = setInterval(() => {}, 100);

(async () => {
  log("session-start");
  const bus = createMessageBus({ url: "redis://localhost:6379" });
  const r = await bus.publish("email:inbox:regression@local", {
    type: "email:received",
    messageId: "m1",
    subject: "s",
    from: "f",
    body: "b",
    origin: {},
  });
  log("PUBLISHED success=" + r.success);
  if (!r.success) {
    // Can't reach Redis — the test is meaningless (unref only matters with a
    // live connection). Surface the failure so the parent test can skip.
    process.exit(2);
  }
  // Release the session keepalive after a brief window to let the connection
  // fully settle. If unref is working, the process now drains.
  setTimeout(() => {
    log("session-shutdown — releasing keepalive");
    clearInterval(keepalive);
    keepalive = null;
  }, 200);
})();
process.on("exit", (c) => log("EXIT code=" + c));
`;

// ─── Test ───────────────────────────────────────────────────────

describe("bus.ts — process-exit safety (THE-703)", () => {
  it("must not strand the process with a ref'd Redis socket after session end", async () => {
    // Materialize the child script as a .ts file in the project root so
    // `./src/pubsub/bus.ts` resolves via the TypeScript import.
    const scriptPath = join(process.cwd(), "__the703_child__.ts");
    writeFileSync(scriptPath, CHILD_SCRIPT);

    try {
      const child = await spawnChild(scriptPath, 4000);

      if (child.exitCode === 2) {
        // Redis unreachable — skip rather than pass/fail spuriously.
        // Vitest doesn't have a first-class skip-in-test hook we can reliably
        // call here; we fail with a diagnostic message. The existing bus
        // tests cover the Redis-down branch.
        expect.fail(
          "Child reported Redis unreachable — test requires redis at localhost:6379 to be meaningful.",
        );
      }

      expect(child.exitCode).toBe(0);
      expect(child.stdout).toContain("PUBLISHED success=true");
      expect(child.stdout).toContain("session-shutdown");
      expect(child.stdout).toContain("EXIT code=0");
    } finally {
      try {
        unlinkSync(scriptPath);
      } catch {
        // Best-effort cleanup.
      }
    }
  }, 10000); // Generous timeout: spawn + publish + drain + buffer
});

// ─── Helpers ─────────────────────────────────────────────────────

function spawnChild(
  scriptPath: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn(
      "node",
      ["--experimental-strip-types", "--no-warnings", scriptPath],
      {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: process.cwd(),
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });

    let done = false;
    const finish = (exitCode: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    };

    child.once("exit", (code) => {
      finish(code ?? -1);
    });
    child.once("error", (err) => {
      // eslint-disable-next-line no-console
      console.error("child error:", err.message);
      finish(-1);
    });

    const timer = setTimeout(() => {
      // Stranded → kill with SIGTERM; the test treats any non-zero code as a
      // failure of the leak-prevention invariant.
      try {
        child.kill("SIGTERM");
      } catch {
        // Already gone — ignore.
      }
    }, timeoutMs);
  });
}
