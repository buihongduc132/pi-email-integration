---
name: pi-email-integration
description: Email integration for pi agent systems — local mail server, origin tracking, Hindsight hooks. Real mail adapters deferred.
---

# pi-email-integration

Email integration for multi-agent pi systems.

## Current Phase: Local-Only

- **Local mail server** (in-memory) for agent-to-agent communication
- **Origin tracking**: every email records cwd, CLI agent, session, custom metadata
- **Hindsight hooks**: configurable routing rules to route emails to Hindsight banks by origin patterns
- **Hook events**: `email:received`, `email:sent`, `email:read`, `email:deleted`, `email:routed`

## Tools Provided

| Tool | Description |
|------|-------------|
| `email_send` | Send an email (local). Tracks origin automatically. Fires email:sent, email:received. |
| `email_read` | Read emails with filtering. Shows body + origin metadata. Fires email:read. |
| `email_delete` | Delete an email by ID. Fires email:deleted. |
| `email_health` | Check email system health. |

## Origin Tracking

Every email automatically captures:
- `cwd` — working directory when email was created
- `cliAgent` — which CLI agent produced it (default: "pi")
- `sessionId` — pi session ID (if available)
- `custom` — extensible metadata via config

## Hindsight Integration (Optional)

Configure routing rules to automatically persist emails to Hindsight banks:

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

## DEFERRED Features

See [docs/DEFERRED.md](docs/DEFERRED.md) for:
- Gmail adapter (OAuth2)
- Outlook/Hotmail adapter
- ProtonMail adapter
- Generic IMAP/SMTP adapter
- Open-source mail server integration (Stalwart, Mailu, etc.)
