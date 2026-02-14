# Zora v0.5 - Onboarding and Install

Draft onboarding design. Command names are proposed and may change as the CLI is implemented.

This guide gets you to a secure, working Zora install in under 10 minutes. It is designed for first run and safe defaults.

## Prerequisites

- macOS
- Node.js 22+
- pnpm
- Claude Code SDK installed and logged in
- Gemini CLI installed and logged in (optional but recommended)

## Step 0: Clone and install

```bash
git clone https://github.com/your-org/zora.git
cd zora
pnpm install
```

## Step 1: System check

Run the health check to detect installed tools and auth status.

```bash
pnpm zora-agent doctor
```

Expected outcomes:
- Claude detected and authenticated
- Gemini CLI detected (optional) and authenticated
- Node.js and pnpm version checks pass

If Gemini is not available, Zora will run Claude-only until you add Gemini.

## Step 2: Choose a safety preset

Zora is pre-authorized. The preset is your first safety decision.

Presets (see `POLICY_PRESETS.md` for exact TOML):
- `Safe`: read-only + no shell
- `Balanced`: read/write in `~/Projects` + safe shell allowlist
- `Power`: expanded access with explicit warnings

## Step 3: Initialize with your preset

```bash
pnpm zora init
```

Recommended answers for a safe first run (Balanced):
- Workspace path: `~/.zora`
- Read access: `~/Projects`
- Write access: `~/Projects`
- Allow web fetch: `yes`
- Allow shell: `yes` (safe allowlist)

Zora will:
- Create `~/.zora/`
- Generate `config.toml` and `policy.toml`
- Compute integrity baselines for critical files
- Create a default `SOUL.md` and memory structure

## Step 4: Scope selection (read/write boundaries)

During init, Zora will ask what it can read and write. Keep this small on day one.

Default recommendation:
- Read: `~/Projects`
- Write: `~/Projects`
- Deny: `~/Documents`, `~/Desktop`, `~/Downloads`, `~/Library`, `/`

## Step 5: Shell permissions (allowlist)

Zora does not prompt per command. You must choose the allowlist intentionally.

Default recommendation:
- Allow: `git`, `node`, `pnpm`, `npm`, `rg`
- Deny: `sudo`, `rm`, `chmod`, `chown`, `curl`, `wget`

## Step 6: Dry-run preview (simulation mode)

Before activation, run a safe dry-run to see exactly what Zora would do.

```bash
pnpm zora simulate "Summarize my repos in ~/Projects"
```

The simulator should show:
- Tools that would be called
- Paths that would be read/written
- Any policy violations

## Step 7: Review the policy

Zora uses pre-authorized execution. Review the policy once, then let it work.

```bash
pnpm zora policy review
```

If you need more access later, edit deliberately:

```bash
pnpm zora policy edit
```

## Step 8: Provider ordering (v0.5)

v0.5 introduces a provider registry with ranked preferences. Confirm that Claude is ranked first and Gemini second.

```bash
pnpm zora providers list
```

If needed, adjust priority in `~/.zora/config.toml` under `[[providers]]` entries.

## Step 9: Run a safe first task

Use a read-only request to validate the tool loop:

```bash
pnpm zora ask "List my repos in ~/Projects and summarize the most recent commit in each"
```

## Step 10: Start the daemon

```bash
pnpm zora start
```

Check status:

```bash
pnpm zora status
```

## Optional: Enable additional capabilities later

Examples:
- Allow writing to Documents
- Allow Docker commands
- Enable additional providers (OpenAI/Codex, local models)

Make these changes explicitly in `policy.toml` and `config.toml`, then restart Zora.

---

## Optional: Local web onboarding wizard (planned)

A local-only wizard can make the pre-authorization model clearer and safer.

Proposed endpoint:
- `http://localhost:7070/onboarding`

Wizard steps:
1. Prereqs check (doctor)
2. Choose preset (Safe / Balanced / Power)
3. Select read/write paths
4. Choose shell allowlist
5. Dry-run simulation
6. Final confirmation with policy summary

All UI state is local. No cloud calls.

---

## Troubleshooting

- If `zora-agent doctor` fails Claude auth, re-auth in Claude Code or Claude Desktop.
- If Gemini CLI is installed but not authenticated, run its login flow and re-run `zora-agent doctor`.
- If a tool call fails with `policy_violation`, expand your policy intentionally or change the task.

## Security reminders

- Zora does not prompt per action. Your policy is the trust boundary.
- `SOUL.md`, `MEMORY.md`, `policy.toml`, and `config.toml` are read-only to tools. Update them only through CLI.
- All local state lives under `~/.zora/`.
