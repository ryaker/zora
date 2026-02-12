# Zora v0.5 - Web Onboarding Wizard (Local UI Spec)

This document defines a local-only onboarding wizard to make pre-authorization safe and intuitive. It runs at `http://localhost:7070/onboarding`.

## Goals

- Make policy choices explicit and understandable
- Provide safe defaults with easy opt-in expansion
- Offer a dry-run preview before activation
- Keep all data local

## Non-Goals

- No cloud login or telemetry
- No remote access to the dashboard

## Information Architecture

1. **Welcome**
   - Explain pre-authorization and risk boundaries

2. **System Check**
   - Run `zora doctor` and show status cards

3. **Preset Selection**
   - Safe / Balanced / Power
   - Show a plain-English summary of access

4. **Scope Selection**
   - Read paths (checkbox + path picker)
   - Write paths (checkbox + path picker)
   - Denied paths preview

5. **Shell Allowlist**
   - Toggle common command groups
   - Show final allowlist

6. **Dry-Run Simulation**
   - Enter a sample task
   - Show tools, paths, and policy violations

7. **Review & Activate**
   - Policy summary card
   - Confirm and write `policy.toml`

## UI Components

- Status cards (Claude auth, Gemini auth, Node, pnpm)
- Policy summary panel
- Risk meter (Low / Medium / High)
- Diff view for policy changes
- Confirm dialog with explicit text: "Zora will not prompt for each action"

## Data Model

- `OnboardingState`:
  - `preset`
  - `read_paths`
  - `write_paths`
  - `allowed_commands`
  - `denied_commands`
  - `policy_preview`

## Local Security

- Bind only to `localhost`
- No external network calls
- Store state in memory only until confirm

## Success Criteria

- User can complete onboarding in < 10 minutes
- User understands scope boundaries before activation
- Dry-run preview is available without starting the daemon
