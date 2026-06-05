# Changelog

## 0.1.0 (unreleased)

### Added
- Local in-memory email provider for agent-to-agent communication
- Origin tracking: cwd, CLI agent, session ID, custom metadata
- Hindsight integration hooks with dynamic routing rules
- Hook manager for email lifecycle events
- Tools: `email_send`, `email_read`, `email_health`
- Configurable routing engine (priority-based rule evaluation)

### Deferred
- Gmail adapter (OAuth2)
- Outlook/Hotmail adapter
- ProtonMail adapter
- Generic IMAP/SMTP adapter
- Open-source mail server integration
