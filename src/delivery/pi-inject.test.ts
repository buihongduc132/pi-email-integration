/**
 * Pi Session Injection Tests — TDD for src/delivery/pi-inject.ts
 *
 * Covers: message formatting, injection with triggerTurn,
 * missing pi context graceful handling, payload sanitization.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  injectEmailMessage,
  formatEmailForInjection,
  type PiContext,
  type BusPayload,
} from "./pi-inject.js";

// ─── Helpers ────────────────────────────────────────────────────

function makePiContext(): PiContext {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function makePayload(overrides?: Partial<BusPayload>): BusPayload {
  return {
    type: "email:received",
    messageId: "msg-abc123",
    subject: "Deploy complete",
    from: "ci@nomad.local",
    body: "Build #42 passed all tests.",
    origin: { cwd: "/projects/noco-mesh", agent: "ci" },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe("formatEmailForInjection", () => {
  it("should format a complete email payload for injection", () => {
    const payload = makePayload();
    const formatted = formatEmailForInjection("email:inbox:alice@local", payload);

    expect(formatted).toContain("email:inbox:alice@local");
    expect(formatted).toContain("msg-abc123");
    expect(formatted).toContain("Deploy complete");
    expect(formatted).toContain("ci@nomad.local");
    expect(formatted).toContain("Build #42 passed all tests.");
  });

  it("should truncate long body content", () => {
    const payload = makePayload({ body: "x".repeat(2000) });
    const formatted = formatEmailForInjection("email:inbox:bob@local", payload);

    // Body should be truncated in the formatted message
    expect(formatted.length).toBeLessThan(3000);
    expect(formatted).toContain("...");
  });

  it("should handle missing optional fields gracefully", () => {
    const payload: BusPayload = {
      type: "email:received",
      messageId: "",
      subject: "",
      from: "",
      body: "",
      origin: {},
    };
    const formatted = formatEmailForInjection("email:system", payload);
    expect(formatted).toBeDefined();
    expect(typeof formatted).toBe("string");
  });
});

describe("injectEmailMessage", () => {
  it("should call sendMessage with triggerTurn: true", async () => {
    const pi = makePiContext();
    const payload = makePayload();
    const channel = "email:inbox:alice@local";

    await injectEmailMessage(pi, channel, payload);

    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
    // Check the options argument
    const options = (pi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(options).toEqual({ triggerTurn: true });
  });

  it("should send with customType email_bus_message", async () => {
    const pi = makePiContext();
    const payload = makePayload();

    await injectEmailMessage(pi, "email:inbox:test@local", payload);

    const message = (pi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(message.customType).toBe("email_bus_message");
    expect(message.display).toBe(true);
    expect(message.content).toContain("email:inbox:test@local");
  });

  it("should include channel and payload in details", async () => {
    const pi = makePiContext();
    const payload = makePayload();

    await injectEmailMessage(pi, "email:sent", payload);

    const message = (pi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(message.details).toEqual({
      channel: "email:sent",
      payload: payload,
      from: "ci@nomad.local",
    });
  });

  it("should not crash if sendMessage throws", async () => {
    const pi = makePiContext();
    (pi.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("session closed")
    );
    const payload = makePayload();

    // Should resolve (not throw)
    await expect(injectEmailMessage(pi, "email:inbox:alice@local", payload)).resolves.toBeUndefined();
  });

  it("should not crash if pi context has no sendMessage", async () => {
    const pi = {} as PiContext;
    const payload = makePayload();

    // Should not throw
    await expect(injectEmailMessage(pi, "email:inbox:alice@local", payload)).resolves.toBeUndefined();
  });
});
