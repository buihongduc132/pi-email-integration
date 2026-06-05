# pi-email-integration

Email integration for pi multi-agent systems — local mail server, origin tracking, and Hindsight hooks.

## Current Phase: Local-Only

Real mail adapters (Gmail, Outlook, etc.) are **deferred** — see [docs/DEFERRED.md](docs/DEFERRED.md).

### What works now

- **Local mail server** — in-memory, agent-to-agent communication
- **Origin tracking** — every email records `cwd`, CLI agent, session ID, custom metadata
- **Hindsight hooks** — configurable routing rules to persist emails to Hindsight banks
- **Hook events** — `email:received`, `email:sent`, `email:read`, `email:deleted`, `email:routed`

### Tools

| Tool | Description |
|------|-------------|
| `email_send` | Send an email. Origin tracked automatically. |
| `email_read` | Read emails with filtering. Shows body + origin metadata. |
| `email_delete` | Delete an email by ID. |
| `email_health` | Check email system health. |

## Origin Tracking

Every email automatically captures:

```typescript
{
  cwd: "/home/user/project-x",       // working directory
  cliAgent: "pi",                     // which CLI agent produced it
  sessionId: "ses_abc123",            // pi session (if available)
  custom: { team: "backend" },        // extensible metadata
  timestamp: "2026-05-23T..."
}
```

## Hindsight Integration (Optional)

Configure routing rules to persist emails to Hindsight banks:

```typescript
{
  "hindsight": {
    "enabled": true,
    "defaultBank": "general-email",
    "rules": [
      {
        "id": "project-x-route",
        "description": "Route project-x emails to dedicated bank",
        "condition": (origin) => origin.cwd.includes('project-x'),
        "targetBank": "project-x",
        "tags": ["project-x", "automated"],
        "priority": 10
      },
      {
        "id": "agent-z-tag",
        "description": "Tag emails from agent Z",
        "condition": (origin) => origin.cliAgent === 'agent-z',
        "targetBank": "agent-z",
        "tags": ["agent-z"],
        "priority": 5
      }
    ]
  }
}
```

## Architecture

```
src/
├── types.ts                    ← core interfaces & types
├── providers/
│   └── local-provider.ts       ← in-memory mail server (current)
│   └── [DEFERRED: gmail, outlook, imap]
├── origin/
│   └── tracker.ts              ← cwd, agent, session, custom metadata
└── hooks/
    ├── routing-engine.ts       ← priority-based rule evaluation
    └── hook-manager.ts         ← lifecycle event handlers
extensions/
└── index.ts                    ← pi extension entry (registers tools)
```

## Installation

In `settings.json`:

```json
{
  "packages": [
    "https://github.com/buihongduc132/pi-email-integration"
  ]
}
```

## Development

```bash
npm ci
npm run check          # typecheck + test + coverage
npm run smoke-test     # verify load without pi runtime
```

## License

MIT
