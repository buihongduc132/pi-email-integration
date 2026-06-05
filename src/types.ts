/**
 * Email Integration — Core Types & Interfaces
 *
 * Persistent email storage with origin tracking, thread detection,
 * Hindsight hooks, and full-text search.
 * Real mail adapters (Gmail, Outlook, etc.) are DEFERRED — see docs/DEFERRED.md
 */

// ─── Email Message ──────────────────────────────────────────────

export interface EmailAddress {
  name?: string;
  address: string;
}

/** Email action type — how this email relates to the thread */
export type EmailAction = "new" | "reply" | "forward";

export interface EmailMessage {
  id: string;
  /** Thread this email belongs to (auto-detected) */
  threadId?: string;
  /** Parent email ID (for replies — null = new thread) */
  parentId?: string;
  /** Auto-detected action: 'new' for new threads, 'reply' for replies, 'forward' for forwards */
  action: EmailAction;
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  body: string;
  html?: string;
  headers: Record<string, string>;
  attachments?: EmailAttachment[];
  date: Date;
  /** Origin metadata — automatically populated by OriginTracker */
  origin: EmailOrigin;
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer | string;
}

// ─── Origin Tracking (Enriched) ─────────────────────────────────

export interface EmailOrigin {
  /** Current working directory when the email was created/received */
  cwd: string;
  /** CLI agent that produced this email (default: "pi") */
  cliAgent: string;
  /** Pi session ID */
  sessionId?: string;
  /** Pi session title */
  sessionTitle?: string;
  /** Session working directory (may differ from cwd if agent changed dir) */
  sessionCwd?: string;
  /** Git project name (extracted from cwd) */
  gitProject?: string;
  /** Custom metadata — extensible by user config */
  custom: Record<string, unknown>;
  /** Timestamp of origin capture */
  timestamp: Date;
}

// ─── Thread / Conversation ──────────────────────────────────────

export interface EmailThread {
  id: string;
  subject: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}

// ─── Email Provider Interface ───────────────────────────────────

export interface EmailQuery {
  from?: string;
  to?: string;
  subject?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  /** Thread ID to filter by */
  threadId?: string;
  /** Action filter */
  action?: EmailAction;
  /** Full-text search query */
  searchText?: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  threadId?: string;
  action?: EmailAction;
  error?: string;
}

export interface EmailProvider {
  readonly name: string;

  /** Send an email — auto-detects thread and action */
  send(email: EmailMessage): Promise<SendResult>;

  /** Read emails matching query */
  read(query: EmailQuery): Promise<EmailMessage[]>;

  /** Full-text search on subject + body */
  search(query: string, limit?: number): Promise<EmailMessage[]>;

  /** Delete an email by ID */
  delete(id: string): Promise<boolean>;

  /** Get a thread by ID */
  getThread(threadId: string): Promise<EmailThread | null>;

  /** Health check */
  health(): Promise<{ ok: boolean; details?: string }>;
}

// ─── Hindsight Integration Hooks ────────────────────────────────

export interface RoutingRule {
  /** Unique rule ID */
  id: string;
  /** Human-readable description */
  description?: string;
  /** Condition evaluator — receives origin context, returns true if rule matches */
  condition: (origin: EmailOrigin) => boolean;
  /** Target Hindsight bank to route to */
  targetBank: string;
  /** Tags to apply */
  tags: string[];
  /** Priority (higher = evaluated first) */
  priority: number;
}

export interface HindsightHookConfig {
  /** Enable/disable Hindsight integration (default: false) */
  enabled: boolean;
  /** Default bank when no rule matches */
  defaultBank?: string;
  /** Routing rules — evaluated in priority order */
  rules: RoutingRule[];
}

// ─── Hook Events ────────────────────────────────────────────────

export type EmailHookEvent =
  | "email:received"
  | "email:sent"
  | "email:read"
  | "email:deleted"
  | "email:routed";

export interface EmailHookContext {
  event: EmailHookEvent;
  email: EmailMessage;
  timestamp: Date;
  /** Routing decision (if applicable) */
  routing?: {
    bank: string;
    tags: string[];
    matchedRule?: string;
  };
}

export type EmailHookHandler = (
  ctx: EmailHookContext,
) => void | Promise<void>;

// ─── Configuration ──────────────────────────────────────────────

export interface EmailConfig {
  /** Provider type: "local" | DEFERRED: "gmail" | "outlook" | "imap" */
  provider: "local";
  /** Hindsight integration config */
  hindsight: HindsightHookConfig;
  /** Origin tracking defaults */
  originDefaults: {
    cliAgent: string;
    customFields: Record<string, unknown>;
  };
  /** Mail server settings (for local provider) */
  server: {
    port: number;
    hostname: string;
  };
  /** Database path (default: ~/.pi/email.db) */
  dbPath?: string;
}
