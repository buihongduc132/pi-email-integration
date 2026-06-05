import { describe, it, expect, vi } from "vitest";
import { HookManager } from "./hook-manager.js";
import type { EmailHookContext, EmailHookEvent, EmailHookHandler, EmailMessage } from "../types.js";

// ─── Helpers ────────────────────────────────────────────────────

function makeCtx(event: EmailHookEvent, overrides?: Partial<EmailHookContext>): EmailHookContext {
  return {
    event,
    email: {
      id: "test-id",
      from: { address: "sender@test.com" },
      to: [{ address: "recipient@test.com" }],
      subject: "Test",
      body: "Hello",
      headers: {},
      date: new Date("2025-01-01"),
      origin: {
        cwd: "/test",
        cliAgent: "pi",
        custom: {},
        timestamp: new Date("2025-01-01"),
      },
    } satisfies EmailMessage,
    timestamp: new Date("2025-01-01"),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe("HookManager", () => {
  it("on() registers a handler for an event", () => {
    const manager = new HookManager();
    const handler = vi.fn();

    manager.on("email:received", handler);

    expect(manager.listHandlers("email:received")).toEqual({ "email:received": 1 });
  });

  it("fire() calls all handlers for the matching event", async () => {
    const manager = new HookManager();
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    const ctx = makeCtx("email:received");

    manager.on("email:received", handlerA);
    manager.on("email:received", handlerB);

    await manager.fire(ctx);

    expect(handlerA).toHaveBeenCalledOnce();
    expect(handlerA).toHaveBeenCalledWith(ctx);
    expect(handlerB).toHaveBeenCalledOnce();
    expect(handlerB).toHaveBeenCalledWith(ctx);
  });

  it("fire() does NOT call handlers for different events", async () => {
    const manager = new HookManager();
    const receivedHandler = vi.fn();
    const sentHandler = vi.fn();
    const ctx = makeCtx("email:received");

    manager.on("email:received", receivedHandler);
    manager.on("email:sent", sentHandler);

    await manager.fire(ctx);

    expect(receivedHandler).toHaveBeenCalledOnce();
    expect(sentHandler).not.toHaveBeenCalled();
  });

  it("fire() catches errors from handlers and continues to next handler", async () => {
    const manager = new HookManager();
    const handlerA = vi.fn().mockImplementation(() => {
      throw new Error("boom");
    });
    const handlerB = vi.fn();
    const ctx = makeCtx("email:received");

    manager.on("email:received", handlerA);
    manager.on("email:received", handlerB);

    // Must not throw — errors are swallowed internally
    await manager.fire(ctx);

    expect(handlerA).toHaveBeenCalledOnce();
    // handlerB still fires despite handlerA throwing
    expect(handlerB).toHaveBeenCalledOnce();
  });

  it("off() removes a specific handler", () => {
    const manager = new HookManager();
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    manager.on("email:received", handlerA);
    manager.on("email:received", handlerB);
    manager.off("email:received", handlerA);

    expect(manager.listHandlers("email:received")).toEqual({ "email:received": 1 });
  });

  it("off() does nothing for unregistered events", () => {
    const manager = new HookManager();
    const handler = vi.fn();

    // Should not throw
    manager.off("email:sent", handler);

    expect(manager.listHandlers("email:sent")).toEqual({ "email:sent": 0 });
  });

  it("listHandlers() returns count for specific event", () => {
    const manager = new HookManager();
    const handler = vi.fn();

    manager.on("email:deleted", handler);
    manager.on("email:deleted", handler);

    // Same function registered twice = 2 entries (the module pushes as-is)
    expect(manager.listHandlers("email:deleted")).toEqual({ "email:deleted": 2 });
  });

  it("listHandlers() returns all event counts when no arg", () => {
    const manager = new HookManager();
    const handler = vi.fn();

    manager.on("email:received", handler);
    manager.on("email:sent", handler);
    manager.on("email:sent", handler);

    const result = manager.listHandlers();

    expect(result).toEqual({
      "email:received": 1,
      "email:sent": 2,
    });
  });

  it("clear() removes all handlers", () => {
    const manager = new HookManager();
    const handler = vi.fn();

    manager.on("email:received", handler);
    manager.on("email:sent", handler);
    manager.on("email:read", handler);

    manager.clear();

    expect(manager.listHandlers()).toEqual({});
  });

  it("fire() handles async handlers (awaits them)", async () => {
    const manager = new HookManager();
    const order: string[] = [];

    const asyncHandlerA: EmailHookHandler = async () => {
      order.push("a-start");
      await Promise.resolve();
      order.push("a-end");
    };
    const handlerB: EmailHookHandler = () => {
      order.push("b");
    };

    manager.on("email:received", asyncHandlerA);
    manager.on("email:received", handlerB);

    await manager.fire(makeCtx("email:received"));

    // fire() awaits each handler sequentially, so a-start → a-end → b
    expect(order).toEqual(["a-start", "a-end", "b"]);
  });

  it("multiple handlers on same event all fire in registration order", async () => {
    const manager = new HookManager();
    const order: number[] = [];

    const h1: EmailHookHandler = () => { order.push(1); };
    const h2: EmailHookHandler = () => { order.push(2); };
    const h3: EmailHookHandler = () => { order.push(3); };

    manager.on("email:received", h1);
    manager.on("email:received", h2);
    manager.on("email:received", h3);

    await manager.fire(makeCtx("email:received"));

    expect(order).toEqual([1, 2, 3]);
  });
});
