# Agent Mail/Messaging Systems — Comparative Analysis

> **Date**: 2026-05-24
> **Purpose**: Identify best practices from established agent communication frameworks to improve pi-email-integration
> **Scope**: Gas Town, AutoGen, OpenAI Agents, Google A2A, CrewAI, Microsoft Agent Framework, smolagents

## Frameworks Surveyed

| Framework | Stars | Messaging Pattern | Mail-like? | Key Innovation |
|-----------|-------|-------------------|------------|----------------|
| **Gas Town** | 15.5k | Work dispatch (Beads/Sling) | ⚠️ Partial | Per-rig workspace, Mayor/Crew model, Beads git-backed tasks |
| **AutoGen** (Microsoft) | 40k+ | Topic pub/sub + Direct RPC | ✅ Yes | 3-envelope system (Send/Publish/Response), InterventionHandler middleware, TypeSubscription |
| **OpenAI Agents** | 25k+ | Handoff (transfer_to_X) | ❌ No | HandoffInputFilter (sanitize history on transfer), agent-as-tool |
| **Google A2A** | 15k+ | JSON-RPC 2.0 over HTTP | ✅ Yes | Agent Card discovery, Task lifecycle (submitted→working→completed), SSE streaming, push notifications |
| **CrewAI** | 30k+ | Sequential/Hierarchical process | ⚠️ Partial | Role-based agents, manager delegation, Flows (event-driven workflows) |
| **Microsoft Agent Framework** | New | Event-driven + message bus | ✅ Yes | Successor to AutoGen, enterprise-grade |
| **smolagents** (HF) | 15k+ | Tool-calling only | ❌ No | Code-as-actions, no inter-agent messaging |
| **pi-intercom** | Local | Direct message + ask/reply | ✅ Yes | Session-to-session, real turn invocation |

---

## Pattern Analysis: What Each Does That We Don't

### 1. AutoGen — Envelope System + Intervention Middleware

**Pattern**: `SendMessageEnvelope`, `PublishMessageEnvelope`, `ResponseMessageEnvelope`

- **InterventionHandler**: Middleware that can intercept/modify messages BEFORE delivery
  - `on_send()`, `on_publish()`, `on_response()` hooks
  - Can transform, block, or redirect messages
- **TypeSubscription**: Subscribe to message TYPE, not just topic
  - `TypeSubscription("EmailMessage", "agent-id")`
  - `TypePrefixSubscription("email.", "agent-id")`
- **Cross-runtime**: Same API for local (in-process) and distributed (gRPC) runtimes
- **Source**: `autogen-core/_single_threaded_agent_runtime.py:57-94`

**⚠️ GAP IN OURS**: No middleware/interceptor layer for messages. Our hooks are post-hoc (fire after action). AutoGen's InterventionHandler is PRE-delivery — it can BLOCK or TRANSFORM a message before it reaches the mailbox.

### 2. Google A2A — Agent Card Discovery + Task Lifecycle

**Pattern**: Agent Card (capability manifest) + Task state machine

- **Agent Card**: JSON document describing agent capabilities, endpoints, auth
  - `{ name, description, url, capabilities: { streaming, pushNotifications }, skills: [...] }`
  - Enables DYNAMIC discovery — agents find each other at runtime
- **Task Lifecycle**: `submitted → working → input-required → completed/failed/canceled`
  - Each state transition is a well-defined event
  - Push notifications via webhook when state changes
- **Structured Data**: Parts can be `TextPart`, `FilePart` (with URI), or `DataPart` (structured JSON)
- **Protocol**: JSON-RPC 2.0 over HTTP(S), supports SSE streaming

**⚠️ GAP IN OURS**: No capability discovery. No formal task state machine. Our emails are fire-and-forget with no tracking of "did the recipient act on it".

### 3. OpenAI Agents — Handoff with History Filtering

**Pattern**: `transfer_to_<agent>()` tool + `HandoffInputFilter`

- **HandoffInputFilter**: Sanitizes conversation history before passing to next agent
  - Remove sensitive data, trim context, restructure
  - `HandoffInputData = { conversation_history, last_message }`
- **Agent-as-Tool**: One agent can CALL another agent as a function
  - Return value becomes part of calling agent's context
- **Source**: `agents/handoffs/__init__.py:42-84`

**⚠️ GAP IN OURS**: No history/context filtering when emails are read. When agent A sends to B, B sees raw content with no filtering options.

### 4. Gas Town — Beads + Sling Work Dispatch

**Pattern**: Git-backed issue tracking + dispatch engine

- **Beads**: Work items stored in Dolt (git-compatible SQL DB)
  - Each bead has full history, comments, status transitions
  - Git-native: bead changes are commits
- **Sling**: Dispatch engine that assigns beads to rigs (project workspaces)
  - Auto-creates "Convoys" for batch tracking
  - Merge strategies: `mr` (default), `direct`, `local`
- **Dog agents**: Cross-rig maintenance workers
  - Kennel at `~/gt/deacon/dogs/` with worktrees into EVERY rig
- **Source**: `internal/cmd/sling.go:39-51`

**⚠️ GAP IN OURS**: No work tracking. Our emails have no "status" beyond sent/read/deleted. No concept of "task created from email".

### 5. CrewAI — Role-Based Delegation + Flows

