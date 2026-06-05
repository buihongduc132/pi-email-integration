/**
 * Pi Session Injection — delivers email bus messages into pi sessions.
 *
 * Uses pi.sendMessage with triggerTurn: true, identical to pi-intercom's
 * delivery pattern. If the pi session is unavailable or sendMessage throws,
 * the injection is silently skipped (best-effort delivery).
 */

// ─── Types ──────────────────────────────────────────────────────

export interface BusPayload {
  type: string;
  messageId: string;
  subject: string;
  from: string;
  body: string;
  origin: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PiContext {
  sendMessage: (message: {
    customType: string;
    content: string;
    display: boolean;
    details: Record<string, unknown>;
  }, options?: {
    triggerTurn?: boolean;
    deliverAs?: "steer" | "followUp" | "nextTurn";
  }) => Promise<void>;
}

// ─── Formatting ─────────────────────────────────────────────────

const MAX_BODY_LENGTH = 500;

/**
 * Format a bus payload into a human-readable message for pi injection.
 */
export function formatEmailForInjection(channel: string, payload: BusPayload): string {
  const parts: string[] = [];

  parts.push(`📬 Email notification on ${channel}`);
  parts.push("");

  if (payload.messageId) {
    parts.push(`Message-ID: ${payload.messageId}`);
  }

  if (payload.from) {
    parts.push(`From: ${payload.from}`);
  }

  if (payload.subject) {
    parts.push(`Subject: ${payload.subject}`);
  }

  if (payload.body) {
    const truncated = payload.body.length > MAX_BODY_LENGTH
      ? payload.body.slice(0, MAX_BODY_LENGTH) + "..."
      : payload.body;
    parts.push("");
    parts.push(truncated);
  }

  return parts.join("\n");
}

// ─── Injection ──────────────────────────────────────────────────

/**
 * Inject an email bus message into the pi session.
 *
 * Best-effort: if pi context is unavailable or sendMessage throws,
 * the injection is silently skipped.
 */
export async function injectEmailMessage(
  pi: PiContext,
  channel: string,
  payload: BusPayload,
): Promise<void> {
  if (!pi?.sendMessage) {
    return;
  }

  try {
    const content = formatEmailForInjection(channel, payload);

    await pi.sendMessage(
      {
        customType: "email_bus_message",
        content,
        display: true,
        details: {
          channel,
          payload,
          from: payload.from,
        },
      },
      { triggerTurn: true },
    );
  } catch {
    // Best-effort — session may be closed, agent may be shutting down
  }
}
