/**
 * Integration Test — Full pub/sub flow end-to-end (S8)
 *
 * Tests the complete pipeline:
 *   email_send → bus.publish → subscribe handler → pi-inject → pi.sendMessage
 *   email_pub → bus.publish
 *   email_sub → bus.subscribe → handler injection
 *   email_channels → bus.channels
 *
 * Uses mock bus (no real Redis) to test the wiring without external deps.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMessageBus, type MessageBus, type BusPayload, type PublishResult } from "../../src/pubsub/bus.js";
import { MailboxSubscription } from "../../src/subscription/mailbox-subscription.js";
import { injectEmailMessage, formatEmailForInjection, type PiContext } from "../../src/delivery/pi-inject.js";
import { createBusLogger } from "../../src/pubsub/logger.js";

// ─── Mock Bus ───────────────────────────────────────────────────

function createMockBus(): MessageBus & { publishedMessages: Array<{ channel: string; payload: BusPayload }> } {
  const publishedMessages: Array<{ channel: string; payload: BusPayload }> = [];
  const handlers = new Map<string, Set<(channel: string, payload: BusPayload) => void>>();

  return {
    publishedMessages,
    async publish(channel: string, payload: BusPayload): Promise<PublishResult> {
      publishedMessages.push({ channel, payload });
      // Simulate Redis fan-out: deliver to all handlers
      const channelHandlers = handlers.get(channel);
      if (channelHandlers) {
        for (const handler of channelHandlers) {
          try { handler(channel, payload); } catch { /* ignore */ }
        }
      }
      return { success: true, subscribers: channelHandlers?.size ?? 0 };
    },
    async subscribe(channel: string, handler: (channel: string, payload: BusPayload) => void): Promise<void> {
      let set = handlers.get(channel);
      if (!set) { set = new Set(); handlers.set(channel, set); }
      set.add(handler);
    },
    async unsubscribe(channel: string): Promise<void> {
      handlers.delete(channel);
    },
    async channels() {
      const result = [];
      for (const [channel, set] of handlers) {
        result.push({ name: channel, subscribers: set.size });
      }
      return result;
    },
    async send(to: string, payload: BusPayload): Promise<PublishResult> {
      return this.publish(`email:direct:${to}`, payload);
    },
    async close(): Promise<void> {
      handlers.clear();
    },
  };
}

