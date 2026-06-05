/**
 * Mailbox Subscription Tests — Bus-based delivery (S5 rewrite).
 *
 * Covers: subscribe, unsubscribe, bus publish on received,
 * bus handler → pi-inject pipeline, filter support, graceful degradation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MailboxSubscription } from "./mailbox-subscription.js";
import type { EmailHookContext, EmailMessage } from "../types.js";
import type { MessageBus, BusPayload, PublishResult } from "../pubsub/bus.js";
import type { PiContext } from "../delivery/pi-inject.js";

// ─── Helpers ────────────────────────────────────────────────────

function makeEmail(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: "em-1",
    threadId: "th-1",
    action: "new",
    from: { name: "Sender", address: "sender@local" },
    to: [{ address: "alice@local" }],
    cc: [],
    bcc: [],
    subject: "Test Subject",
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

function makeMockBus(): MessageBus {
  return {
    publish: vi.fn().mockResolvedValue({ success: true, subscribers: 0 } as PublishResult),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    channels: vi.fn().mockResolvedValue([]),
    send: vi.fn().mockResolvedValue({ success: true, subscribers: 0 } as PublishResult),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockPi(): PiContext {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── Tests: Subscription Management ─────────────────────────────

describe("MailboxSubscription — subscription management", () => {
  it("subscribe adds a subscription and getSubscriptions returns it", () => {
    const sub = new MailboxSubscription(makeMockBus(), makeMockPi());
    sub.subscribe("alice@local", "session-a");
    const subs = sub.getSubscriptions("alice@local");
    expect(subs).toHaveLength(1);
    expect(subs[0].mailbox).toBe("alice@local");
    expect(subs[0].sessionName).toBe("session-a");
  });

  it("subscribe is idempotent — same session/mailbox doesn't duplicate", () => {
    const sub = new MailboxSubscription(makeMockBus(), makeMockPi());
    sub.subscribe("alice@local", "session-a");
    sub.subscribe("alice@local", "session-a");
    expect(sub.getSubscriptions("alice@local")).toHaveLength(1);
  });

  it("unsubscribe removes a subscription", () => {
    const sub = new MailboxSubscription(makeMockBus(), makeMockPi());
    sub.subscribe("alice@local", "session-a");
    sub.unsubscribe("alice@local", "session-a");
    expect(sub.getSubscriptions("alice@local")).toHaveLength(0);
  });

  it("unsubscribe cleans up empty mailbox entries", () => {
    const sub = new MailboxSubscription(makeMockBus(), makeMockPi());
    sub.subscribe("alice@local", "session-a");
    sub.unsubscribe("alice@local", "session-a");
    expect(sub.getAllSubscriptions()).toHaveLength(0);
  });

  it("getSubscriptions for unregistered mailbox returns empty array", () => {
    const sub = new MailboxSubscription(makeMockBus(), makeMockPi());
    expect(sub.getSubscriptions("nobody@local")).toEqual([]);
  });

  it("getAllSubscriptions returns all across mailboxes", () => {
    const sub = new MailboxSubscription(makeMockBus(), makeMockPi());
    sub.subscribe("alice@local", "session-a");
    sub.subscribe("bob@local", "session-b");
    const all = sub.getAllSubscriptions();
    expect(all).toHaveLength(2);
    const names = all.map((s) => s.sessionName).sort();
    expect(names).toEqual(["session-a", "session-b"]);
  });

  it("case-insensitive mailbox matching", () => {
    const sub = new MailboxSubscription(makeMockBus(), makeMockPi());
    sub.subscribe("Alice@Local", "session-a");
    const subs = sub.getSubscriptions("alice@local");
    expect(subs).toHaveLength(1);
    expect(subs[0].sessionName).toBe("session-a");
  });
});

// ─── Tests: Bus Subscription on subscribe() ─────────────────────

describe("MailboxSubscription — bus.subscribe on subscription", () => {
  it("subscribe registers a bus handler on email:inbox:{mailbox}", () => {
    const bus = makeMockBus();
    const sub = new MailboxSubscription(bus, makeMockPi());
    sub.subscribe("alice@local", "session-a");
    expect(bus.subscribe).toHaveBeenCalledWith(
      "email:inbox:alice@local",
      expect.any(Function),
    );
  });

  it("subscribe does not duplicate bus subscription for same mailbox", () => {
    const bus = makeMockBus();
    const sub = new MailboxSubscription(bus, makeMockPi());
    sub.subscribe("alice@local", "session-a");
    sub.subscribe("alice@local", "session-b");
    // Bus subscribe should be called only once per channel
    expect(bus.subscribe).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe calls bus.unsubscribe when last subscriber removed", () => {
    const bus = makeMockBus();
    const sub = new MailboxSubscription(bus, makeMockPi());
    sub.subscribe("alice@local", "session-a");
    sub.unsubscribe("alice@local", "session-a");
    expect(bus.unsubscribe).toHaveBeenCalledWith(
      "email:inbox:alice@local",
    );
  });

  it("unsubscribe does NOT call bus.unsubscribe if other subscribers remain", () => {
    const bus = makeMockBus();
    const sub = new MailboxSubscription(bus, makeMockPi());
    sub.subscribe("alice@local", "session-a");
    sub.subscribe("alice@local", "session-b");
    sub.unsubscribe("alice@local", "session-a");
    expect(bus.unsubscribe).not.toHaveBeenCalled();
  });
});

// ─── Tests: Hook → Bus Publish ──────────────────────────────────

describe("MailboxSubscription — hook handler is no-op (bus publish is in email_send)", () => {
  it("createReceivedHandler does not publish to bus (S6 handles that)", () => {
    const bus = makeMockBus();
    const sub = new MailboxSubscription(bus, makeMockPi());
    sub.subscribe("alice@local", "session-a");

    const handler = sub.createReceivedHandler();
    handler(makeContext());

    // Hook handler no longer publishes — email_send does
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it("hook handler still skips non-received events without error", () => {
    const bus = makeMockBus();
    const sub = new MailboxSubscription(bus, makeMockPi());
    sub.subscribe("alice@local", "session-a");

    const handler = sub.createReceivedHandler();
    handler(makeContext({ event: "email:sent" }));

    expect(bus.publish).not.toHaveBeenCalled();
  });
});

// ─── Tests: Bus Handler → Pi Inject ─────────────────────────────

describe("MailboxSubscription — bus handler calls pi-inject", () => {
  it("bus handler injects message into pi session on bus message", async () => {
    const bus = makeMockBus();
    const pi = makeMockPi();
    const sub = new MailboxSubscription(bus, pi);
    sub.subscribe("alice@local", "session-a");

    // Extract the bus handler that was registered
    const busHandler = (bus.subscribe as ReturnType<typeof vi.fn>).mock.calls[0][1] as (
      channel: string,
      payload: BusPayload,
    ) => void;

    const payload: BusPayload = {
      type: "email:received",
      messageId: "msg-1",
      subject: "Hello",
      from: "bob@local",
      body: "Test body",
      origin: {},
    };

    await busHandler("email:inbox:alice@local", payload);

    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
    const msg = (pi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(msg.customType).toBe("email_bus_message");
    expect(msg.display).toBe(true);
    expect(msg.content).toContain("alice@local");

    const opts = (pi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(opts).toEqual({ triggerTurn: true });
  });

  it("bus handler does not crash if pi.sendMessage throws", async () => {
    const bus = makeMockBus();
    const pi = makeMockPi();
    (pi.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("closed"));
    const sub = new MailboxSubscription(bus, pi);
    sub.subscribe("alice@local", "session-a");

    const busHandler = (bus.subscribe as ReturnType<typeof vi.fn>).mock.calls[0][1] as (
      channel: string,
      payload: BusPayload,
    ) => void;

    const payload: BusPayload = {
      type: "email:received",
      messageId: "msg-1",
      subject: "Hello",
      from: "bob@local",
      body: "Test body",
      origin: {},
    };

    // Should not throw (handler is fire-and-forget, returns void)
    expect(() => busHandler("email:inbox:alice@local", payload)).not.toThrow();
  });
});

// ─── Tests: Graceful Degradation ────────────────────────────────

describe("MailboxSubscription — graceful degradation", () => {
  it("works without bus (bus is null) — no crash on publish", () => {
    const sub = new MailboxSubscription(null as unknown as MessageBus, makeMockPi());
    sub.subscribe("alice@local", "session-a");

    const handler = sub.createReceivedHandler();
    // Should not throw
    expect(() => handler(makeContext())).not.toThrow();
  });

  it("works without pi context — hook handler is no-op", () => {
    const bus = makeMockBus();
    const sub = new MailboxSubscription(bus, null as unknown as PiContext);
    sub.subscribe("alice@local", "session-a");

    const handler = sub.createReceivedHandler();
    handler(makeContext());

    // Hook handler no longer publishes — email_send does
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it("bus.publish failure does not crash handler (no-op)", () => {
    const bus = makeMockBus();
    (bus.publish as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Redis down"));
    const sub = new MailboxSubscription(bus, makeMockPi());
    sub.subscribe("alice@local", "session-a");

    const handler = sub.createReceivedHandler();
    // Hook handler is now no-op, won't trigger publish
    expect(() => handler(makeContext())).not.toThrow();
  });
});

// ─── Tests: No Dead Code ────────────────────────────────────────

describe("MailboxSubscription — no dead intercom code", () => {
  it("source file must NOT contain require('pi-intercom') or require(\"pi-intercom\")", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "mailbox-subscription.ts"),
      "utf-8",
    );
    expect(source).not.toContain('require("pi-intercom")');
    expect(source).not.toContain("'pi-intercom'");
    expect(source).not.toContain("pi-intercom");
  });
});
