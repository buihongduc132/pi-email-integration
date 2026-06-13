/**
 * Process-exit safety net (AC#3 / THE-716 / THE-703 / THE-712).
 *
 * Non-daemon modes (`pi -p` print, `--mode json`) run a single prompt and
 * should exit when the agent is done. If ANY ref'd libuv handle (TCP socket,
 * timer, epoll, io_uring, fs.watch/chokidar, MCP/extension handle) strands
 * the event loop past `agent_end` + `session_shutdown`, the pi process
 * accumulates as a zombie and triggers false "silent active run" alerts,
 * wasting triage budget across the portfolio.
 *
 * `scheduleForceExitIfNonDaemon()` arms a backup force-exit timer. The timer
 * is **unref'd** — it only fires if some OTHER ref'd handle keeps the loop
 * alive past the grace period. When no leak exists, the loop drains
 * immediately and the timer never fires (the desired behavior). When a leak
 * exists, the timer fires and force-exits the process so a single misbehaving
 * extension can never strand the runtime.
 *
 * Gating (all must hold to arm):
 *   - `isNonDaemon === true` — caller has already determined this is a
 *     single-shot non-daemon run (print/json). Interactive TUI and long-lived
 *     RPC daemon modes must NEVER arm.
 *   - `reason === "quit"` — final process teardown only. Session replacement
 *     (`new`/`reload`/`fork`/`resume`) reuses the same Node loop and must NOT
 *     be force-exited.
 *   - `PI_FORCE_EXIT_DISABLE !== "1"` — escape hatch for debugging.
 */

/** Grace period (ms) before the force-exit fires, letting legitimate
 * session_shutdown cleanup (db.close, bus.close) complete first. */
export const FORCE_EXIT_GRACE_MS = 4000;

/**
 * Arm the force-exit safety net if the session is a non-daemon final-teardown.
 *
 * @param isNonDaemon true if the run is a single-shot non-daemon mode (print/json).
 * @param reason `session_shutdown` reason (`"quit" | "new" | "reload" | "fork" | "resume"`).
 * @returns the armed timer (for test inspection), or `null` if not armed.
 */
export function scheduleForceExitIfNonDaemon(
  isNonDaemon: boolean,
  reason: string,
): NodeJS.Timeout | null {
  if (!isNonDaemon) return null;
  if (reason !== "quit") return null;
  if (process.env.PI_FORCE_EXIT_DISABLE === "1") return null;

  const timer = setTimeout(() => {
    try {
      process.stderr.write(
        `[pi-email-integration] force-exit safety net triggered ${FORCE_EXIT_GRACE_MS}ms after session_shutdown. Stray ref'd handle detected — forcing exit(0).\n`,
      );
    } catch {
      // stderr write failed — still exit.
    }
    process.exit(0);
  }, FORCE_EXIT_GRACE_MS);

  // CRITICAL: unref the safety-net timer. If we left it ref'd, it would keep
  // the loop alive on its own for the grace period even when no leak exists —
  // defeating the "drain immediately when clean" behavior. Unref'd, the timer
  // ONLY fires when some OTHER ref'd handle (the leak) holds the loop open
  // past the grace period.
  timer.unref();

  return timer;
}
