# Zora v0.6 - Web Dashboard Spec (Local UI)

This spec defines a local web UI for monitoring, onboarding, and async steering. It is local‑only by default and must never expose the agent to the public internet.

## Goals

- Make pre‑authorization safe and obvious
- Provide live visibility into jobs and provider health
- Allow async steering and flag review without blocking

## Non‑Goals

- No remote access in v0.6
- No multi‑tenant or cloud hosting

## Local Host Binding

- Bind to `localhost` only
- Default port: `7070`
- Optional `dashboard_auth` token required for any actions (read + write)

## Pages / Routes

1. `/` — Overview
   - Provider health cards
   - Active jobs
   - Last 10 events

2. `/jobs` — Job list
   - Filters: running / queued / done / failed

3. `/jobs/:id` — Job detail
   - Timeline of tool calls
   - Handoff checkpoints
   - Flags and steer history

4. `/steer` — Send steer message
   - Job selector
   - Message body
   - Risk meter (low/med/high)

5. `/flags` — Flag review
   - All pending flags
   - Approve / reject / annotate

6. `/policy` — Policy summary
   - Read/write scope
   - Shell allowlist
   - Irreversible actions

7. `/onboarding` — Onboarding wizard
   - Presets
   - Scope selection
   - Shell allowlist
   - Dry‑run simulator
   - Final confirm

## UI Components

- Status cards: Claude, Gemini, other providers
- Risk meter for policy scope
- Timeline view (tool events + audit)
- JSON viewer for tool results
- Diff viewer for policy changes

## Permissions Model

- UI can only:
  - Send steer messages
  - Approve/reject flags
  - Run simulations
  - View logs and status
- UI cannot:
  - Expand policy
  - Modify `config.toml` or `policy.toml`

## Local API (internal)

- `POST /api/steer` → send steer message
- `POST /api/flags/:id/approve` → approve flag
- `POST /api/flags/:id/reject` → reject flag
- `GET /api/jobs` → list jobs
- `GET /api/jobs/:id` → job details

## Security Requirements

- Token required for all write endpoints
- CSRF protection for local UI
- Audit log entry for any steer/flag action

