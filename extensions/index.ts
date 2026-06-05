/**
 * pi-email-integration — Main Extension Entry Point
 *
 * Persistent SQLite email storage with thread detection, enriched origin
 * tracking, FTS5 search, Hindsight hooks, 5 tools.
 *
 * Phase 1: Local-only with SQLite persistence
 * Phase 2 (DEFERRED): Real mail adapters (Gmail, Outlook, IMAP)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { EmailDatabase } from "../src/db/database.js";
import { SqliteEmailProvider } from "../src/providers/sqlite-provider.js";
import { OriginTracker } from "../src/origin/tracker.js";
import { RoutingEngine } from "../src/hooks/routing-engine.js";
import { HookManager } from "../src/hooks/hook-manager.js";
import { MailboxSubscription } from "../src/subscription/mailbox-subscription.js";
import { createMessageBus } from "../src/pubsub/bus.js";
import type { EmailConfig, EmailHookContext, EmailMessage } from "../src/types.js";

const DEFAULT_CONFIG: EmailConfig = {
  provider: "local",
  hindsight: { enabled: false, rules: [] },
  originDefaults: { cliAgent: "pi", customFields: {} },
  server: { port: 1025, hostname: "localhost" },
  dbPath: join(homedir(), ".pi", "email.db"),
};

export default function (pi: ExtensionAPI): void {
  const config = loadConfig();

  // Ensure DB directory exists
  const dbPath = config.dbPath ?? DEFAULT_CONFIG.dbPath!;
  const dbDir = join(dbPath, "..");
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

  const db = new EmailDatabase({ dbPath });
  const provider = new SqliteEmailProvider(db);
  const originTracker = new OriginTracker({
    defaultAgent: config.originDefaults.cliAgent,
    defaultCustomFields: config.originDefaults.customFields,
  });
  const routingEngine = new RoutingEngine(config.hindsight);
  const hookManager = new HookManager();
  const bus = createMessageBus();
  const mailboxSub = new MailboxSubscription(bus, pi);

  // Register subscription handler as a lifecycle hook
  hookManager.on("email:received", mailboxSub.createReceivedHandler());

  function fireHook(ctx: EmailHookContext): void {
    hookManager.fire(ctx).catch((err) => {
      console.error("[pi-email-integration] hook fire error:", err);
    });
  }

  // ─── email_send ──────────────────────────────────────────────

  pi.registerTool({
    name: "email_send",
    label: "Email Send",
    description: "Send an email. Supports replies via inReplyTo. Auto-detects thread. Fires hooks.",
    promptSnippet: "email_send — send or reply to an email",
    parameters: {
      type: "object",
      properties: {
        to: { type: "array", items: { type: "string" }, description: "Recipients (at least one)" },
        subject: { type: "string", description: "Subject" },
        body: { type: "string", description: "Body (plain text)" },
        from: { type: "string", description: "Sender (default: agent@local)" },
        cc: { type: "array", items: { type: "string" }, description: "CC" },
        bcc: { type: "array", items: { type: "string" }, description: "BCC" },
        inReplyTo: { type: "string", description: "Email ID to reply to (sets action=reply)" },
      },
      required: ["to", "subject", "body"],
    },
    async execute(_toolCallId, params) {
      const toAddresses = params.to as string[];
      if (!toAddresses || toAddresses.length === 0) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "At least one recipient required" }) }], details: {} as Record<string, unknown> };
      }

      const origin = originTracker.capture();
      const sender = (params.from as string) || `${config.originDefaults.cliAgent}@local`;
      const inReplyTo = params.inReplyTo as string | undefined;

      const email: EmailMessage = {
        id: randomUUID(),
        action: inReplyTo ? "reply" : "new",
        from: { address: sender },
        to: toAddresses.map((a: string) => ({ address: a })),
        cc: (params.cc as string[] | undefined)?.map((a: string) => ({ address: a })),
        bcc: (params.bcc as string[] | undefined)?.map((a: string) => ({ address: a })),
        subject: params.subject as string,
        body: params.body as string,
        headers: inReplyTo ? { "In-Reply-To": inReplyTo } : {},
        date: new Date(),
        origin,
      };

      if (inReplyTo) email.parentId = inReplyTo;

      const result = await provider.send(email);

      if (!result.success) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: result.error }) }], details: {} as Record<string, unknown> };
      }

      const routing = routingEngine.route(origin);

      for (const r of email.to) fireHook({ event: "email:received", email, timestamp: new Date() });
      if (routing.routed) fireHook({ event: "email:routed", email, timestamp: new Date(), routing: { bank: routing.bank ?? "default", tags: routing.tags, matchedRule: routing.matchedRuleId } });
      fireHook({ event: "email:sent", email, timestamp: new Date(), routing: routing.routed ? { bank: routing.bank ?? "default", tags: routing.tags, matchedRule: routing.matchedRuleId } : undefined });

      // Wire to bus — publish notification for each recipient after successful send (S6)
      const allRecipients = [...email.to, ...(email.cc ?? []), ...(email.bcc ?? [])];
      for (const recipient of allRecipients) {
        const channel = `email:inbox:${recipient.address.toLowerCase()}`;
        bus.publish(channel, {
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
        }).catch(() => {
          // Bus publish failed — graceful degradation
        });
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: true, messageId: result.messageId, threadId: result.threadId, action: result.action, origin: { cwd: origin.cwd, agent: origin.cliAgent, gitProject: origin.gitProject } }) }],
        details: { success: true, messageId: result.messageId, threadId: result.threadId, action: result.action },
      };
    },
  });

  // ─── email_read ──────────────────────────────────────────────

  pi.registerTool({
    name: "email_read",
    label: "Email Read",
    description: "Read emails with filtering. Returns body + origin + thread info.",
    promptSnippet: "email_read — read emails",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Mailbox to read" },
        from: { type: "string", description: "Filter by sender" },
        subject: { type: "string", description: "Filter by subject" },
        threadId: { type: "string", description: "Filter by thread" },
        action: { type: "string", description: "Filter: new/reply/forward" },
        since: { type: "string", description: "ISO date: after" },
        until: { type: "string", description: "ISO date: before" },
        limit: { type: "number", description: "Max results" },
      },
    },
    async execute(_toolCallId, params) {
      const emails = await provider.read({
        to: params.to as string | undefined,
        from: params.from as string | undefined,
        subject: params.subject as string | undefined,
        threadId: params.threadId as string | undefined,
        action: params.action as "new" | "reply" | "forward" | undefined,
        since: params.since ? new Date(params.since as string) : undefined,
        until: params.until ? new Date(params.until as string) : undefined,
        limit: params.limit as number | undefined,
      });

      for (const e of emails) fireHook({ event: "email:read", email: e, timestamp: new Date() });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(emails.map((e) => ({ id: e.id, threadId: e.threadId, action: e.action, from: e.from.address, to: e.to.map((r) => r.address), subject: e.subject, body: e.body, date: e.date.toISOString(), origin: { cwd: e.origin.cwd, agent: e.origin.cliAgent, session: e.origin.sessionId, gitProject: e.origin.gitProject } }))) }],
        details: { count: emails.length },
      };
    },
  });

  // ─── email_search ────────────────────────────────────────────

  pi.registerTool({
    name: "email_search",
    label: "Email Search",
    description: "Full-text search across email subjects and bodies.",
    promptSnippet: "email_search — search emails by content",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (FTS5 syntax)" },
        limit: { type: "number", description: "Max results (default 20)" },
      },
      required: ["query"],
    },
    async execute(_toolCallId, params) {
      const query = params.query as string;
      const limit = (params.limit as number) || 20;
      const emails = await provider.search(query, limit);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(emails.map((e) => ({ id: e.id, threadId: e.threadId, from: e.from.address, subject: e.subject, body: e.body.substring(0, 200), date: e.date.toISOString() }))) }],
        details: { count: emails.length, query },
      };
    },
  });

  // ─── email_subscribe ──────────────────────────────────────

  pi.registerTool({
    name: "email_subscribe",
    label: "Email Subscribe",
    description: "Subscribe this session to a mailbox. You'll receive bus notifications when emails arrive.",
    promptSnippet: "email_subscribe — subscribe to mailbox notifications",
    parameters: {
      type: "object",
      properties: {
        mailbox: { type: "string", description: "Mailbox address to subscribe to (default: your session name)" },
        sessionName: { type: "string", description: "Your session name (auto-detected from PI_SESSION_NAME)" },
      },
    },
    async execute(_toolCallId, params) {
      const mailbox = (params.mailbox as string) || process.env.PI_SESSION_ID || "default@local";
      const sessionName = (params.sessionName as string) || process.env.PI_SESSION_NAME || "unknown";

      mailboxSub.subscribe(mailbox, sessionName);

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ subscribed: true, mailbox, sessionName }) }],
        details: { subscribed: true, mailbox, sessionName },
      };
    },
  });

  // ─── email_delete ────────────────────────────────────────────

  pi.registerTool({
    name: "email_delete",
    label: "Email Delete",
    description: "Delete an email by ID.",
    promptSnippet: "email_delete — delete email",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Email ID" } },
      required: ["id"],
    },
    async execute(_toolCallId, params) {
      const id = params.id as string;
      // Fetch before delete for hook data
      const [found] = await provider.read({ threadId: undefined, limit: 1 });
      const allEmails = await provider.read({ limit: 10000 });
      const emailToDelete = allEmails.find((e) => e.id === id);

      const deleted = await provider.delete(id);

      if (deleted && emailToDelete) {
        fireHook({ event: "email:deleted", email: emailToDelete, timestamp: new Date() });
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: deleted, id }) }],
        details: { success: deleted, id },
      };
    },
  });

  // ─── email_health ────────────────────────────────────────────

  pi.registerTool({
    name: "email_health",
    label: "Email Health",
    description: "Check email system health.",
    promptSnippet: "email_health — system status",
    parameters: { type: "object", properties: {} },
    async execute() {
      const health = await provider.health();
      return { content: [{ type: "text" as const, text: JSON.stringify(health) }], details: health };
    },
  });
}

function loadConfig(): EmailConfig {
  return DEFAULT_CONFIG;
}
