/**
 * Structured Logger — pub/sub operation logging.
 *
 * Outputs structured entries for: PUB, SUB, RECV, ERR.
 * Each entry is machine-parseable AND human-readable.
 *
 * Format:
 *   [email-bus] PUB  email:inbox:alice@local  msg=abc123  size=1.2kb  subs=3  latency=0.4ms
 *   [email-bus] SUB  email:sent               handler=onMailSent  total_subs=5
 *   [email-bus] RECV email:inbox:alice@local  msg=abc123  from=pi-session-worker-1a2b
 *   [email-bus] ERR  email:inbox:alice@local  msg=def456  error=connection reset
 */

// ─── Types ──────────────────────────────────────────────────────

export type LogEventType = "PUB" | "SUB" | "RECV" | "ERR";

export interface LogEntry {
  event: LogEventType;
  channel: string;
  messageId?: string;
  /** PUB fields */
  size?: number;
  subscribers?: number;
  latencyMs?: number;
  /** SUB fields */
  handler?: string;
  totalSubscribers?: number;
  /** RECV fields */
  from?: string;
  /** ERR fields */
  error?: string;
  /** Timestamp */
  timestamp: string;
}

export interface LogSink {
  (entry: LogEntry): void;
}

export interface BusLogger {
  logPublish(params: Omit<LogEntry, "event" | "timestamp"> & { channel: string; messageId?: string }): void;
  logSubscribe(params: Omit<LogEntry, "event" | "timestamp"> & { channel: string }): void;
  logReceive(params: Omit<LogEntry, "event" | "timestamp"> & { channel: string }): void;
  logError(params: Omit<LogEntry, "event" | "timestamp"> & { channel: string }): void;
  formatEntry(entry: LogEntry): string;
}

// ─── Implementation ─────────────────────────────────────────────

export function createBusLogger(sink?: LogSink): BusLogger {
  const logSink = sink ?? defaultConsoleSink();

  function makeEntry(event: LogEventType, params: Record<string, unknown>): LogEntry {
    return {
      event,
      channel: params.channel as string,
      messageId: params.messageId as string | undefined,
      size: params.size as number | undefined,
      subscribers: params.subscribers as number | undefined,
      latencyMs: params.latencyMs as number | undefined,
      handler: params.handler as string | undefined,
      totalSubscribers: params.totalSubscribers as number | undefined,
      from: params.from as string | undefined,
      error: params.error as string | undefined,
      timestamp: new Date().toISOString(),
    };
  }

  return {
    logPublish(params) {
      const entry = makeEntry("PUB", params);
      logSink(entry);
    },

    logSubscribe(params) {
      const entry = makeEntry("SUB", params);
      logSink(entry);
    },

    logReceive(params) {
      const entry = makeEntry("RECV", params);
      logSink(entry);
    },

    logError(params) {
      const entry = makeEntry("ERR", params);
      logSink(entry);
    },

    formatEntry(entry: LogEntry): string {
      const parts = [`[email-bus] ${entry.event}  ${entry.channel}`];

      if (entry.messageId) {
        parts.push(`msg=${entry.messageId}`);
      }

      if (entry.size !== undefined) {
        const sizeStr = entry.size >= 1024
          ? `${(entry.size / 1024).toFixed(1)}kb`
          : `${entry.size}b`;
        parts.push(`size=${sizeStr}`);
      }

      if (entry.subscribers !== undefined) {
        parts.push(`subs=${entry.subscribers}`);
      }

      if (entry.latencyMs !== undefined) {
        parts.push(`latency=${entry.latencyMs}ms`);
      }

      if (entry.handler) {
        parts.push(`handler=${entry.handler}`);
      }

      if (entry.totalSubscribers !== undefined) {
        parts.push(`total_subs=${entry.totalSubscribers}`);
      }

      if (entry.from) {
        parts.push(`from=${entry.from}`);
      }

      if (entry.error) {
        parts.push(`error=${entry.error}`);
      }

      return parts.join("  ");
    },
  };
}

function defaultConsoleSink(): LogSink {
  return (entry: LogEntry) => {
    const formatted = createBusLogger().formatEntry(entry);
    if (entry.event === "ERR") {
      console.error(formatted);
    } else {
      console.log(formatted);
    }
  };
}
