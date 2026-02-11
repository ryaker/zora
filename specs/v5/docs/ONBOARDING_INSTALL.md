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
pnpm zora doctor
```

Expected outcomes:
- Claude detected and authenticated
- Gemini CLI detected (optional) and authenticated
- Node.js and pnpm version checks pass

If Gemini is not available, Zora will run Claude-only until you add Gemini.

## Step 2: Initialize with safe defaults

```bash
pnpm zora init
```

Recommended answers for a safe first run:
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

## Step 3: Review the policy

Zora uses pre-authorized execution. Review the policy once, then let it work.

```bash
pnpm zora policy review
```

If you need more access later, edit deliberately:

```bash
pnpm zora policy edit
```

## Step 4: Provider ordering (v0.5)

v0.5 introduces a provider registry with ranked preferences. Confirm that Claude is ranked first and Gemini second.

```bash
pnpm zora providers list
```

If needed, adjust priority in `~/.zora/config.toml` under `[[providers]]` entries.

## Step 5: Run a safe first task

Use a read-only request to validate the tool loop:

```bash
pnpm zora ask "List my repos in ~/Projects and summarize the most recent commit in each"
```

## Step 6: Start the daemon

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

## Troubleshooting

- If `zora doctor` fails Claude auth, re-auth in Claude Code or Claude Desktop.
- If Gemini CLI is installed but not authenticated, run its login flow and re-run `zora doctor`.
- If a tool call fails with `policy_violation`, expand your policy intentionally or change the task.

## Security reminders

- Zora does not prompt per action. Your policy is the trust boundary.
- `SOUL.md`, `MEMORY.md`, `policy.toml`, and `config.toml` are read-only to tools. Update them only through CLI.
- All local state lives under `~/.zora/`.
