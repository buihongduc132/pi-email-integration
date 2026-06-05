import { describe, it, expect, beforeEach } from "vitest";
import { LocalEmailProvider } from "./local-provider.js";
import type { EmailMessage, EmailOrigin } from "../types.js";

// ─── Test Helpers ───────────────────────────────────────────────

function makeOrigin(overrides?: Partial<EmailOrigin>): EmailOrigin {
  return {
    cwd: "/tmp/test",
    cliAgent: "pi",
    sessionId: "test-session-001",
    custom: {},
    timestamp: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeEmail(overrides?: Partial<EmailMessage>): EmailMessage {
  return {
    id: "msg-001",
    from: { name: "Alice", address: "alice@example.com" },
    to: [{ name: "Bob", address: "bob@example.com" }],
    subject: "Hello World",
    body: "Test body content",
    headers: { "X-Test": "true" },
    date: new Date("2026-05-20T12:00:00Z"),
    origin: makeOrigin(),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe("LocalEmailProvider", () => {
  let provider: LocalEmailProvider;

  beforeEach(() => {
    provider = new LocalEmailProvider();
  });

  // ─── name property ──────────────────────────────────────────

  describe("name", () => {
    it("returns 'local'", () => {
      expect(provider.name).toBe("local");
    });
  });

  // ─── send() ─────────────────────────────────────────────────

  describe("send()", () => {
    it("returns success with a messageId", async () => {
      const result = await provider.send(makeEmail());
      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(typeof result.messageId).toBe("string");
    });

    it("uses the provided email.id when given", async () => {
      const email = makeEmail({ id: "my-custom-id" });
      const result = await provider.send(email);
      expect(result.messageId).toBe("my-custom-id");
    });

    it("generates a new id when email.id is undefined", async () => {
      const email = makeEmail({ id: undefined as unknown as string });
      const result = await provider.send(email);
      expect(result.messageId).toBeDefined();
      expect(typeof result.messageId).toBe("string");
      // Should be a UUID-like string (36 chars with dashes)
      expect(result.messageId!.length).toBeGreaterThanOrEqual(36);
    });

    it("stores the email in the recipient mailbox", async () => {
      const email = makeEmail({
        to: [{ address: "bob@example.com" }],
        subject: "Stored test",
      });
      await provider.send(email);

      const messages = await provider.read({ to: "bob@example.com" });
      expect(messages).toHaveLength(1);
      expect(messages[0].subject).toBe("Stored test");
    });

    it("stores in multiple recipient mailboxes", async () => {
      const email = makeEmail({
        to: [
          { address: "bob@example.com" },
          { address: "carol@example.com" },
          { address: "dave@example.com" },
        ],
        subject: "Multi-recipient",
      });
      await provider.send(email);

      const bobMessages = await provider.read({ to: "bob@example.com" });
      const carolMessages = await provider.read({ to: "carol@example.com" });
      const daveMessages = await provider.read({ to: "dave@example.com" });

      expect(bobMessages).toHaveLength(1);
      expect(carolMessages).toHaveLength(1);
      expect(daveMessages).toHaveLength(1);
      // All should reference the same messageId
      expect(bobMessages[0].id).toBe(carolMessages[0].id);
      expect(carolMessages[0].id).toBe(daveMessages[0].id);
    });

    it("returns error when no recipients provided", async () => {
      const email = makeEmail({ to: [] });
      const result = await provider.send(email);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ─── read() ─────────────────────────────────────────────────

  describe("read()", () => {
    beforeEach(async () => {
      // Seed some emails
      await provider.send(
        makeEmail({
          id: "msg-a",
          from: { address: "alice@example.com" },
          to: [{ address: "bob@example.com" }],
          subject: "Meeting Tomorrow",
          date: new Date("2026-05-18T10:00:00Z"),
        }),
      );
      await provider.send(
        makeEmail({
          id: "msg-b",
          from: { address: "carol@example.com" },
          to: [{ address: "bob@example.com" }],
          subject: "Lunch invitation",
          date: new Date("2026-05-19T14:00:00Z"),
        }),
      );
      await provider.send(
        makeEmail({
          id: "msg-c",
          from: { address: "alice@example.com" },
          to: [{ address: "dave@example.com" }],
          subject: "Project update",
          date: new Date("2026-05-20T09:00:00Z"),
        }),
      );
    });

    it("with 'to' filter returns emails for that mailbox only", async () => {
      const messages = await provider.read({ to: "bob@example.com" });
      expect(messages).toHaveLength(2);
      expect(messages.map((m) => m.id).sort()).toEqual(
        ["msg-a", "msg-b"].sort(),
      );
    });

    it("'to' filter is case-insensitive", async () => {
      const messages = await provider.read({ to: "Bob@Example.COM" });
      expect(messages).toHaveLength(2);
    });

    it("without 'to' filter returns all emails across all mailboxes", async () => {
      const messages = await provider.read({});
      // bob has 2, dave has 1 = 3 total
      expect(messages).toHaveLength(3);
    });

    it("with 'from' filter returns matching emails", async () => {
      const messages = await provider.read({ from: "alice@example.com" });
      // Alice sent msg-a to bob and msg-c to dave = 2 in getAllEmails
      expect(messages).toHaveLength(2);
      expect(messages.every((m) => m.from.address === "alice@example.com")).toBe(true);
    });

    it("with 'subject' filter performs case-insensitive matching", async () => {
      const messages = await provider.read({ subject: "meeting" });
      // Should match "Meeting Tomorrow" (case-insensitive)
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe("msg-a");
    });

    it("with 'since' date filter returns emails on or after that date", async () => {
      const since = new Date("2026-05-19T00:00:00Z");
      const messages = await provider.read({ since });
      // msg-b (May 19) and msg-c (May 20)
      expect(messages).toHaveLength(2);
    });

    it("with 'until' date filter returns emails on or before that date", async () => {
      const until = new Date("2026-05-19T23:59:59Z");
      const messages = await provider.read({ until });
      // msg-a (May 18) and msg-b (May 19)
      expect(messages).toHaveLength(2);
    });

    it("combines since and until for a date range", async () => {
      const messages = await provider.read({
        since: new Date("2026-05-19T00:00:00Z"),
        until: new Date("2026-05-19T23:59:59Z"),
      });
      // Only msg-b falls within May 19
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe("msg-b");
    });

    it("with 'limit' returns at most that many emails", async () => {
      const messages = await provider.read({ limit: 1 });
      expect(messages).toHaveLength(1);
    });

    it("limit of 0 returns empty array", async () => {
      const messages = await provider.read({ limit: 0 });
      expect(messages).toHaveLength(0);
    });

    it("returns empty array for mailbox with no emails", async () => {
      const messages = await provider.read({ to: "nonexistent@example.com" });
      expect(messages).toHaveLength(0);
    });
  });

  // ─── search() ───────────────────────────────────────────────

  describe("search()", () => {
    it("behaves the same as read() for the local provider", async () => {
      await provider.send(
        makeEmail({
          id: "msg-s1",
          to: [{ address: "zara@example.com" }],
          subject: "Search test alpha",
        }),
      );
      await provider.send(
        makeEmail({
          id: "msg-s2",
          to: [{ address: "zara@example.com" }],
          subject: "Search test beta",
        }),
      );

      const readResult = await provider.read({ to: "zara@example.com" });
      const searchResult = await provider.search({ to: "zara@example.com" });

      expect(searchResult).toEqual(readResult);
      expect(searchResult).toHaveLength(2);
    });

    it("supports subject filter just like read", async () => {
      await provider.send(
        makeEmail({
          id: "msg-s3",
          to: [{ address: "zara@example.com" }],
          subject: "Unique search term xyz",
        }),
      );

      const results = await provider.search({
        to: "zara@example.com",
        subject: "xyz",
      });
      expect(results).toHaveLength(1);
      expect(results[0].subject).toContain("xyz");
    });
  });

  // ─── delete() ───────────────────────────────────────────────

  describe("delete()", () => {
    it("removes an email from all mailboxes", async () => {
      const email = makeEmail({
        id: "msg-del",
        to: [
          { address: "bob@example.com" },
          { address: "carol@example.com" },
        ],
      });
      await provider.send(email);

      // Verify it's in both mailboxes
      const bobBefore = await provider.read({ to: "bob@example.com" });
      const carolBefore = await provider.read({ to: "carol@example.com" });
      expect(bobBefore).toHaveLength(1);
      expect(carolBefore).toHaveLength(1);

      const deleted = await provider.delete("msg-del");
      expect(deleted).toBe(true);

      // Verify removed from both
      const bobAfter = await provider.read({ to: "bob@example.com" });
      const carolAfter = await provider.read({ to: "carol@example.com" });
      expect(bobAfter).toHaveLength(0);
      expect(carolAfter).toHaveLength(0);
    });

    it("returns false for non-existent email id", async () => {
      const deleted = await provider.delete("non-existent-id");
      expect(deleted).toBe(false);
    });

    it("only deletes the targeted email, leaving others intact", async () => {
      await provider.send(makeEmail({ id: "keep-me", to: [{ address: "bob@example.com" }] }));
      await provider.send(makeEmail({ id: "remove-me", to: [{ address: "bob@example.com" }] }));

      await provider.delete("remove-me");

      const remaining = await provider.read({ to: "bob@example.com" });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe("keep-me");
    });
  });

  // ─── health() ───────────────────────────────────────────────

  describe("health()", () => {
    it("returns ok: true when empty", async () => {
      const health = await provider.health();
      expect(health.ok).toBe(true);
      expect(health.details).toContain("0 mailbox");
      expect(health.details).toContain("0 email");
    });

    it("returns mailbox and email counts after sending", async () => {
      await provider.send(
        makeEmail({
          to: [
            { address: "alice@example.com" },
            { address: "bob@example.com" },
          ],
        }),
      );

      const health = await provider.health();
      expect(health.ok).toBe(true);
      expect(health.details).toContain("2 mailbox");
      expect(health.details).toContain("2 email");
    });
  });
});
