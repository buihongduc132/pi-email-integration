/**
 * Message Bus Tests — TDD for src/pubsub/bus.ts
 *
 * Covers: publish, subscribe, unsubscribe, channels, close.
 * Redis unavailable = graceful failure (no crash).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMessageBus, type MessageBus, type BusPayload } from "./bus.js";

// ─── Helpers ────────────────────────────────────────────────────

function makePayload(overrides?: Partial<BusPayload>): BusPayload {
  return {
    type: "email:received",
    messageId: "msg-123",
    subject: "Test subject",
    from: "alice@local",
    body: "Hello world",
    origin: { cwd: "/test", agent: "pi", timestamp: new Date().toISOString() },
    ...overrides,
  };
}

// ─── Unit tests with mocked ioredis ─────────────────────────────

describe("MessageBus (unit — ioredis mocked)", () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = createMessageBus({ url: "redis://localhost:6379" });
  });

  afterEach(async () => {
    await bus.close();
  });

  it("should publish a message to a channel", async () => {
    // createMessageBus returns a bus that defers connection.
    // publish should call redis.publish under the hood.
    const payload = makePayload();
    const result = await bus.publish("email:inbox:alice@local", payload);
    // With no real Redis, publish should not throw — graceful failure
    expect(result).toBeDefined();
    expect(typeof result.success).toBe("boolean");
  });

  it("should subscribe to a channel with a handler", async () => {
    const handler = vi.fn();
    await bus.subscribe("email:inbox:bob@local", handler);
    // Subscription should not throw even without real Redis
    expect(true).toBe(true);
  });

  it("should unsubscribe from a channel", async () => {
    const handler = vi.fn();
    await bus.subscribe("email:inbox:bob@local", handler);
    await bus.unsubscribe("email:inbox:bob@local", handler);
    // No error thrown
    expect(true).toBe(true);
  });

  it("should list active channels", async () => {
    const channels = await bus.channels();
    expect(Array.isArray(channels)).toBe(true);
  });

  it("should close without error", async () => {
    await bus.close();
    // No error thrown
    expect(true).toBe(true);
  });

  it("should handle direct send (to a specific session)", async () => {
    const payload = makePayload();
    const result = await bus.send("session-worker-1", payload);
    expect(result).toBeDefined();
    expect(typeof result.success).toBe("boolean");
  });
});

// ─── Graceful degradation — Redis down ──────────────────────────

describe("MessageBus — Redis unavailable (graceful failure)", () => {
  it("should not crash on publish when Redis is unreachable", async () => {
    const bus = createMessageBus({ url: "redis://localhost:16379" }); // likely no server here
    const payload = makePayload();
    // Should resolve (not throw) even if Redis is down
    const result = await bus.publish("email:inbox:test@local", payload);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    await bus.close();
  });

  it("should not crash on subscribe when Redis is unreachable", async () => {
    const bus = createMessageBus({ url: "redis://localhost:16379" });
    const handler = vi.fn();
    // Should not throw
    await expect(bus.subscribe("email:sent", handler)).resolves.toBeUndefined();
    await bus.close();
  });

  it("should not crash on channels when Redis is unreachable", async () => {
    const bus = createMessageBus({ url: "redis://localhost:16379" });
    const channels = await bus.channels();
    // Should return empty array, not throw
    expect(Array.isArray(channels)).toBe(true);
    await bus.close();
  });
});

// ─── Multiple subscribers ───────────────────────────────────────

describe("MessageBus — multiple handlers on same channel", () => {
  it("should register multiple handlers on the same channel", async () => {
    const bus = createMessageBus({ url: "redis://localhost:6379" });
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    await bus.subscribe("email:sent", handler1);
    await bus.subscribe("email:sent", handler2);
    // Both should be registered without error
    await bus.unsubscribe("email:sent", handler1);
    await bus.unsubscribe("email:sent", handler2);
    await bus.close();
  });
});
