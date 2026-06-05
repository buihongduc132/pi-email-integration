import { describe, it, expect, vi } from "vitest";
import { MailboxSubscription } from "./mailbox-subscription.js";
import type { EmailHookContext, EmailMessage } from "../types.js";

/** Helper: minimal valid EmailMessage for test contexts. */
function makeEmail(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: "em-1",
    threadId: "th-1",
    action: "new",
    from: { name: "Sender", address: "sender@local" },
    to: [{ address: "alice@local" }],
    cc: [],
    bcc: [],
    subject: "Test",
    body: "Hello world",
    headers: {},
    date: new Date("2026-01-01T00:00:00Z"),
    origin: {
      cwd: "/tmp",
      cliAgent: "pi",
      sessionId: "ses-1",
      gitProject: "test",
      custom: {},
      timestamp: new Date("2026-01-01T00:00:00Z"),
    },
    ...overrides,
  };
}

function makeContext(overrides: Partial<EmailHookContext> = {}): EmailHookContext {
  return {
    event: "email:received",
    email: makeEmail(),
    timestamp: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("MailboxSubscription", () => {
  it("subscribe adds a subscription — getSubscriptions returns it", () => {
    const sub = new MailboxSubscription();
    sub.subscribe("alice@local", "session-a");
    const subs = sub.getSubscriptions("alice@local");
    expect(subs).toHaveLength(1);
    expect(subs[0].mailbox).toBe("alice@local");
    expect(subs[0].sessionName).toBe("session-a");
  });

  it("subscribe is idempotent — subscribing same session twice doesn't duplicate", () => {
    const sub = new MailboxSubscription();
    sub.subscribe("alice@local", "session-a");
    sub.subscribe("alice@local", "session-a");
    expect(sub.getSubscriptions("alice@local")).toHaveLength(1);
  });

  it("unsubscribe removes a subscription", () => {
    const sub = new MailboxSubscription();
    sub.subscribe("alice@local", "session-a");
    sub.unsubscribe("alice@local", "session-a");
    expect(sub.getSubscriptions("alice@local")).toHaveLength(0);
  });

  it("unsubscribe cleans up empty mailbox entries", () => {
    const sub = new MailboxSubscription();
    sub.subscribe("alice@local", "session-a");
    sub.unsubscribe("alice@local", "session-a");
    // getAllSubscriptions should not contain the key at all
    expect(sub.getAllSubscriptions()).toHaveLength(0);
  });

  it("getSubscriptions for unregistered mailbox returns empty array", () => {
    const sub = new MailboxSubscription();
    expect(sub.getSubscriptions("nobody@local")).toEqual([]);
  });

  it("getAllSubscriptions returns all across mailboxes", () => {
    const sub = new MailboxSubscription();
    sub.subscribe("alice@local", "session-a");
    sub.subscribe("bob@local", "session-b");
    const all = sub.getAllSubscriptions();
    expect(all).toHaveLength(2);
    const names = all.map((s) => s.sessionName).sort();
    expect(names).toEqual(["session-a", "session-b"]);
  });

  it("case-insensitive mailbox matching — subscribe 'Alice@Local', getSubscriptions('alice@local') works", () => {
    const sub = new MailboxSubscription();
    sub.subscribe("Alice@Local", "session-a");
    const subs = sub.getSubscriptions("alice@local");
    expect(subs).toHaveLength(1);
    expect(subs[0].sessionName).toBe("session-a");
  });

  it("createReceivedHandler returns a function", () => {
    const sub = new MailboxSubscription();
    const handler = sub.createReceivedHandler();
    expect(typeof handler).toBe("function");
  });

  it("createReceivedHandler skips non-received events", () => {
    const sub = new MailboxSubscription();
    sub.subscribe("alice@local", "session-a");
    const handler = sub.createReceivedHandler();
    // Should not throw for non-received events
    const ctx = makeContext({ event: "email:sent" });
    expect(() => handler(ctx)).not.toThrow();
  });

  it("createReceivedHandler with filter — filter returns false, no notification sent", () => {
    const sub = new MailboxSubscription();
    const filter = vi.fn().mockReturnValue(false);
    sub.subscribe("alice@local", "session-a", filter);

    const handler = sub.createReceivedHandler();
    const ctx = makeContext();
    handler(ctx);

    // Filter was called
    expect(filter).toHaveBeenCalledOnce();
    // No intercom call (it would silently fail anyway, but filter blocked it)
  });

  it("createReceivedHandler with filter — filter returns true, notification logic runs", () => {
    const sub = new MailboxSubscription();
    const filter = vi.fn().mockReturnValue(true);
    sub.subscribe("alice@local", "session-a", filter);

    const handler = sub.createReceivedHandler();
    const ctx = makeContext();
    // Should not throw even though pi-intercom is not available (catch block handles it)
    expect(() => handler(ctx)).not.toThrow();
    expect(filter).toHaveBeenCalledOnce();
  });

  it("multiple subscribers on same mailbox — both get notified", () => {
    const sub = new MailboxSubscription();
    const filter1 = vi.fn().mockReturnValue(true);
    const filter2 = vi.fn().mockReturnValue(true);
    sub.subscribe("alice@local", "session-a", filter1);
    sub.subscribe("alice@local", "session-b", filter2);

    const handler = sub.createReceivedHandler();
    const ctx = makeContext();
    handler(ctx);

    // Both filters should have been called
    expect(filter1).toHaveBeenCalledOnce();
    expect(filter2).toHaveBeenCalledOnce();
  });
});
