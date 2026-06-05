/**
 * SQLite Email Provider — persistent email storage with thread detection.
 *
 * Replaces the in-memory LocalEmailProvider for production use.
 * Uses better-sqlite3 with FTS5 for full-text search.
 */

import { randomUUID } from "node:crypto";
import { EmailDatabase } from "../db/database.js";
import type {
  EmailMessage,
  EmailOrigin,
  EmailProvider,
  EmailQuery,
  EmailThread,
  SendResult,
} from "../types.js";

export class SqliteEmailProvider implements EmailProvider {
  readonly name = "sqlite";
  private readonly db: EmailDatabase;

  constructor(db: EmailDatabase) {
    this.db = db;
  }

  // ─── Send ─────────────────────────────────────────────────────

  async send(email: EmailMessage): Promise<SendResult> {
    const allRecipients = [
      ...email.to,
      ...(email.cc ?? []),
      ...(email.bcc ?? []),
    ];

    if (allRecipients.length === 0) {
      return { success: false, error: "No recipients specified (to/cc/bcc empty)" };
    }

    const id = email.id || randomUUID();

    // Detect thread: check In-Reply-To header or parentId
    const inReplyTo = email.headers["in-reply-to"] || email.headers["In-Reply-To"] || email.parentId;
    const references = email.headers["references"] || email.headers["References"] || "";

    let threadId = email.threadId;
    let action = email.action || "new";

    if (inReplyTo) {
      // This is a reply — find the parent email's thread
      const parent = this.db.db.prepare("SELECT thread_id, id FROM emails WHERE id = ?").get(inReplyTo) as { thread_id: string; id: string } | undefined;
      if (parent) {
        threadId = parent.thread_id;
        action = "reply";
        // Update thread metadata
        this.db.db.prepare(
          "UPDATE threads SET updated_at = datetime('now'), message_count = message_count + 1 WHERE id = ?"
        ).run(threadId);
      }
    }

    if (!threadId) {
      // New thread
      threadId = randomUUID();
      this.db.db.prepare(
        "INSERT INTO threads (id, subject, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))"
      ).run(threadId, email.subject);
    }

    // Insert origin
    const originId = randomUUID();
    this.db.db.prepare(
      `INSERT INTO origins (id, session_id, session_title, session_cwd, cwd, git_project, cli_agent, custom_metadata, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      originId,
      email.origin.sessionId ?? null,
      email.origin.sessionTitle ?? null,
      email.origin.sessionCwd ?? null,
      email.origin.cwd,
      email.origin.gitProject ?? null,
      email.origin.cliAgent,
      JSON.stringify(email.origin.custom),
      email.origin.timestamp.toISOString(),
    );

    // Insert email
    this.db.db.prepare(
      `INSERT INTO emails (id, thread_id, parent_id, from_address, from_name, subject, body, html_body, headers, date, origin_id, action)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      threadId,
      inReplyTo || null,
      email.from.address,
      email.from.name ?? null,
      email.subject,
      email.body,
      email.html ?? null,
      JSON.stringify(email.headers),
      email.date.toISOString(),
      originId,
      action,
    );

    // Insert recipients
    const insertRecipient = this.db.db.prepare(
      "INSERT INTO recipients (email_id, address, name, type) VALUES (?, ?, ?, ?)"
    );
    for (const r of email.to) insertRecipient.run(id, r.address, r.name ?? null, "to");
    for (const r of email.cc ?? []) insertRecipient.run(id, r.address, r.name ?? null, "cc");
    for (const r of email.bcc ?? []) insertRecipient.run(id, r.address, r.name ?? null, "bcc");

    return { success: true, messageId: id, threadId, action };
  }

  // ─── Read ─────────────────────────────────────────────────────

