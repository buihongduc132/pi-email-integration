/**
 * Message Bus — Redis pub/sub backbone for email notifications.
 *
 * Two ioredis connections: one for publishing, one for subscribing.
 * Graceful degradation: if Redis is unavailable, operations return
 * failure results without crashing.
 *
 * Channel naming:
 *   email:inbox:{mailbox}  → new mail in a specific mailbox
 *   email:sent             → any mail sent notification
 *   email:system           → system events (health, errors)
 */

import Ioredis from "ioredis";
import type { Redis as RedisType } from "ioredis";

// ─── Types ──────────────────────────────────────────────────────

export interface BusPayload {
  type: string;
  messageId: string;
  subject: string;
  from: string;
  body: string;
  origin: Record<string, unknown>;
  /** Extra metadata */
  [key: string]: unknown;
}

export interface PublishResult {
  success: boolean;
  /** Number of subscribers that received the message (Redis PUBSUB NUMSUB) */
  subscribers?: number;
  error?: string;
}

export interface ChannelInfo {
  name: string;
  subscribers: number;
}

export type MessageHandler = (channel: string, payload: BusPayload) => void;

export interface MessageBus {
  publish(channel: string, payload: BusPayload): Promise<PublishResult>;
  subscribe(channel: string, handler: MessageHandler): Promise<void>;
  unsubscribe(channel: string, handler?: MessageHandler): Promise<void>;
  channels(): Promise<ChannelInfo[]>;
  send(to: string, payload: BusPayload): Promise<PublishResult>;
  close(): Promise<void>;
}

export interface BusOptions {
  /** Redis URL (default: redis://localhost:6379) */
  url?: string;
  /** Optional prefix for all channels */
  channelPrefix?: string;
}

// ─── Implementation ─────────────────────────────────────────────

export function createMessageBus(options?: BusOptions): MessageBus {
  const url = options?.url ?? "redis://localhost:6379";
  const prefix = options?.channelPrefix ?? "";

  // Lazy connections — only connect when first used
  let publisher: RedisType | null = null;
  let subscriber: RedisType | null = null;
  let connected = false;
  let connectionError: string | null = null;

  // Handler registry: channel → Set of handlers
  const handlerMap = new Map<string, Set<MessageHandler>>();

  async function ensureConnection(): Promise<boolean> {
    if (connected) return true;
    if (connectionError) return false;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      publisher = new (Ioredis as any)(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        retryStrategy: () => null, // No auto-retry
      }) as RedisType;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      subscriber = new (Ioredis as any)(url, {
        lazyConnect: true,
        maxRetriesPerRequest: null, // Subscriber needs persistent connection
        connectTimeout: 2000,
        retryStrategy: () => null,
      }) as RedisType;

      await Promise.all([publisher!.connect(), subscriber!.connect()]);

      // Set up message forwarding from subscriber to handlers
      subscriber!.on("message", (channel: string, message: string) => {
        const handlers = handlerMap.get(channel);
        if (!handlers) return;

        let payload: BusPayload;
        try {
          payload = JSON.parse(message);
        } catch {
          return; // Malformed payload — skip
        }

        for (const handler of handlers) {
          try {
            handler(channel, payload);
          } catch {
            // Handler error — skip, don't crash the bus
          }
        }
      });

      connected = true;
      return true;
    } catch (err) {
      connectionError = (err as Error).message ?? "Connection failed";
      // Clean up failed connections
      try { publisher?.disconnect(); } catch { /* ignore */ }
      try { subscriber?.disconnect(); } catch { /* ignore */ }
      publisher = null;
      subscriber = null;
      return false;
    }
  }

  return {
    async publish(channel: string, payload: BusPayload): Promise<PublishResult> {
      const ok = await ensureConnection();
      if (!ok || !publisher) {
        return { success: false, error: connectionError ?? "Not connected" };
      }

      try {
        const fullChannel = prefix + channel;
        const message = JSON.stringify(payload);
        const receivers = await publisher.publish(fullChannel, message);
        return { success: true, subscribers: receivers };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },

    async subscribe(channel: string, handler: MessageHandler): Promise<void> {
      const fullChannel = prefix + channel;

      // Register handler locally
      let handlers = handlerMap.get(fullChannel);
      if (!handlers) {
        handlers = new Set();
        handlerMap.set(fullChannel, handlers);
      }
      handlers.add(handler);

      const ok = await ensureConnection();
      if (!ok || !subscriber) {
        // Handler registered locally but Redis subscription failed — graceful
        return;
      }

      try {
        await subscriber.subscribe(fullChannel);
      } catch {
        // Subscription failed — handler still in local registry for when Redis recovers
      }
    },

    async unsubscribe(channel: string, handler?: MessageHandler): Promise<void> {
      const fullChannel = prefix + channel;

      if (handler) {
        const handlers = handlerMap.get(fullChannel);
        if (handlers) {
          handlers.delete(handler);
          if (handlers.size === 0) {
            handlerMap.delete(fullChannel);
          }
        }
      } else {
        handlerMap.delete(fullChannel);
      }

      // If no handlers left for this channel, unsubscribe from Redis
      const handlers = handlerMap.get(fullChannel);
      if (!handlers || handlers.size === 0) {
        try {
          await subscriber?.unsubscribe(fullChannel);
        } catch {
          // Ignore — Redis may be down
        }
      }
    },

    async channels(): Promise<ChannelInfo[]> {
      const ok = await ensureConnection();
      if (!ok || !publisher) {
        return [];
      }

      try {
        // Get all channels matching our prefix
        const activeChannels = await publisher!.pubsub("CHANNELS", prefix + "email:") as unknown as string[];
        const result: ChannelInfo[] = [];

        for (const ch of activeChannels) {
          const subs = await publisher!.pubsub("NUMSUB", ch) as unknown as [string, number];
          const count = subs[1] ?? 0;
          // Strip prefix for external consumption
          const name = prefix ? (ch as string).slice(prefix.length) : ch;
          result.push({ name, subscribers: count });
        }

        return result;
      } catch {
        return [];
      }
    },

    async send(to: string, payload: BusPayload): Promise<PublishResult> {
      // Direct send = publish to a session-specific channel
      return this.publish(`email:direct:${to}`, payload);
    },

    async close(): Promise<void> {
      handlerMap.clear();

      try {
        if (subscriber) {
          subscriber.disconnect();
        }
      } catch { /* ignore */ }

      try {
        if (publisher) {
          publisher.disconnect();
        }
      } catch { /* ignore */ }

      publisher = null;
      subscriber = null;
      connected = false;
      connectionError = null;
    },
  };
}
