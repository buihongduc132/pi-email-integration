# @buihongduc132/pi-email-integration

Email integration for [pi coding agent](https://github.com/mariozechner/pi-coding-agent) multi-agent systems — persistent SQLite storage, origin tracking, pub/sub bus, and optional Hindsight hooks.

## Installation

```bash
pi install @buihongduc132/pi-email-integration
```

Or add to your `settings.json`:

```json
{
  "packages": [
    "https://github.com/buihongduc132/pi-email-integration"
  ]
}
```

## Usage

Once installed, the extension registers email tools that allow agent-to-agent communication via a local SQLite-backed mail system. Every email automatically captures origin metadata (working directory, CLI agent, session ID, git project).

### Tools

| Tool | Description |
|------|-------------|
| `email_send` | Send an email. Supports replies via `inReplyTo`. Auto-detects threads. Origin tracked. |
| `email_read` | Read emails with filtering (by recipient, sender, subject, thread, date range). |
| `email_search` | Full-text search across email subjects and bodies (FTS5). |
| `email_subscribe` | Subscribe this session to a mailbox for real-time notifications. |
| `email_delete` | Delete an email by ID. |
| `email_pub` | Publish a message to an email bus channel (Redis pub/sub). |
| `email_sub` | Subscribe to an email bus channel — messages inject into the session. |
| `email_channels` | List active bus channels and subscriber counts. |
| `email_health` | Check email system health (DB status, message count). |

## Configuration

The extension works out of the box with defaults. Emails are stored in `~/.pi/email.db`.

### Hindsight Integration (Optional)

Configure routing rules to persist emails to [Hindsight](https://github.com/vectorize-io/hindsight) banks:

```json
{
  "hindsight": {
    "enabled": true,
    "defaultBank": "general-email",
    "rules": [
      {
        "id": "project-route",
        "description": "Route project emails to dedicated bank",
        "condition": "origin.cwd includes 'project-x'",
        "targetBank": "project-x",
        "tags": ["project-x", "automated"],
        "priority": 10
      }
    ]
  }
}
```

### Origin Tracking

Every email automatically captures:

```typescript
{
  cwd: "/home/user/project-x",       // working directory
  cliAgent: "pi",                     // which CLI agent produced it
  sessionId: "ses_abc123",            // pi session (if available)
  gitProject: "pi-plugins",           // git project name
  custom: { team: "backend" },        // extensible metadata
  timestamp: "2026-05-23T..."
}
```

### Hook Events

The extension fires lifecycle hooks that other extensions can subscribe to:

| Event | When |
|-------|------|
| `email:received` | Email delivered to a mailbox |
| `email:sent` | Email sent successfully |
| `email:read` | Email read by an agent |
| `email:deleted` | Email deleted |
| `email:routed` | Email routed to a Hindsight bank |

## Architecture

```
extensions/
└── index.ts                    ← pi extension entry (registers 9 tools)
src/
├── types.ts                    ← core interfaces & types
├── db/
│   ├── database.ts             ← SQLite wrapper (better-sqlite3)
│   └── schema.sql              ← FTS5-enabled schema
├── providers/
│   └── sqlite-provider.ts      ← persistent email storage
├── origin/
│   └── tracker.ts              ← cwd, agent, session, git metadata
├── hooks/
│   ├── routing-engine.ts       ← priority-based rule evaluation
│   └── hook-manager.ts         ← lifecycle event handlers
├── subscription/
│   └── mailbox-subscription.ts ← per-session mailbox subscriptions
└── pubsub/
    ├── bus.ts                  ← message bus (Redis-backed)
    └── logger.ts               ← bus event logging
```

## Requirements

- Node.js >= 22.0.0
- `better-sqlite3` (installed automatically)
- Optional: Redis (for cross-process pub/sub bus)

## License

MIT
