/**
 * Integration test — process-exit safety net (AC#3 / THE-716)
 *
 * Spawns a real Node child that simulates a stranded pi process:
 *   1. isNonDaemon=true + reason=quit → safety net armed
 *   2. Stray ref'd setInterval keeps the loop alive forever (simulates leak)
 *   3. Process MUST force-exit within FORCE_EXIT_GRACE_MS + buffer
 *
 * Without the safety net, the process strands indefinitely → timeout kill.
 * With the safety net, it force-exits at the grace period → passes (exit 0).
 *
 * Also verifies the negative cases:
 *   - isNonDaemon=false does NOT force-exit (interactive/rpc must stay alive)
 *   - session replacement reason does NOT force-exit
 */

import { describe, it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { FORCE_EXIT_GRACE_MS } from "../../src/pubsub/safety-net.js";

// ─── Child script ───────────────────────────────────────────────
// Reads isNonDaemon + reason from argv, arms the safety net, then installs a
// ref'd setInterval that strands the event loop (simulating the leak). When
// armed, the safety net force-exits at FORCE_EXIT_GRACE_MS. When not armed,
// the child strands until the parent SIGTERMs it.

const CHILD_SCRIPT = `
import { scheduleForceExitIfNonDaemon, FORCE_EXIT_GRACE_MS } from "./src/pubsub/safety-net.ts";

const isNonDaemon = process.argv[2] === "true";
const reason = process.argv[3] ?? "quit";

console.log("child-starting isNonDaemon=" + isNonDaemon + " reason=" + reason);

const timer = scheduleForceExitIfNonDaemon(isNonDaemon, reason);
console.log("safety-net-armed=" + (timer !== null));

// Simulate a stray ref'd handle that strands the process (the bug THE-716 fixes).
setInterval(() => {}, 1000);

process.on("exit", (code) => {
  console.log("child-exit code=" + code);
});
`;

interface ChildResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  killedByTimeout: boolean;
}

function spawnChild(args: string[], timeoutMs: number): Promise<ChildResult> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn(
      "node",
      ["--experimental-strip-types", "--no-warnings", CHILD_SCRIPT_PATH, ...args],
      { stdio: ["ignore", "pipe", "pipe"], cwd: process.cwd() },
    );

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));

    let done = false;
    let killedByTimeout = false;
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr, killedByTimeout });
    };

    child.once("exit", (code, sig) => finish(code, sig));
    child.once("error", (err) => {
      console.error("child error:", err.message); // eslint-disable-line no-console
      finish(-1, null);
    });

    const timer = setTimeout(() => {
      // Stranded → kill with SIGTERM.
      killedByTimeout = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // Already gone.
      }
    }, timeoutMs);
  });
}

// Materialize the child script as a .ts file so `./src/pubsub/safety-net.ts`
// resolves via the TypeScript import (same pattern as bus-process-exit.test.ts).
const CHILD_SCRIPT_PATH = join(process.cwd(), "__the716_child__.ts");

describe("process-exit safety net — integration (THE-716)", () => {
  beforeEach_();

  it("force-exits when armed (isNonDaemon=true + reason=quit) and a ref'd handle strands the process", async () => {
    // Grace period + buffer for process startup + exit signal propagation.
    const timeoutMs = FORCE_EXIT_GRACE_MS + 1500;
    const child = await spawnChild(["true", "quit"], timeoutMs);

    expect(child.stdout).toContain("safety-net-armed=true");
    expect(child.exitCode).toBe(0);
    expect(child.killedByTimeout).toBe(false);
    expect(child.stderr).toContain("force-exit safety net triggered");
  }, FORCE_EXIT_GRACE_MS + 2500);

  it("does NOT force-exit when not armed (isNonDaemon=false: interactive/rpc must stay alive)", async () => {
    // Kill at 2s. Correct behavior: NOT armed → stranded → SIGTERM'd by us.
    const child = await spawnChild(["false", "quit"], 2000);

    expect(child.stdout).toContain("safety-net-armed=false");
    expect(child.killedByTimeout).toBe(true);
    expect(child.signal).toBe("SIGTERM");
    expect(child.exitCode).toBeNull();
  }, 3000);

  it("does NOT force-exit on session replacement reasons (reason=new/reload/fork/resume)", async () => {
    // Session replacement reuses the Node loop — force-exit would kill the
    // new session. Verify the safety net does NOT arm on any replacement reason.
    for (const reason of ["new", "reload", "fork", "resume"]) {
      const child = await spawnChild(["true", reason], 2000);
      expect(child.stdout).toContain("safety-net-armed=false");
      expect(child.killedByTimeout).toBe(true);
      expect(child.signal).toBe("SIGTERM");
      expect(child.exitCode).toBeNull();
    }
  }, 12000);
});

// Write the child script before tests run; clean up after. (Vitest runs
// `describe` body synchronously at load time, so we materialize the file
// immediately and unlink it via process exit. The helper is invoked once
// inside the describe block above.)
function beforeEach_(): void {
  writeFileSync(CHILD_SCRIPT_PATH, CHILD_SCRIPT);
  process.on("exit", () => {
    try {
      unlinkSync(CHILD_SCRIPT_PATH);
    } catch {
      // Best-effort.
    }
  });
}