  async read(query: EmailQuery): Promise<EmailMessage[]> {
    let sql = `
      SELECT e.*, o.session_id, o.session_title, o.session_cwd, o.cwd, o.git_project, o.cli_agent, o.custom_metadata, o.timestamp as origin_timestamp
      FROM emails e
      JOIN origins o ON e.origin_id = o.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (query.threadId) {
      sql += " AND e.thread_id = ?";
      params.push(query.threadId);
    }
    if (query.action) {
      sql += " AND e.action = ?";
      params.push(query.action);
    }
    if (query.from) {
      sql += " AND e.from_address LIKE ?";
      params.push(`%${query.from}%`);
    }
    if (query.subject) {
      sql += " AND e.subject LIKE ?";
      params.push(`%${query.subject}%`);
    }
    if (query.since) {
      sql += " AND e.date >= ?";
      params.push(query.since.toISOString());
    }
    if (query.until) {
      sql += " AND e.date <= ?";
      params.push(query.until.toISOString());
    }
    if (query.to) {
      sql += " AND e.id IN (SELECT email_id FROM recipients WHERE address = ?)";
      params.push(query.to.toLowerCase());
    }

    sql += " ORDER BY e.date DESC";

    if (query.limit !== undefined && query.limit >= 0) {
      sql += " LIMIT ?";
      params.push(query.limit);
    }

    const rows = this.db.db.prepare(sql).all(...params) as EmailRow[];
    return rows.map((r) => this.rowToMessage(r));
  }

  // ─── Full-Text Search ─────────────────────────────────────────

  async search(queryText: string, limit = 50): Promise<EmailMessage[]> {
    const rows = this.db.db.prepare(`
      SELECT e.*, o.session_id, o.session_title, o.session_cwd, o.cwd, o.git_project, o.cli_agent, o.custom_metadata, o.timestamp as origin_timestamp
      FROM emails_fts f
      JOIN emails e ON e.rowid = f.rowid
      JOIN origins o ON e.origin_id = o.id
      WHERE emails_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(queryText, limit) as EmailRow[];

    return rows.map((r) => this.rowToMessage(r));
  }

  // ─── Delete ───────────────────────────────────────────────────

  async delete(id: string): Promise<boolean> {
    const result = this.db.db.prepare("DELETE FROM emails WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // ─── Get Thread ───────────────────────────────────────────────

  async getThread(threadId: string): Promise<EmailThread | null> {
    const row = this.db.db.prepare("SELECT * FROM threads WHERE id = ?").get(threadId) as ThreadRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      subject: row.subject,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      messageCount: row.message_count,
    };
  }

  // ─── Health ───────────────────────────────────────────────────

  async health(): Promise<{ ok: boolean; details?: string }> {
    const count = this.db.db.prepare("SELECT COUNT(*) as cnt FROM emails").get() as { cnt: number };
    const threads = this.db.db.prepare("SELECT COUNT(*) as cnt FROM threads").get() as { cnt: number };
    return {
      ok: true,
      details: `SQLite provider: ${count.cnt} email(s), ${threads.cnt} thread(s)`,
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────

  private rowToMessage(row: EmailRow): EmailMessage {
    // Fetch recipients
    const recipients = this.db.db.prepare(
      "SELECT address, name, type FROM recipients WHERE email_id = ?"
    ).all(row.id) as RecipientRow[];

    return {
      id: row.id,
      threadId: row.thread_id,
      parentId: row.parent_id ?? undefined,
      action: row.action as "new" | "reply" | "forward",
      from: { address: row.from_address, name: row.from_name ?? undefined },
      to: recipients.filter((r) => r.type === "to").map((r) => ({ address: r.address, name: r.name ?? undefined })),
      cc: recipients.filter((r) => r.type === "cc").map((r) => ({ address: r.address, name: r.name ?? undefined })),
      bcc: recipients.filter((r) => r.type === "bcc").map((r) => ({ address: r.address, name: r.name ?? undefined })),
      subject: row.subject,
      body: row.body,
      html: row.html_body ?? undefined,
      headers: safeJsonParse(row.headers, {}),
      date: new Date(row.date),
      origin: {
        cwd: row.cwd ?? "",
        cliAgent: row.cli_agent,
        sessionId: row.session_id ?? undefined,
        sessionTitle: row.session_title ?? undefined,
        sessionCwd: row.session_cwd ?? undefined,
        gitProject: row.git_project ?? undefined,
        custom: safeJsonParse(row.custom_metadata, {}),
        timestamp: new Date(row.origin_timestamp),
      },
    };
  }
}

function safeJsonParse<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

// ─── Row Types (internal) ────────────────────────────────────────

interface EmailRow {
  id: string;
  thread_id: string;
  parent_id: string | null;
  from_address: string;
  from_name: string | null;
  subject: string;
  body: string;
  html_body: string | null;
  headers: string;
  date: string;
  origin_id: string;
  action: string;
  created_at: string;
  session_id: string | null;
  session_title: string | null;
  session_cwd: string | null;
  cwd: string | null;
  git_project: string | null;
  cli_agent: string;
  custom_metadata: string | null;
  origin_timestamp: string;
}

interface ThreadRow {
  id: string;
  subject: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

interface RecipientRow {
  address: string;
  name: string | null;
  type: string;
}
