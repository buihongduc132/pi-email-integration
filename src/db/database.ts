/**
 * SQLite Database Layer — persistent email storage.
 *
 * Uses better-sqlite3 (synchronous, WAL mode).
 * Schema loaded from schema.sql on first init.
 */

import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DbOptions {
  /** Path to the SQLite database file (default: in-memory for tests) */
  dbPath?: string;
  /** Whether to run in WAL mode (default: true for file-backed) */
  wal?: boolean;
}

export class EmailDatabase {
  readonly db: Database.Database;

  constructor(options: DbOptions = {}) {
    if (options.dbPath) {
      // Ensure directory exists
      mkdirSync(dirname(options.dbPath), { recursive: true });
      this.db = new Database(options.dbPath);
      if (options.wal !== false) {
        this.db.pragma("journal_mode = WAL");
      }
    } else {
      // In-memory for testing
      this.db = new Database(":memory:");
    }

    // Enable foreign keys
    this.db.pragma("foreign_keys = ON");

    // Load schema
    const schemaPath = join(__dirname, "schema.sql");
    const schema = readFileSync(schemaPath, "utf-8");
    this.db.exec(schema);
  }

  close(): void {
    this.db.close();
  }
}
