import { describe, it, expect, afterEach } from "vitest";
import { EmailDatabase } from "./database.js";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEMP_FILES: string[] = [];

function tempDbPath(): string {
  const path = join(tmpdir(), `email-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  TEMP_FILES.push(path);
  return path;
}

afterEach(() => {
  while (TEMP_FILES.length) {
    const f = TEMP_FILES.pop()!;
    if (existsSync(f)) unlinkSync(f);
    // also clean WAL/SHM sidecars
    for (const suffix of ["-wal", "-shm"]) {
      const s = f + suffix;
      if (existsSync(s)) unlinkSync(s);
    }
  }
});

// ─── Helper: list user tables in an open db ────────────────────
function tableNames(db: EmailDatabase): string[] {
  return (
    db.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view','trigger') ORDER BY name"
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
}

// ────────────────────────────────────────────────────────────────

describe("EmailDatabase", () => {
  // 1. In-memory creation
  it("creates an in-memory database without touching the filesystem", () => {
    const db = new EmailDatabase();
    expect(db).toBeInstanceOf(EmailDatabase);
    expect(db.db.open).toBe(true);
    db.close();
  });

  // 2. Schema tables exist
  it("creates all required tables on construction", () => {
    const db = new EmailDatabase();
    const tables = tableNames(db);

    for (const required of [
      "emails",
      "origins",
      "threads",
      "recipients",
      "attachments",
    ]) {
      expect(tables).toContain(required);
    }
    db.close();
  });

  // 3. FTS5 virtual table exists
  it("creates the emails_fts FTS5 virtual table", () => {
    const db = new EmailDatabase();
    const tables = tableNames(db);

    expect(tables).toContain("emails_fts");
    db.close();
  });

  // 4. Foreign keys enabled
  it("enables foreign key enforcement by default", () => {
    const db = new EmailDatabase();
    const row = db.db.pragma("foreign_keys") as { foreign_keys: number }[];
    expect(row[0].foreign_keys).toBe(1);
    db.close();
  });

  // 5. File-backed DB
  it("creates a file-backed database when dbPath is provided", () => {
    const path = tempDbPath();
    const db = new EmailDatabase({ dbPath: path });

    expect(existsSync(path)).toBe(true);
    expect(db.db.open).toBe(true);

    db.close();
  });

  // 6. Close works
  it("closes the database without error", () => {
    const db = new EmailDatabase();
    expect(() => db.close()).not.toThrow();
    expect(db.db.open).toBe(false);
  });

  // 7. Insert origin row
  it("can insert and read a row from origins", () => {
    const db = new EmailDatabase();

    db.db
      .prepare(
        `INSERT INTO origins (id, session_id, session_cwd, cwd, timestamp)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run("orig-1", "sess-abc", "/home/test", "/home/test", new Date().toISOString());

    const row = db.db
      .prepare("SELECT * FROM origins WHERE id = ?")
      .get("orig-1") as any;

    expect(row).toBeDefined();
    expect(row.id).toBe("orig-1");
    expect(row.session_id).toBe("sess-abc");
    expect(row.cli_agent).toBe("pi"); // default

    db.close();
  });

  // 8. Insert email with foreign key
  it("can insert an email that references an existing origin and thread", () => {
    const db = new EmailDatabase();
    const now = new Date().toISOString();

    db.db
      .prepare(
        `INSERT INTO origins (id, session_cwd, cwd, timestamp) VALUES (?, ?, ?, ?)`
      )
      .run("orig-2", "/home/test", "/home/test", now);

    db.db
      .prepare(
        `INSERT INTO threads (id, subject, created_at, updated_at)
         VALUES (?, ?, ?, ?)`
      )
      .run("thread-1", "Test thread", now, now);

    db.db
      .prepare(
        `INSERT INTO emails (id, thread_id, from_address, subject, body, headers, date, origin_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "email-1",
        "thread-1",
        "a@b.com",
        "Hello",
        "Body text",
        "{}",
        now,
        "orig-2"
      );

    const email = db.db
      .prepare("SELECT * FROM emails WHERE id = ?")
      .get("email-1") as any;

    expect(email).toBeDefined();
    expect(email.from_address).toBe("a@b.com");
    expect(email.origin_id).toBe("orig-2");
    expect(email.thread_id).toBe("thread-1");

    db.close();
  });

  // 9. FK constraint enforced
  it("rejects an email insert when the origin does not exist", () => {
    const db = new EmailDatabase();
    const now = new Date().toISOString();

    expect(() =>
      db.db
        .prepare(
          `INSERT INTO emails (id, from_address, subject, body, headers, date, origin_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("email-fk", "x@y.com", "No origin", "body", "{}", now, "nonexistent")
    ).toThrow(/foreign key/i);

    db.close();
  });

  // 10. FTS trigger works
  it("populates emails_fts automatically via the AFTER INSERT trigger", () => {
    const db = new EmailDatabase();
    const now = new Date().toISOString();

    db.db
      .prepare(
        `INSERT INTO origins (id, session_cwd, cwd, timestamp) VALUES (?, ?, ?, ?)`
      )
      .run("orig-fts", "/home/test", "/home/test", now);

    db.db
      .prepare(
        `INSERT INTO emails (id, from_address, subject, body, headers, date, origin_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "email-fts",
        "a@b.com",
        "Quarterly report for Acme Corp",
        "Please review the quarterly numbers.",
        "{}",
        now,
        "orig-fts"
      );

    const ftsResults = db.db
      .prepare("SELECT * FROM emails_fts WHERE emails_fts MATCH ?")
      .all("Acme") as any[];

    expect(ftsResults.length).toBeGreaterThanOrEqual(1);
    expect(ftsResults[0].subject).toContain("Acme");

    db.close();
  });
});
