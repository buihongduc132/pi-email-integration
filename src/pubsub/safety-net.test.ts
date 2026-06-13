/**
 * Unit tests — process-exit safety net (AC#3 / THE-716)
 *
 * The integration test (tests/integration/process-exit-safety-net.test.ts)
 * proves the END-TO-END invariant against a real Node child: the process
 * must force-exit within the grace period when a stray ref'd handle keeps
 * the loop alive. These unit tests cover the gating logic itself — which
 * (isNonDaemon, reason, env) combinations arm the safety net and which do
 * not — without spawning child processes.
 *
 * Because the safety net calls `process.exit`, we never let it actually fire
 * here: we only assert whether `scheduleForceExitIfNonDaemon()` returned a
 * timer (armed) or `null` (not armed), and immediately clear any armed timer.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  scheduleForceExitIfNonDaemon,
  FORCE_EXIT_GRACE_MS,
} from "./safety-net.js";

describe("scheduleForceExitIfNonDaemon — gating logic (THE-716)", () => {
  const armedTimers: NodeJS.Timeout[] = [];

  afterEach(() => {
    // Never let a unit test actually force-exit the runner.
    for (const t of armedTimers) clearTimeout(t);
    armedTimers.length = 0;
    delete process.env.PI_FORCE_EXIT_DISABLE;
  });

  function arm(isNonDaemon: boolean, reason: string): NodeJS.Timeout | null {
    const t = scheduleForceExitIfNonDaemon(isNonDaemon, reason);
    if (t) armedTimers.push(t);
    return t;
  }

  it("arms when isNonDaemon=true and reason=quit", () => {
    expect(arm(true, "quit")).not.toBeNull();
  });

  it("does NOT arm when isNonDaemon=false (interactive/rpc daemon must stay alive)", () => {
    expect(arm(false, "quit")).toBeNull();
  });

  it("does NOT arm on session replacement reasons", () => {
    for (const reason of ["new", "reload", "fork", "resume"] as const) {
      expect(arm(true, reason)).toBeNull();
    }
  });

  it("does NOT arm when PI_FORCE_EXIT_DISABLE=1 (escape hatch)", () => {
    process.env.PI_FORCE_EXIT_DISABLE = "1";
    expect(arm(true, "quit")).toBeNull();
  });

  it("arms when PI_FORCE_EXIT_DISABLE is unset or any other value", () => {
    delete process.env.PI_FORCE_EXIT_DISABLE;
    expect(arm(true, "quit")).not.toBeNull();
    process.env.PI_FORCE_EXIT_DISABLE = "0";
    expect(arm(true, "quit")).not.toBeNull();
  });

  it("exports the documented grace period", () => {
    expect(FORCE_EXIT_GRACE_MS).toBe(4000);
  });
});
