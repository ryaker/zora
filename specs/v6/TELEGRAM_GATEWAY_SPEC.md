# Zora v0.6 - Telegram Gateway Spec (Async Steering)

This spec defines a Telegram gateway for async steering of ongoing jobs and teams. It does **not** expand policy access; it only injects steer messages.

## Goals

- Enable remote, async steering from Telegram
- Preserve local‑first security and auditability
- Prevent any policy expansion or privileged actions

## Non‑Goals

- No remote file access
- No remote policy/config edits
- No public dashboard exposure

## Architecture Options

### Option A: Long Polling (no public endpoint)

- Gateway runs locally
- Uses Telegram long‑polling API
- No inbound webhooks required
- Works behind NAT

### Option B: Webhook (public endpoint)

- Gateway exposes `/telegram/webhook`
- Requires HTTPS + public URL
- Use a tunnel (ngrok, Cloudflare Tunnel) if needed

**Recommendation:** Start with Long Polling to avoid public exposure.

## Components

- `telegram-gateway` process
- Local `steering ingress` API (localhost)
- Audit logger (append‑only)

## Authorization Model

- Telegram user IDs are mapped to local identities
- Pairing flow:
  1. User opens local dashboard and generates a one‑time pairing code
  2. User sends the code to the Telegram bot
  3. Gateway stores `telegram_user_id -> local_user` mapping

## Message Types

- `/steer <job_id> <message>`
- `/flags` (list pending flags)
- `/approve <flag_id>`
- `/reject <flag_id> <reason>`
- `/status <job_id>`

All commands are validated and logged.

## Steering Limits

- Steering messages cannot alter policy, config, or secrets
- Remote steering is rate‑limited
- All remote commands are marked as `source = telegram`

## Data Flow

1. Telegram message received
2. Gateway validates user ID
3. Gateway transforms to `SteerMessage`
4. Gateway posts to local steering API
5. Audit log entry created

## Configuration

```
[telegram]
enabled = true
mode = "long_poll" # or "webhook"
bot_token = "env:TELEGRAM_BOT_TOKEN"
allowed_users = ["12345678"]
rate_limit_per_min = 20
```

## Security Requirements

- Store bot token in encrypted secrets
- Never log tokens
- Always audit all remote commands
- Explicitly deny any policy/config writes

