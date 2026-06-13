/**
 * Unit tests — bus unref-on-connect (THE-703)
 *
 * The integration test (tests/integration/bus-process-exit.test.ts) proves the
 * END-TO-END invariant against a real Redis: the process must drain after the
 * session keepalive releases. These unit tests cover the `unrefStream` helper
 * itself with a mocked ioredis so we can assert the socket is unref'd on
 * connect AND on every reconnect — without depending on a live Redis.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock ioredis ───────────────────────────────────────────────
// Each `new Ioredis(...)` returns a fresh mock instance whose `.stream` carries
// an `unref` spy, so we can assert the bus unrefs both connections.

interface MockRedis {
  stream: { unref: ReturnType<typeof vi.fn> };
  connect: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  pubsub: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

function makeMockRedis(): MockRedis {
  return {
    stream: { unref: vi.fn() },
    connect: vi.fn(async () => undefined),
    on: vi.fn(),
    publish: vi.fn(async () => 0),
    subscribe: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
    pubsub: vi.fn(async () => [] as unknown[]),
    disconnect: vi.fn(() => undefined),
  };
}

// Capture the last two constructed instances so tests can assert on them.
let lastInstances: MockRedis[] = [];

vi.mock("ioredis", () => {
  return {
    default: vi.fn(function (this: unknown) {
      const inst = makeMockRedis();
      lastInstances.push(inst);
      return inst;
    }),
  };
});

import { createMessageBus } from "./bus.js";

describe("MessageBus — unref on connect (THE-703)", () => {
  beforeEach(() => {
    lastInstances = [];
  });

  it("unrefs both connection streams once publish triggers a connection", async () => {
    const bus = createMessageBus();
    await bus.publish("email:inbox:x@local", {
      type: "email:received",
      messageId: "m",
      subject: "s",
      from: "f",
      "body": "b",
      origin: {},
    });

    // ensureConnection constructs exactly two ioredis clients (pub + sub).
    expect(lastInstances).toHaveLength(2);
    for (const inst of lastInstances) {
      expect(inst.stream.unref).toHaveBeenCalledTimes(1);
    }
    await bus.close();
  });

  it("registers a 'connect' listener so reconnects stay unref'd too", async () => {
    const bus = createMessageBus();
    await bus.publish("email:inbox:y@local", {
      type: "email:received",
      messageId: "m2",
      subject: "s",
      from: "f",
      "body": "b",
      origin: {},
    });

    // Each connection must subscribe to the reconnect event.
    for (const inst of lastInstances) {
      const connectCalls = inst.on.mock.calls.filter(([evt]) => evt === "connect");
      expect(connectCalls.length).toBeGreaterThanOrEqual(1);
    }
    await bus.close();
  });

  it("is resilient if the underlying stream has no unref() (defensive)", async () => {
    // Re-mock one instance to expose a stream WITHOUT unref — the bus must not throw.
    lastInstances = [];
    const { default: Ctor } = await import("ioredis");
    const origImpl = vi.mocked(Ctor).getMockImplementation();
    vi.mocked(Ctor).mockImplementation(function (this: unknown) {
      const inst = makeMockRedis();
      // Strip unref to exercise the optional-chaining short-circuit.
      inst.stream = {} as { unref: ReturnType<typeof vi.fn> };
      lastInstances.push(inst);
      return inst;
    });

    const bus = createMessageBus();
    // Must NOT throw despite missing unref.
    await expect(
      bus.publish("email:inbox:z@local", {
        type: "email:received",
        messageId: "m3",
        subject: "s",
        from: "f",
        body: "b",
        origin: {},
      }),
    ).resolves.toBeDefined();
    await bus.close();

    // Restore the default mock for subsequent tests.
    if (origImpl) {
      vi.mocked(Ctor).mockImplementation(origImpl);
    }
  });
});