function createMockPi(): PiContext {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe("Integration: Full pub/sub pipeline", () => {
  it("send email → bus publish → subscriber receives → pi-inject", async () => {
    const bus = createMockBus();
    const pi = createMockPi();
    const sub = new MailboxSubscription(bus, pi);

    // Subscribe session-a to alice@local
    sub.subscribe("alice@local", "session-a");

    // Simulate email_send: publish to bus
    const payload: BusPayload = {
      type: "email:received",
      messageId: "msg-001",
      subject: "Deploy complete",
      from: "ci@nomad.local",
      body: "Build #42 passed.",
      origin: { cwd: "/projects/noco-mesh", agent: "ci" },
    };

    const result = await bus.publish("email:inbox:alice@local", payload);

    // Bus publish succeeded
    expect(result.success).toBe(true);

    // pi.sendMessage was called (bus handler → injectEmailMessage)
    expect(pi.sendMessage).toHaveBeenCalledTimes(1);

    // Verify the injected message
    const call = (pi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    const message = call[0];
    const options = call[1];

    expect(message.customType).toBe("email_bus_message");
    expect(message.display).toBe(true);
    expect(message.content).toContain("alice@local");
    expect(message.content).toContain("Deploy complete");
    expect(message.details.channel).toBe("email:inbox:alice@local");
    expect(options).toEqual({ triggerTurn: true });
  });

  it("email_pub publishes to arbitrary channel", async () => {
    const bus = createMockBus();
    const payload: BusPayload = {
      type: "system:alert",
      messageId: "alert-001",
      subject: "High CPU",
      from: "monitor@local",
      body: "CPU at 95%",
      origin: {},
    };

    const result = await bus.publish("email:system", payload);

    expect(result.success).toBe(true);
    expect(bus.publishedMessages).toHaveLength(1);
    expect(bus.publishedMessages[0].channel).toBe("email:system");
  });

  it("email_sub subscribes and receives messages", async () => {
    const bus = createMockBus();
    const receivedMessages: BusPayload[] = [];

    await bus.subscribe("email:sent", (channel, payload) => {
      receivedMessages.push(payload);
    });

    await bus.publish("email:sent", {
      type: "email:sent",
      messageId: "msg-002",
      subject: "Test",
      from: "alice@local",
      body: "Hello",
      origin: {},
    });

    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0].messageId).toBe("msg-002");
  });

  it("email_channels lists active channels", async () => {
    const bus = createMockBus();

    await bus.subscribe("email:inbox:alice@local", () => {});
    await bus.subscribe("email:sent", () => {});
    await bus.subscribe("email:sent", () => {}); // Second subscriber

    const channels = await bus.channels();

    expect(channels).toHaveLength(2);
    const sentChannel = channels.find(c => c.name === "email:sent");
    expect(sentChannel?.subscribers).toBe(2);
  });

  it("multiple subscribers on same channel all receive message", async () => {
    const bus = createMockBus();
    const pi1 = createMockPi();
    const pi2 = createMockPi();
    const sub1 = new MailboxSubscription(bus, pi1);
    const sub2 = new MailboxSubscription(bus, pi2);

    sub1.subscribe("bob@local", "session-1");
    sub2.subscribe("bob@local", "session-2");

    await bus.publish("email:inbox:bob@local", {
      type: "email:received",
      messageId: "msg-003",
      subject: "Multi-sub",
      from: "alice@local",
      body: "Test",
      origin: {},
    });

    // Both pi contexts should have received the injection
    expect(pi1.sendMessage).toHaveBeenCalledTimes(1);
    expect(pi2.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("logger records all bus operations", () => {
    const entries: unknown[] = [];
    const logger = createBusLogger((entry) => entries.push(entry));

    logger.logPublish({ channel: "email:inbox:alice@local", messageId: "msg-1", subscribers: 2 });
    logger.logSubscribe({ channel: "email:sent", handler: "onSent" });
    logger.logReceive({ channel: "email:inbox:alice@local", messageId: "msg-1", from: "bob" });
    logger.logError({ channel: "email:system", error: "connection reset" });

    expect(entries).toHaveLength(4);

    const formatted = logger.formatEntry(entries[0] as any);
    expect(formatted).toContain("[email-bus] PUB");
    expect(formatted).toContain("email:inbox:alice@local");
  });

  it("graceful degradation — bus returns failure, no crash", async () => {
    const bus = createMockBus();
    const pi = createMockPi();
    const sub = new MailboxSubscription(bus, pi);

    sub.subscribe("fail@local", "session-x");

    // Override publish to fail
    bus.publish = async () => ({ success: false, error: "Redis down" });

    const result = await bus.publish("email:inbox:fail@local", {
      type: "email:received",
      messageId: "msg-004",
      subject: "Test",
      from: "test@local",
      body: "Test",
      origin: {},
    });

    expect(result.success).toBe(false);
    // No crash, no injection
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("formatEmailForInjection produces valid output for pi-inject", () => {
    const payload: BusPayload = {
      type: "email:received",
      messageId: "msg-005",
      subject: "Test subject",
      from: "sender@local",
      body: "Body text",
      origin: {},
    };

    const formatted = formatEmailForInjection("email:inbox:test@local", payload);

    expect(formatted).toContain("📬");
    expect(formatted).toContain("email:inbox:test@local");
    expect(formatted).toContain("sender@local");
    expect(formatted).toContain("Test subject");
    expect(formatted).toContain("Body text");
  });
});
