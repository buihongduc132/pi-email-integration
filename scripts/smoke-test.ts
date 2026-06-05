/**
 * Smoke test — verifies the package loads without pi runtime.
 */

import { LocalEmailProvider } from "../src/providers/local-provider.ts";
import { OriginTracker } from "../src/origin/tracker.ts";
import { RoutingEngine } from "../src/hooks/routing-engine.ts";
import { HookManager } from "../src/hooks/hook-manager.ts";

const passed: string[] = [];
const failed: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed.push(label);
  } else {
    failed.push(label);
    console.error(`  FAIL: ${label}`);
  }
}

// ─── LocalEmailProvider ────────────────────────────────────────
{
  const provider = new LocalEmailProvider();
  assert(provider.name === "local", "provider name is 'local'");

  const sendResult = await provider.send({
    id: "test-1",
    from: { address: "agent@local" },
    to: [{ address: "user@local" }],
    subject: "Test",
    body: "Hello",
    headers: {},
    date: new Date(),
    origin: { cwd: "/test", cliAgent: "pi", custom: {}, timestamp: new Date() },
  });
  assert(sendResult.success === true, "send succeeds");
  assert(sendResult.messageId === "test-1", "send returns message ID");

  const emails = await provider.read({ to: "user@local" });
  assert(emails.length === 1, "read returns sent email");
  assert(emails[0].subject === "Test", "read email has correct subject");

  const health = await provider.health();
  assert(health.ok === true, "health check passes");
}

// ─── OriginTracker ─────────────────────────────────────────────
{
  const tracker = new OriginTracker({ defaultAgent: "test-agent" });
  const origin = tracker.capture();
  assert(origin.cwd === process.cwd(), "origin captures cwd");
  assert(origin.cliAgent === "test-agent", "origin uses default agent");
  assert(origin.timestamp instanceof Date, "origin has timestamp");

  const withOverrides = tracker.capture({ cwd: "/custom", custom: { foo: "bar" } });
  assert(withOverrides.cwd === "/custom", "origin accepts cwd override");
  assert((withOverrides.custom as Record<string, string>).foo === "bar", "origin merges custom fields");
}

// ─── RoutingEngine ─────────────────────────────────────────────
{
  const engine = new RoutingEngine({
    enabled: true,
    rules: [
      {
        id: "test-rule",
        condition: (o) => o.cwd.includes("project-x"),
        targetBank: "project-x-bank",
        tags: ["project-x"],
        priority: 10,
      },
    ],
    defaultBank: "default-bank",
  });

  assert(engine.isEnabled, "routing engine is enabled");

  const matched = engine.route({ cwd: "/home/user/project-x/src", cliAgent: "pi", custom: {}, timestamp: new Date() });
  assert(matched.routed === true, "rule matches on cwd pattern");
  assert(matched.bank === "project-x-bank", "matched rule returns correct bank");
  assert(matched.tags.includes("project-x"), "matched rule applies tags");

  const unmatched = engine.route({ cwd: "/home/user/other", cliAgent: "pi", custom: {}, timestamp: new Date() });
  assert(unmatched.bank === "default-bank", "unmatched falls back to default bank");
}

// ─── HookManager ───────────────────────────────────────────────
{
  const manager = new HookManager();
  let fired = false;
  manager.on("email:sent", () => { fired = true; });
  await manager.fire({ event: "email:sent", email: {} as any, timestamp: new Date() });
  assert(fired === true, "hook fires on event");
}

// ─── Summary ───────────────────────────────────────────────────
console.log(`\nSmoke test: ${passed.length} passed, ${failed.length} failed`);
if (failed.length > 0) {
  process.exit(1);
}
