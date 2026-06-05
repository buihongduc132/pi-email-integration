/**
 * Schema for pi-email-integration SQLite database.
 *
 * Tables:
 *   emails     — all email messages with full metadata
 *   origins    — origin tracking (session, cwd, git project, agent)
 *   threads    — conversation/thread tracking
 *   recipients — normalized recipient rows (to/cc/bcc per email)
 *
 * Extensions:
 *   FTS5 for full-text search on subject + body
 *   sqlite-vec placeholder for future vector search
 */

-- ─── Origins ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS origins (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  session_title TEXT,
  session_cwd TEXT,
  cwd TEXT NOT NULL,
  git_project TEXT,
  cli_agent TEXT NOT NULL DEFAULT 'pi',
  custom_metadata TEXT, -- JSON
  timestamp TEXT NOT NULL
);

-- ─── Threads ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 1
);

-- ─── Emails ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  parent_id TEXT,          -- In-Reply-To email ID (null = new thread)
  from_address TEXT NOT NULL,
  from_name TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  html_body TEXT,
  headers TEXT NOT NULL,   -- JSON
  date TEXT NOT NULL,
  origin_id TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'new',  -- 'new' | 'reply' | 'forward'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (origin_id) REFERENCES origins(id),
  FOREIGN KEY (thread_id) REFERENCES threads(id)
);

-- ─── Recipients ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id TEXT NOT NULL,
  address TEXT NOT NULL,
  name TEXT,
  type TEXT NOT NULL DEFAULT 'to',  -- 'to' | 'cc' | 'bcc'

  FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
);

-- ─── Attachments ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  content BLOB,

  FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
);

-- ─── FTS5 Full-Text Search ─────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS emails_fts USING fts5(
  subject,
  body,
  content='emails',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS emails_ai AFTER INSERT ON emails BEGIN
  INSERT INTO emails_fts(rowid, subject, body) VALUES (new.rowid, new.subject, new.body);
END;

CREATE TRIGGER IF NOT EXISTS emails_ad AFTER DELETE ON emails BEGIN
  INSERT INTO emails_fts(emails_fts, rowid, subject, body) VALUES('delete', old.rowid, old.subject, old.body);
END;

-- ─── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date);
CREATE INDEX IF NOT EXISTS idx_emails_from ON emails(from_address);
CREATE INDEX IF NOT EXISTS idx_emails_action ON emails(action);
CREATE INDEX IF NOT EXISTS idx_recipients_email ON recipients(email_id);
CREATE INDEX IF NOT EXISTS idx_recipients_address ON recipients(address);
CREATE INDEX IF NOT EXISTS idx_origins_session ON origins(session_id);
CREATE INDEX IF NOT EXISTS idx_origins_cwd ON origins(session_cwd);
CREATE INDEX IF NOT EXISTS idx_origins_git ON origins(git_project);
