# DEFERRED Features

These features are planned but explicitly deferred from the initial release.
The current phase is **local-only** — no real mail server integration.

## Deferred: Real Mail Adapters

| Adapter | Priority | API | Auth | Status |
|---------|----------|-----|------|--------|
| Gmail | 1 (first) | Gmail API (REST) | OAuth2 | DEFERRED |
| Outlook/Hotmail | 2 | Microsoft Graph | OAuth2 | DEFERRED |
| ProtonMail | 3 | Proton API | Bridge/API | DEFERRED |
| Generic IMAP/SMTP | 4 | IMAP + SMTP | Password/OAuth | DEFERRED |

### Why deferred?

1. **Security complexity** — OAuth2 token management requires careful implementation
2. **Terms of service risk** — automated access may violate provider ToS
3. **Origin tracking first** — build and validate the origin/hook infrastructure locally before adding real mail
4. **Hindsight hooks validation** — test routing rules with local mail before connecting to real inboxes

## Deferred: Open-Source Mail Server Integration

These self-hosted mail servers are candidates for local deployment integration:

| Server | Stars | Language | Protocols | Best For |
|--------|-------|----------|-----------|----------|
| [Stalwart](https://github.com/stalwartlabs/stalwart) | 12.9k | Rust | JMAP, IMAP, SMTP, CalDAV, CardDAV | Modern all-in-one, JMAP-native |
| [Mailu](https://github.com/Mailu/Mailu) | 7.2k | Python | IMAP, SMTP | Docker-native, easy setup |
| [Mailcow](https://github.com/mailcow/mailcow-dockerized) | 12.8k | Docker | IMAP, SMTP, SOGo groupware | Full groupware, mature |
| [Docker Mailserver](https://github.com/docker-mailserver/docker-mailserver) | 18.3k | Shell/Docker | SMTP, IMAP, LDAP | Production-ready, simple |
| [Postal](https://github.com/postalserver/postal) | 16.5k | Ruby | SMTP (in/out) | High-volume delivery platform |
| [smtp4dev](https://github.com/rnwood/smtp4dev) | 3.9k | C# | SMTP, IMAP | Development/testing fake SMTP |

### Recommended for agent integration:

1. **Stalwart** — Best choice for JMAP-native agent communication. Rust, fast, modern protocol support (JMAP = JSON Meta Application Protocol, perfect for programmatic access).
2. **smtp4dev** — Best for development. Fake SMTP that captures all mail without delivering.
3. **Docker Mailserver** — Best for production self-hosted. Most stars, battle-tested.

## When to un-block

Real mail adapters should be implemented after:
1. Origin tracking is validated in production
2. Hindsight hooks are proven with local mail
3. Security review of OAuth2 flow is complete
4. Open-source mail server evaluation is done (pick one for self-hosted option)
