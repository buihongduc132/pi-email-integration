/**
 * Structured Logger Tests — TDD for src/pubsub/logger.ts
 *
 * Covers: PUB, SUB, RECV, ERR event types.
 * Output is structured (machine-parseable), not free-form text.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBusLogger, type BusLogger, type LogEntry } from "./logger.js";

describe("BusLogger", () => {
  let entries: LogEntry[];
  let logger: BusLogger;

  beforeEach(() => {
    entries = [];
    logger = createBusLogger((entry) => entries.push(entry));
  });

  // ─── PUB event ───────────────────────────────────────────────

  it("should log PUB events with channel, messageId, size, subscribers, latency", () => {
    logger.logPublish({
      channel: "email:inbox:alice@local",
      messageId: "msg-123",
      size: 1200,
      subscribers: 3,
      latencyMs: 0.4,
    });

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.event).toBe("PUB");
    expect(entry.channel).toBe("email:inbox:alice@local");
    expect(entry.messageId).toBe("msg-123");
    expect(entry.size).toBe(1200);
    expect(entry.subscribers).toBe(3);
    expect(entry.latencyMs).toBe(0.4);
  });

  // ─── SUB event ───────────────────────────────────────────────

  it("should log SUB events with channel and handler name", () => {
    logger.logSubscribe({
      channel: "email:sent",
      handler: "onMailSent",
      totalSubscribers: 5,
    });

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.event).toBe("SUB");
    expect(entry.channel).toBe("email:sent");
    expect(entry.handler).toBe("onMailSent");
    expect(entry.totalSubscribers).toBe(5);
  });

  // ─── RECV event ──────────────────────────────────────────────

  it("should log RECV events with channel, messageId, and source", () => {
    logger.logReceive({
      channel: "email:inbox:alice@local",
      messageId: "msg-123",
      from: "pi-session-worker-1a2b",
    });

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.event).toBe("RECV");
    expect(entry.channel).toBe("email:inbox:alice@local");
    expect(entry.messageId).toBe("msg-123");
    expect(entry.from).toBe("pi-session-worker-1a2b");
  });

  // ─── ERR event ───────────────────────────────────────────────

  it("should log ERR events with channel, messageId, and error", () => {
    logger.logError({
      channel: "email:inbox:alice@local",
      messageId: "def456",
      error: "connection reset",
    });

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.event).toBe("ERR");
    expect(entry.channel).toBe("email:inbox:alice@local");
    expect(entry.messageId).toBe("def456");
    expect(entry.error).toBe("connection reset");
  });

  // ─── Format verification ─────────────────────────────────────

  it("should format log entries as readable strings", () => {
    logger.logPublish({
      channel: "email:inbox:alice@local",
      messageId: "msg-123",
      size: 1200,
      subscribers: 3,
      latencyMs: 0.4,
    });

    const formatted = logger.formatEntry(entries[0]);
    expect(formatted).toContain("[email-bus]");
    expect(formatted).toContain("PUB");
    expect(formatted).toContain("email:inbox:alice@local");
    expect(formatted).toContain("msg=msg-123");
  });

  // ─── No crash on missing optional fields ─────────────────────

  it("should handle log entries with minimal fields", () => {
    logger.logError({
      channel: "email:system",
      messageId: "",
      error: "generic error",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe("ERR");
    expect(entries[0].error).toBe("generic error");
  });
});
