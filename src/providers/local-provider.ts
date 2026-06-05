/**
 * Local Email Provider — in-memory mail server for local development and testing.
 *
 * This is the DEFAULT provider. Real mail adapters (Gmail, Outlook, IMAP)
 * are DEFERRED — see docs/DEFERRED.md for the roadmap.
 *
 * Stores all emails in memory. Suitable for:
 *   - Agent-to-agent communication within the same machine
 *   - Development and testing
 *   - Gas Town compatibility mode (internal mailboxes)
 */

import { randomUUID } from "node:crypto";
import type {
  EmailMessage,
  EmailProvider,
  EmailQuery,
  SendResult,
} from "../types.js";

export class LocalEmailProvider implements EmailProvider {
  readonly name = "local";
  private readonly mailboxes = new Map<string, EmailMessage[]>();

  /**
   * Send an email — stores in recipient mailboxes.
   */
  async send(email: EmailMessage): Promise<SendResult> {
    const id = email.id || randomUUID();
    const stored: EmailMessage = { ...email, id };

    // Collect all recipients (to + cc + bcc)
    const allRecipients = [
      ...email.to,
      ...(email.cc ?? []),
      ...(email.bcc ?? []),
    ];

    if (allRecipients.length === 0) {
      return { success: false, error: "No recipients specified (to/cc/bcc empty)" };
    }

    for (const recipient of allRecipients) {
      const key = recipient.address.toLowerCase();
      const mailbox = this.mailboxes.get(key) ?? [];
      mailbox.push(structuredClone(stored));
      this.mailboxes.set(key, mailbox);
    }

    return { success: true, messageId: id };
  }

  /**
   * Read emails from a mailbox matching the query.
   */
  async read(query: EmailQuery): Promise<EmailMessage[]> {
    const mailbox = query.to
      ? this.mailboxes.get(query.to.toLowerCase()) ?? []
      : this.getAllEmails();

    return this.applyFilters(mailbox, query);
  }

  /**
   * Search emails with advanced filters (same as read for local provider).
   */
  async search(queryText: string, limit = 50): Promise<EmailMessage[]> {
    return this.read({ searchText: queryText, limit });
  }

  /**
   * Delete an email by ID from all mailboxes.
   */
  async delete(id: string): Promise<boolean> {
    let found = false;
    for (const [key, mailbox] of this.mailboxes) {
      const filtered = mailbox.filter((m) => m.id !== id);
      if (filtered.length < mailbox.length) {
        found = true;
        this.mailboxes.set(key, filtered);
      }
    }
    return found;
  }

  /**
   * Health check — always healthy for in-memory provider.
   */
  async health(): Promise<{ ok: boolean; details?: string }> {
    return {
      ok: true,
      details: `Local provider: ${this.mailboxes.size} mailbox(es), ${this.totalEmails()} email(s)`,
    };
  }

  /** Threads not supported by in-memory provider */
  async getThread(_threadId: string): Promise<null> {
    return null;
  }

  // ─── Private Helpers ──────────────────────────────────────────

  private getAllEmails(): EmailMessage[] {
    const seen = new Set<string>();
    const all: EmailMessage[] = [];
    for (const mailbox of this.mailboxes.values()) {
      for (const email of mailbox) {
        if (!seen.has(email.id)) {
          seen.add(email.id);
          all.push(email);
        }
      }
    }
    return all;
  }

  private applyFilters(
    emails: EmailMessage[],
    query: EmailQuery,
  ): EmailMessage[] {
    let result = [...emails];

    if (query.from) {
      const fromLower = query.from.toLowerCase();
      result = result.filter((m) =>
        m.from.address.toLowerCase().includes(fromLower),
      );
    }

    if (query.subject) {
      const subjLower = query.subject.toLowerCase();
      result = result.filter((m) =>
        m.subject.toLowerCase().includes(subjLower),
      );
    }

    if (query.since) {
      result = result.filter((m) => m.date >= query.since!);
    }

    if (query.until) {
      result = result.filter((m) => m.date <= query.until!);
    }

    if (query.limit !== undefined && query.limit >= 0) {
      result = result.slice(0, query.limit);
    }

    return result;
  }

  private totalEmails(): number {
    let count = 0;
    for (const mailbox of this.mailboxes.values()) {
      count += mailbox.length;
    }
    return count;
  }
}