**Pattern**: Manager-coordinated hierarchical delegation

- **Hierarchical Process**: Manager agent assigns tasks to workers
  - Workers can delegate BACK to manager when stuck
  - Memory sharing between agents via execution context
- **Flows**: Event-driven state machine workflows
  - `@listen("event_name")` decorator for event handlers
  - State transitions with guards and conditions
- **Source**: `crewai/crew.py:136-172`

**⚠️ GAP IN OURS**: No role-based routing. No state machine for email processing. No "manager" concept for mail delegation.

---

## Best Practices We SHOULD Adopt

### CRITICAL (Adopt Now)

| # | Practice | Source | Our Gap | Implementation |
|---|----------|--------|---------|----------------|
| C1 | **Message middleware (pre-delivery hooks)** | AutoGen InterventionHandler | Our hooks fire AFTER action, can't intercept/transform | Add `beforeSend` middleware that can modify/block emails |
| C2 | **Delivery status tracking** | A2A Task Lifecycle | Emails are fire-and-forget, no tracking | Add `delivery_status` column: `sent → delivered → read → actioned` |
| C3 | **Message dedup idempotency** | AutoGen envelope IDs | No dedup on receive | Add `message_id` unique constraint + `dedup()` on receive |
| C4 | **Dead letter queue** | All enterprise systems | Failed deliveries silently lost | Add `dead_letters` table for undeliverable messages |

### HIGH (Adopt Soon)

| # | Practice | Source | Our Gap | Implementation |
|---|----------|--------|---------|----------------|
| H1 | **Priority queue** | Gas Town Sling | All emails equal priority | Add `priority` column (urgent/high/normal/low) |
| H2 | **Read receipts / acknowledgments** | Email standard | No way to know if recipient acted | Add `email_acknowledge` tool, track in DB |
| H3 | **Message TTL / expiry** | Enterprise messaging | Emails live forever | Add `expires_at` column, periodic cleanup |
| H4 | **Content filtering on read** | OpenAI HandoffInputFilter | No sanitization of email content | Add optional `readFilter: (email) => email` in config |
| H5 | **Batch operations** | Gas Town Convoys | One email at a time | Add `email_send_batch` tool, `email_read_batch` |
| H6 | **Rate limiting per mailbox** | All production systems | No protection against mailbombing | Add rate limits per sender/recipient pair |

### MEDIUM (Adopt Eventually)

| # | Practice | Source | Our Gap | Implementation |
|---|----------|--------|---------|----------------|
| M1 | **Capability discovery (Agent Cards)** | Google A2A | Agents can't discover what others support | Add `email_capabilities` tool to query mailbox capabilities |
| M2 | **Structured data parts** | A2A DataPart | Body is always text | Add `parts: [{type: "text"\|"data"\|"file", content}]` |
| M3 | **Thread branching** | Email standards | Linear threads only | Support fork threads (new thread from reply) |
| M4 | **Email templates** | Gas Town templates | Every email is hand-crafted | Template system with variables |
| M5 | **Scheduled sending** | Enterprise email | No delay/defer support | Add `send_at` parameter |
| M6 | **Cross-runtime serialization** | AutoGen | No wire format for distributed use | Add JSON-RPC envelope format |

---

## Architecture Recommendations

### 1. Add Message Middleware Layer (Critical — from AutoGen)

```
Before: send() → store → hooks (post-hoc)
After:  send() → beforeSend(middleware[]) → store → hooks (post-hoc)
```

Middleware can: transform content, add metadata, block delivery, redirect.
This mirrors AutoGen's InterventionHandler pattern.

### 2. Add Delivery Status Tracking (Critical — from A2A)

```
emails.status: draft → sent → delivered → read → actioned
emails.status_history: JSON array of {status, timestamp, actor}
```

This enables: "show me all emails awaiting response", "show unread", SLA tracking.

### 3. Add Dead Letter Queue (Critical — enterprise standard)

```
dead_letters table: {id, original_email_id, target, error, timestamp}
email_send returns: { delivered: string[], dead: string[] }
```

### 4. Add Priority + TTL (High — from Sling/enterprise)

```
emails.priority: 0 (low) → 3 (urgent)
emails.expires_at: nullable timestamp
read() sorts by priority DESC, expires_at ASC
```

### 5. Add Rate Limiting (High — production safety)

```
per-sender bucket: { limit: 100/minute, current: N, window_start: ts }
email_send checks bucket before proceeding
```

---

## What We Already Do Well (vs. These Frameworks)

| Feature | Our Implementation | Frameworks That Lack It |
|---------|-------------------|------------------------|
| **Persistent SQLite storage** | Full schema with FTS5 | CrewAI (in-memory), OpenAI (session-only) |
| **Origin tracking** | cwd, agent, session, git project per email | None track this level of detail |
| **Thread auto-detection** | In-Reply-To → reply vs new | A2A has no thread concept |
| **Hindsight routing hooks** | Configurable rules → banks | No framework has memory system integration |
| **Subscription push** | Intercom → real turn invocation | AutoGen has no push notification, A2A has webhook-only |
| **Full-text search** | FTS5 built-in | Most frameworks have no search at all |
| **CLI-native** | Designed for pi CLI agents | Most are Python library-only |
