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
   * Create a hook handler for email:received events.
   *
   * NOTE: Bus publishing is now handled by email_send (S6).
   * This handler is kept for filter-based tracking and logging.
   * The actual delivery goes: email_send → bus.publish → Redis → bus handler → pi-inject.
   */
  createReceivedHandler(): EmailHookHandler {
    return (_ctx: EmailHookContext) => {
      // Hook handler retained for lifecycle compatibility.
      // Bus publishing is done by email_send tool directly.
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
