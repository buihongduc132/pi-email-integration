/**
 * Mailbox Subscription — bus-based push notification.
 *
 * A session subscribes to a mailbox. When an email lands in that mailbox:
 *   hook fires → bus.publish("email:inbox:{mailbox}", payload) →
 *   Redis fans out → subscriber handler → pi.sendMessage({ triggerTurn: true })
 *
 * The old intercom-based delivery code has been completely removed.
 * Delivery now goes through the Redis message bus.
 */

import type { EmailHookContext, EmailHookHandler } from "../types.js";
import type { MessageBus, BusPayload } from "../pubsub/bus.js";
import type { PiContext } from "../delivery/pi-inject.js";
import { injectEmailMessage } from "../delivery/pi-inject.js";

export interface Subscription {
  /** Mailbox address to watch */
  mailbox: string;
  /** Session name to notify */
  sessionName: string;
  /** Optional filter: only notify if condition matches */
  filter?: (ctx: EmailHookContext) => boolean;
}

export class MailboxSubscription {
  private readonly subscriptions = new Map<string, Subscription[]>();
  /** Track which channels we've already subscribed to on the bus */
  private readonly busChannels = new Set<string>();
  private readonly bus: MessageBus | null;
  private readonly pi: PiContext | null;

  constructor(bus: MessageBus | null, pi: PiContext | null) {
    this.bus = bus;
    this.pi = pi;
  }

  /**
   * Subscribe a session to a mailbox.
   * Registers a bus handler that calls pi-inject when messages arrive.
   */
  subscribe(
    mailbox: string,
    sessionName: string,
    filter?: (ctx: EmailHookContext) => boolean,
  ): void {
    const key = mailbox.toLowerCase();
    const existing = this.subscriptions.get(key) ?? [];

    // Avoid duplicate subscriptions
    if (existing.some((s) => s.sessionName === sessionName)) {
      return;
    }

    existing.push({ mailbox: key, sessionName, filter });
    this.subscriptions.set(key, existing);

    // Register bus subscription for this channel (once per channel)
    const busChannel = `email:inbox:${key}`;
    if (!this.busChannels.has(busChannel) && this.bus) {
      this.busChannels.add(busChannel);
      this.bus.subscribe(busChannel, (channel: string, payload: BusPayload) => {
        this.handleBusMessage(channel, payload);
      }).catch(() => {
        // Bus subscription failed — graceful degradation
      });
    }
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
      // Unsubscribe from bus if no more subscribers for this mailbox
      const busChannel = `email:inbox:${key}`;
      if (this.busChannels.has(busChannel) && this.bus) {
        this.busChannels.delete(busChannel);
        this.bus.unsubscribe(busChannel).catch(() => {
          // Bus unsubscribe failed — graceful degradation
        });
      }
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
   * Create a hook handler that publishes to the bus when email is received.
   *
   * Flow: hook fires → bus.publish → Redis fans out → handler → pi-inject
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
        if (subs.length === 0) continue;

        // Check if any subscriber's filter passes
        const hasActiveSubscriber = subs.some(
          (sub) => !sub.filter || sub.filter(ctx),
        );
        if (!hasActiveSubscriber) continue;

        // Build and publish bus payload
        const payload: BusPayload = {
          type: "email:received",
          messageId: email.id,
          subject: email.subject,
          from: email.from.address,
          body: email.body.substring(0, 500),
          origin: {
            cwd: email.origin.cwd,
            agent: email.origin.cliAgent,
            session: email.origin.sessionId,
            gitProject: email.origin.gitProject,
          },
        };

        const channel = `email:inbox:${recipient.address.toLowerCase()}`;

        if (this.bus) {
          this.bus.publish(channel, payload).catch(() => {
            // Bus publish failed — graceful degradation
          });
        }
      }
    };
  }

  /**
   * Handle a bus message — inject into pi session for each matching subscriber.
   */
  private async handleBusMessage(channel: string, payload: BusPayload): Promise<void> {
    if (!this.pi) return;

    // Extract mailbox from channel: "email:inbox:{mailbox}"
    const mailbox = channel.replace("email:inbox:", "");
    const subs = this.getSubscriptions(mailbox);

    for (const sub of subs) {
      // Best-effort injection for each subscriber
      await injectEmailMessage(this.pi, channel, payload).catch(() => {
        // Injection failed — skip this subscriber
      });
    }
  }
}
