# Zora Quick Start Guide

Get up and running with Zora in 5 minutes.

---

## 1. Check Prerequisites

Zora needs **Node.js 20 or higher** — this is the engine that powers Zora's runtime.

Check your version:
```bash
node --version
```

**What you should see:**
```
v20.x.x  (or higher)
```

### If you don't have Node.js 20+

**macOS:**
```bash
brew install node
```

**Other platforms:**
- Download from [nodejs.org](https://nodejs.org/)
- Or use [nvm](https://github.com/nvm-sh/nvm) for version management:
  ```bash
  nvm install 20
  nvm use 20
  ```

---

## 2. Install Zora

```bash
npm install -g zora
```

**What you should see:**
```
added 1 package in 2s
```

Verify the installation:
```bash
zora --version
```

**What you should see:**
```
0.7.0
```

---

## 3. Set Up Zora

Run the interactive setup wizard:
```bash
zora init
```

### What happens during setup

The wizard walks you through:

#### 1. **Security Preset** — How much autonomy should Zora have?

Three options:

- **Safe** — "Like a cautious assistant — asks before doing anything risky"
  - Read-only filesystem access
  - No shell commands allowed
  - Perfect for first-time use or high-sensitivity environments

- **Balanced** (recommended) — "Like a trusted employee — works independently within clear boundaries"
  - Read/write access inside your dev directory
  - Safe shell commands allowed (git, npm, ls, grep, etc.)
  - Blocks destructive commands (rm, sudo, chmod)

- **Power** — "Like a senior engineer — full autonomy, you review the audit log"
  - Expanded filesystem access (includes ~/Documents)
  - Broader shell command allowlist (includes python3, find, sed, awk)
  - Still blocks truly dangerous commands (sudo, rm)
  - Use only if you understand the risks

#### 2. **Dev Path** — Where do you code?

Zora auto-detects common directories (~/Dev, ~/Projects, ~/Code) and suggests the first one it finds.

This becomes your primary workspace where Zora can read and write files.

#### 3. **Denied Paths** — Which directories should always be off-limits?

Pre-selected recommendations:
- `~/.ssh` — SSH keys
- `~/.gnupg` — GPG keys
- `~/.aws` — AWS credentials

You can add more (~/Documents, ~/Desktop, ~/Downloads, ~/Library).

#### 4. **Tool Stacks** — Which languages and tools do you use?

Available stacks:
- **Node.js** — node, npm, npx, tsc, vitest
- **Python** — python3, pip, pip3
- **Rust** — cargo, rustc, rustup
- **Go** — go
- **General CLI** — ls, pwd, cat, head, grep, find, etc.

These commands are added to your shell allowlist (unless you chose "Safe" preset).

### Quick mode

If you just want to get going with sensible defaults:
```bash
zora init -y
```

This automatically chooses:
- Preset: Balanced
- Dev path: First detected from ~/Dev, ~/Projects, ~/Code
- Denied paths: ~/.ssh, ~/.gnupg, ~/.aws
- Tool stacks: Node.js + General CLI (if Claude or Gemini is detected)

**What you should see after setup:**
```
✔ Zora is ready! Run `zora ask "hello"` to get started.
```

Behind the scenes, Zora created:
- `~/.zora/config.toml` — Provider configuration (Claude, Gemini)
- `~/.zora/policy.toml` — Security policy (what Zora can and can't do)
- `~/.zora/SOUL.md` — Zora's personality and your preferences
- `~/.zora/workspace/` — Zora's scratch space
- `~/.zora/memory/` — Long-term memory storage
- `~/.zora/audit/` — Tamper-proof audit log

---

## 4. Your First Task

Let's do something actually useful — analyze a directory:

```bash
zora ask "List everything in my ~/Projects folder and give me a one-line summary of each"
```

### What happens:

1. Zora reads your filesystem (within policy bounds)
2. Uses Claude or Gemini to analyze each item
3. Returns a formatted summary

**What you should see:**
```
📂 ~/Projects/

my-app/          — React dashboard with TypeScript and Tailwind
scripts/         — Collection of shell utilities for DevOps
notes/           — Personal knowledge base in Markdown
old-prototype/   — Archived experiment, last updated 2023

4 items analyzed
```

---

## 5. Your Second Task (Shows Memory)

Teach Zora your preferences:

```bash
zora ask "Remember that I prefer TypeScript over JavaScript and concise responses over verbose ones"
```

**What you should see:**
```
✓ Stored in memory:
  - Prefers TypeScript over JavaScript
  - Prefers concise responses

Memory saved to ~/.zora/memory/items/
```

Now test it:
```bash
zora ask "Write a utility function to deep-merge two objects"
```

**What you should see:**
```typescript
export function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = target[key];
    if (isObject(sourceValue) && isObject(targetValue)) {
      result[key] = deepMerge(targetValue, sourceValue);
    } else {
      result[key] = sourceValue;
    }
  }
  return result;
}

function isObject(item: unknown): item is object {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}
```

Notice:
- ✅ **TypeScript** (not JavaScript) — Zora remembered
- ✅ **Concise** (no verbose explanation) — Zora remembered

---

## 6. Your Third Task (Shows Autonomy)

Let Zora analyze code and create output:

```bash
zora ask "Find all TODO comments in ~/Projects/my-app and create a summary markdown file in ~/Projects/my-app/TODO_SUMMARY.md"
```

### What happens:

1. Zora searches for TODO comments across your codebase
2. Groups them by file and priority
3. Writes a markdown file with the summary

**What you should see:**
```
Found 12 TODO comments across 8 files

Grouping by file and priority...

📝 Writing summary to ~/Projects/my-app/TODO_SUMMARY.md
```

Open `~/Projects/my-app/TODO_SUMMARY.md` to see the structured summary.

> **Note:** The "Safe" preset blocks file writes outside `~/.zora/workspace`. If you chose Safe mode and need to write project files, switch to Balanced: `zora init --preset balanced --force`

---

## 7. What Just Happened?

Here's the flow that ran in the background:

```
Your command
    ↓
CLI (zora ask)
    ↓
Orchestrator
    ↓
Provider (Claude or Gemini)
    ↓
Tools (filesystem, shell, memory)
    ↓
Result
```

### Key files created:

**Audit Log** — Every action Zora takes is logged:
```bash
cat ~/.zora/audit/audit.jsonl | tail -5
```

Each line is a JSON record with:
- Timestamp
- Action type (read_file, write_file, shell_exec)
- Parameters (file path, command, etc.)
- Result (success or error)
- Hash chain (tamper detection)

**Memory** — Your preferences and past interactions:
```bash
ls ~/.zora/memory/items/
```

You'll see files like:
- `preferences_typescript.md`
- `preferences_concise_responses.md`

These are automatically loaded as context in future conversations.

---

## 8. Next Steps

### Dashboard

Launch the web dashboard to monitor tasks, see provider status, and send messages to running jobs:

```bash
zora start
```

Your browser will open automatically to `http://localhost:7070`. (Use `--no-open` to suppress this.)

The dashboard shows:
- **Provider status** — Which AI providers are connected
- **Task activity** — Real-time logs from running jobs
- **Security policy** — Current policy rules in effect
- **System info** — Uptime and resource usage

First-time users will see a welcome screen with quick-start examples. If providers aren't configured yet, you'll see setup instructions right in the dashboard.

Need help setting up? Use our **[AI Setup Assistant](docs/AI_SETUP_ASSISTANT.md)** — paste the prompt into ChatGPT, Claude, or Gemini for a guided walkthrough.

### Routines (Scheduled Tasks)

Set up recurring tasks like "check my email every morning" or "summarize my git commits at end of day":

See [ROUTINES_COOKBOOK.md](ROUTINES_COOKBOOK.md) for examples.

### Use Cases

Need inspiration? Check out [USE_CASES.md](USE_CASES.md) for:
- Code analysis and refactoring
- Content generation
- DevOps automation
- Research and data gathering

### Security Deep Dive

Want to understand how the sandbox works?

Read [SECURITY.md](SECURITY.md) for:
- Policy file format
- Audit log verification
- Integrity checks
- Failover behavior

### Customize Zora's Personality

Edit `~/.zora/SOUL.md` to personalize Zora's behavior:

```bash
open ~/.zora/SOUL.md
```

Example customizations:
```markdown
## Owner Preferences
- Always use TypeScript, never JavaScript
- Prefer Tailwind CSS over plain CSS
- Keep responses concise (no fluff)
- When coding, include inline comments for complex logic
- Use `pnpm` instead of `npm`
```

Zora reads this file before every task and adapts accordingly.

---

## Troubleshooting

### "No providers detected"

Run `zora doctor` to check your environment:
```bash
zora doctor
```

If Claude or Gemini CLI isn't installed, see [SETUP_GUIDE.md](./docs/SETUP_GUIDE.md) for installation instructions.

### "Permission denied" errors

Check your policy file:
```bash
cat ~/.zora/policy.toml
```

Make sure the path you're trying to access is in `allowed_paths` and not in `denied_paths`.

### "Command not allowed"

If you see:
```
Error: Command 'xyz' is not in the shell allowlist
```

Either:
1. Switch to a less restrictive preset (`zora init --preset power --force`)
2. Or manually add the command to `~/.zora/policy.toml` under `[shell] → allowed_commands`

### Need help?

- Open an issue on [GitHub](https://github.com/ryaker/zora)

---

You're all set! Zora is now ready to be your autonomous coding assistant.
