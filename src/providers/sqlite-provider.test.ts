import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EmailDatabase } from "../db/database.js";
import { SqliteEmailProvider } from "./sqlite-provider.js";
import type { EmailMessage, EmailOrigin } from "../types.js";

// ─── Test Helpers ───────────────────────────────────────────────

function makeOrigin(overrides?: Partial<EmailOrigin>): EmailOrigin {
  return {
    cwd: "/home/bhd/projects/test",
    cliAgent: "pi",
    sessionId: "ses-abc123",
    sessionTitle: "Test Session",
    sessionCwd: "/home/bhd/projects/test",
    gitProject: "test-project",
    custom: {},
    timestamp: new Date("2026-05-20T00:00:00Z"),
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
    headers: {},
    date: new Date("2026-05-20T12:00:00Z"),
    origin: makeOrigin(),
    action: "new",
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe("SqliteEmailProvider", () => {
  let db: EmailDatabase;
  let provider: SqliteEmailProvider;

  beforeEach(() => {
    db = new EmailDatabase(); // in-memory
    provider = new SqliteEmailProvider(db);
  });

  afterEach(() => {
    db.close();
  });

  // ─── name property ──────────────────────────────────────────

  it("has name 'sqlite'", () => {
    expect(provider.name).toBe("sqlite");
  });

  // ─── 1. Send basic email ────────────────────────────────────

  describe("send() — basic", () => {
    it("stores email and returns success with threadId and action='new'", async () => {
      const email = makeEmail();
      const result = await provider.send(email);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("msg-001");
      expect(result.threadId).toBeDefined();
      expect(typeof result.threadId).toBe("string");
      expect(result.action).toBe("new");
    });
  });

  // ─── 2. Send with empty recipients ──────────────────────────

  describe("send() — empty recipients", () => {
    it("returns error when to/cc/bcc are all empty", async () => {
      const email = makeEmail({ to: [], cc: [], bcc: [] });
      const result = await provider.send(email);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ─── 3. Send reply ──────────────────────────────────────────

  describe("send() — reply", () => {
    it("sets action='reply' and same threadId when in-reply-to header references parent", async () => {
      // Send parent email
      const parent = makeEmail({ id: "parent-001" });
      const parentResult = await provider.send(parent);
      expect(parentResult.action).toBe("new");
      const parentThreadId = parentResult.threadId!;

      // Send reply referencing parent via in-reply-to header
      const reply = makeEmail({
        id: "reply-001",
        headers: { "in-reply-to": "parent-001" },
      });
      const replyResult = await provider.send(reply);

      expect(replyResult.success).toBe(true);
      expect(replyResult.action).toBe("reply");
      expect(replyResult.threadId).toBe(parentThreadId);
    });
  });

  // ─── 4. Thread detection ────────────────────────────────────

  describe("thread detection", () => {
    it("first email creates new thread, second referencing first is reply in same thread", async () => {
      const first = makeEmail({ id: "thread-msg-1", subject: "Deploy discussion" });
      const firstResult = await provider.send(first);
      expect(firstResult.action).toBe("new");
      const threadId = firstResult.threadId!;

      const second = makeEmail({
        id: "thread-msg-2",
        subject: "Re: Deploy discussion",
        headers: { "in-reply-to": "thread-msg-1" },
      });
      const secondResult = await provider.send(second);
      expect(secondResult.action).toBe("reply");
      expect(secondResult.threadId).toBe(threadId);
    });
  });

  // ─── 5. Read by thread ID ───────────────────────────────────

  describe("read() — by threadId", () => {
    it("returns both emails in the same thread", async () => {
      const first = makeEmail({ id: "tid-msg-1" });
      const firstResult = await provider.send(first);
      const threadId = firstResult.threadId!;

      const second = makeEmail({
        id: "tid-msg-2",
        headers: { "in-reply-to": "tid-msg-1" },
      });
      await provider.send(second);

      const messages = await provider.read({ threadId });
      expect(messages).toHaveLength(2);
      const ids = messages.map((m) => m.id).sort();
      expect(ids).toEqual(["tid-msg-1", "tid-msg-2"]);
    });
  });

  // ─── 6. Read by action filter ───────────────────────────────

  describe("read() — action filter", () => {
    it("returns only replies when action='reply'", async () => {
      const first = makeEmail({ id: "act-msg-1" });
      await provider.send(first);

      const second = makeEmail({
        id: "act-msg-2",
        headers: { "in-reply-to": "act-msg-1" },
      });
      await provider.send(second);

      const replies = await provider.read({ action: "reply" });
      expect(replies).toHaveLength(1);
      expect(replies[0].id).toBe("act-msg-2");
      expect(replies[0].action).toBe("reply");
    });
  });

  // ─── 7. Full-text search ────────────────────────────────────

  describe("search()", () => {
    it("finds email by keyword in body", async () => {
      const email = makeEmail({
        id: "fts-msg-1",
        subject: "CI pipeline",
        body: "The deployment failed in production due to missing env vars.",
      });
      await provider.send(email);

      const results = await provider.search("deployment");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe("fts-msg-1");
    });

    it("finds email by keyword in subject", async () => {
      const email = makeEmail({
        id: "fts-msg-2",
        subject: "Critical security vulnerability",
        body: "Please review ASAP.",
      });
      await provider.send(email);

      const results = await provider.search("vulnerability");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe("fts-msg-2");
    });
  });

  // ─── 8. Read with date filters ──────────────────────────────

  describe("read() — date filters", () => {
    it("filters by since date", async () => {
      const oldEmail = makeEmail({
        id: "date-old",
        date: new Date("2026-01-01T00:00:00Z"),
      });
      await provider.send(oldEmail);

      const newEmail = makeEmail({
        id: "date-new",
        date: new Date("2026-06-01T00:00:00Z"),
      });
      await provider.send(newEmail);

      const results = await provider.read({
        since: new Date("2026-05-01T00:00:00Z"),
      });
      expect(results.every((m) => m.date >= new Date("2026-05-01T00:00:00Z"))).toBe(true);
      expect(results.map((m) => m.id)).toContain("date-new");
      expect(results.map((m) => m.id)).not.toContain("date-old");
    });

    it("filters by until date", async () => {
      const oldEmail = makeEmail({
        id: "until-old",
        date: new Date("2026-01-01T00:00:00Z"),
      });
      await provider.send(oldEmail);

      const newEmail = makeEmail({
        id: "until-new",
        date: new Date("2026-06-01T00:00:00Z"),
      });
      await provider.send(newEmail);

      const results = await provider.read({
        until: new Date("2026-03-01T00:00:00Z"),
      });
      expect(results.every((m) => m.date <= new Date("2026-03-01T00:00:00Z"))).toBe(true);
      expect(results.map((m) => m.id)).toContain("until-old");
      expect(results.map((m) => m.id)).not.toContain("until-new");
    });

    it("filters by since and until together", async () => {
      const early = makeEmail({
        id: "range-early",
        date: new Date("2026-01-01T00:00:00Z"),
      });
      await provider.send(early);

      const mid = makeEmail({
        id: "range-mid",
        date: new Date("2026-03-15T00:00:00Z"),
      });
      await provider.send(mid);

      const late = makeEmail({
        id: "range-late",
        date: new Date("2026-06-01T00:00:00Z"),
      });
      await provider.send(late);

      const results = await provider.read({
        since: new Date("2026-03-01T00:00:00Z"),
        until: new Date("2026-04-01T00:00:00Z"),
      });
      const ids = results.map((m) => m.id);
      expect(ids).toContain("range-mid");
      expect(ids).not.toContain("range-early");
      expect(ids).not.toContain("range-late");
    });
  });

  // ─── 9. Delete ──────────────────────────────────────────────

  describe("delete()", () => {
    it("deletes an email and it no longer appears in read", async () => {
      const email = makeEmail({ id: "del-msg-1" });
      await provider.send(email);

      // Confirm it's there
      const before = await provider.read({});
      expect(before.map((m) => m.id)).toContain("del-msg-1");

      // Delete
      const deleted = await provider.delete("del-msg-1");
      expect(deleted).toBe(true);

      // Confirm it's gone
      const after = await provider.read({});
      expect(after.map((m) => m.id)).not.toContain("del-msg-1");
    });

    it("returns false for non-existent email", async () => {
      const result = await provider.delete("does-not-exist");
      expect(result).toBe(false);
    });
  });

  // ─── 10. Get thread ─────────────────────────────────────────

  describe("getThread()", () => {
    it("returns thread metadata with messageCount=2 after reply", async () => {
      const first = makeEmail({ id: "thr-msg-1", subject: "Thread test" });
      const firstResult = await provider.send(first);
      const threadId = firstResult.threadId!;

      const reply = makeEmail({
        id: "thr-msg-2",
        subject: "Re: Thread test",
        headers: { "in-reply-to": "thr-msg-1" },
      });
      await provider.send(reply);

      const thread = await provider.getThread(threadId);
      expect(thread).not.toBeNull();
      expect(thread!.id).toBe(threadId);
      expect(thread!.subject).toBe("Thread test");
      expect(thread!.messageCount).toBe(2);
    });

    it("returns null for non-existent thread", async () => {
      const thread = await provider.getThread("no-such-thread");
      expect(thread).toBeNull();
    });
  });

  // ─── 11. Origin persistence ─────────────────────────────────

  describe("origin persistence", () => {
    it("sessionId, sessionTitle, sessionCwd, gitProject survive round-trip", async () => {
      const origin = makeOrigin({
        sessionId: "ses-origin-001",
        sessionTitle: "Origin Test Session",
        sessionCwd: "/home/bhd/projects/origin-test",
        gitProject: "origin-test-project",
      });
      const email = makeEmail({ id: "origin-msg-1", origin });
      await provider.send(email);

      const [read] = await provider.read({});
      expect(read).toBeDefined();
      expect(read.origin.sessionId).toBe("ses-origin-001");
      expect(read.origin.sessionTitle).toBe("Origin Test Session");
      expect(read.origin.sessionCwd).toBe("/home/bhd/projects/origin-test");
      expect(read.origin.gitProject).toBe("origin-test-project");
      expect(read.origin.cliAgent).toBe("pi");
    });
  });

  // ─── 12. BCC recipients stored ──────────────────────────────

  describe("BCC recipients", () => {
    it("stores and retrieves BCC recipients", async () => {
      const email = makeEmail({
        id: "bcc-msg-1",
        to: [{ name: "Bob", address: "bob@example.com" }],
        bcc: [{ name: "Secret", address: "secret@example.com" }],
      });
      await provider.send(email);

      const [read] = await provider.read({});
      expect(read.bcc).toBeDefined();
      expect(read.bcc!).toHaveLength(1);
      expect(read.bcc![0].address).toBe("secret@example.com");
      expect(read.bcc![0].name).toBe("Secret");
    });
  });

  // ─── 13. Multiple recipients — per-mailbox read ─────────────

  describe("multiple recipients", () => {
    it("send to 3 people, read each mailbox by 'to' filter", async () => {
      const email = makeEmail({
        id: "multi-msg-1",
        to: [
          { address: "alice@example.com" },
          { address: "bob@example.com" },
          { address: "carol@example.com" },
        ],
      });
      await provider.send(email);

      // Each recipient should see the email when filtering by their address
      const aliceMail = await provider.read({ to: "alice@example.com" });
      expect(aliceMail).toHaveLength(1);
      expect(aliceMail[0].id).toBe("multi-msg-1");

      const bobMail = await provider.read({ to: "bob@example.com" });
      expect(bobMail).toHaveLength(1);
      expect(bobMail[0].id).toBe("multi-msg-1");

      const carolMail = await provider.read({ to: "carol@example.com" });
      expect(carolMail).toHaveLength(1);
      expect(carolMail[0].id).toBe("multi-msg-1");

      // Unrelated address should not see it
      const daveMail = await provider.read({ to: "dave@example.com" });
      expect(daveMail).toHaveLength(0);
    });
  });
});
