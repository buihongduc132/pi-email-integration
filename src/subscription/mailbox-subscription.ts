/**
 * Mailbox Subscription — push notification via intercom.
 *
 * A session subscribes to a mailbox (default: its session name/ID).
 * When an email lands in that mailbox, the subscription handler sends
 * an intercom message to the subscribed session — invoking a real turn
 * (not silent).
 *
 * Usage:
 *   const sub = new MailboxSubscription();
 *   sub.subscribe("alice@local", "my-session-name");
 *   // When email arrives for alice@local → intercom "send" to "my-session-name"
 */

import type { EmailHookContext, EmailHookHandler } from "../types.js";

export interface Subscription {
  /** Mailbox address to watch */
  mailbox: string;
  /** Intercom session name to notify */
  sessionName: string;
  /** Optional filter: only notify if condition matches */
  filter?: (ctx: EmailHookContext) => boolean;
}

export class MailboxSubscription {
  private readonly subscriptions = new Map<string, Subscription[]>();

  /**
   * Subscribe a session to a mailbox.
   * When email arrives at mailbox, intercom sends to sessionName.
   */
  subscribe(mailbox: string, sessionName: string, filter?: (ctx: EmailHookContext) => boolean): void {
    const key = mailbox.toLowerCase();
    const existing = this.subscriptions.get(key) ?? [];
    // Avoid duplicate subscriptions
    if (existing.some((s) => s.sessionName === sessionName)) {
      return;
    }
    existing.push({ mailbox: key, sessionName, filter });
    this.subscriptions.set(key, existing);
  }

  /**
   * Unsubscribe a session from a mailbox.
   */
  unsubscribe(mailbox: string, sessionName: string): void {
    const key = mailbox.toLowerCase();
    const existing = this.subscriptions.get(key);
    if (!existing) return;
    const filtered = existing.filter((s) => s.sessionName !== sessionName);
    if (filtered.length === 0) {
      this.subscriptions.delete(key);
    } else {
      this.subscriptions.set(key, filtered);
    }
  }

  /**
   * Get all subscriptions for a mailbox.
   */
  getSubscriptions(mailbox: string): Subscription[] {
    return this.subscriptions.get(mailbox.toLowerCase()) ?? [];
  }

  /**
   * Get all subscriptions across all mailboxes.
   */
  getAllSubscriptions(): Subscription[] {
    const all: Subscription[] = [];
    for (const subs of this.subscriptions.values()) {
      all.push(...subs);
    }
    return all;
  }

  /**
   * Create a hook handler that checks subscriptions and sends intercom messages.
   *
   * This is the "push notification" mechanism — when email:received fires,
   * this handler checks if the recipient's mailbox has subscribers and sends
   * an intercom message to each, invoking a real turn.
   */
  createReceivedHandler(): EmailHookHandler {
    return (ctx: EmailHookContext) => {
      if (ctx.event !== "email:received") return;

      const email = ctx.email;
      const allRecipients = [
        ...email.to,
        ...(email.cc ?? []),
        ...(email.bcc ?? []),
      ];

      for (const recipient of allRecipients) {
        const subs = this.getSubscriptions(recipient.address);
        for (const sub of subs) {
          // Apply filter if present
          if (sub.filter && !sub.filter(ctx)) continue;

          // Build notification payload
          const notification = {
            type: "email-notification",
            mailbox: recipient.address,
            email: {
              id: email.id,
              threadId: email.threadId,
              action: email.action,
              from: email.from.address,
              subject: email.subject,
              body: email.body.substring(0, 500),
              date: email.date.toISOString(),
              origin: {
                cwd: email.origin.cwd,
                agent: email.origin.cliAgent,
                session: email.origin.sessionId,
                gitProject: email.origin.gitProject,
              },
            },
          };

          // Use intercom to send — this invokes a real turn in the target session
          // The import is deferred to avoid circular deps at module level
          try {
            // Dynamic require — avoids compile-time dependency
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const piIntercom = require("pi-intercom");
            if (typeof piIntercom?.intercom === "function") {
              piIntercom.intercom({
                action: "send",
                to: sub.sessionName,
                message: `📧 New email in ${recipient.address}:\n${JSON.stringify(notification, null, 2)}`,
              });
            }
          } catch {
            // Intercom not available (e.g. test environment) — skip silently
          }
        }
      }
    };
  }
}
