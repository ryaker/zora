# Security Guide: How Zora Protects Your System

Zora is an AI agent that runs on your computer. This guide explains what it can and can't do, how permissions work, and how to stay in control.

---

## What Zora CAN'T Do (By Default)

**Filesystem Restrictions:**
- Can't access `~/.ssh` (SSH keys)
- Can't access `~/.gnupg` (encryption keys)
- Can't access `~/Library` (macOS system files)
- Can't access `/` (root filesystem)
- Can't read `~/Documents`, `~/Desktop`, or `~/Downloads` unless you choose the "power" preset

**Shell Command Restrictions:**
- Can't run `sudo` (no root access)
- Can't run `rm` (file deletion disabled)
- Can't run `chmod` or `chown` (permission changes blocked)
- Can't run `curl` or `wget` in balanced mode (network downloads disabled by default)

**Action Restrictions:**
- Can't execute destructive shell commands
- Can't follow symlinks outside allowed paths
- Can't make network requests to arbitrary domains (only HTTPS allowed by default)

> **Note:** The `always_flag` config (e.g., flagging `git_push` for interactive approval) is parsed from `policy.toml` but enforcement is not yet wired up. For now, dangerous commands are blocked outright via the shell deny list rather than flagged for approval.

---

## What Zora CAN Do (And Why)

**Filesystem Access:**
- Read and write files in `~/Projects` (your dev workspace)
- Read and write to `~/.zora/workspace` (Zora's sandbox for drafts and outputs)
- Read and write to `~/.zora/memory/daily` and `~/.zora/memory/items` (memory system)

**Shell Commands (Balanced Mode):**
- Run `git` (version control)
- Run `ls`, `pwd`, `rg` (navigation and search)
- Run `node`, `npm`, `pnpm` (Node.js development)
- Other dev tools you explicitly allow

**Why these permissions?**
Zora needs to read code to understand it, write files to edit them, and run dev tools to test changes. These permissions are scoped to your development directories, not your entire system.

---

## The Three Trust Levels

When you run `zora init`, you choose a preset. Here's what each one means:

### 1. Safe (Read-Only, No Shell)

**Best for:** First-time users, high-sensitivity environments, or when working with confidential data.

**What's allowed:**
- Read files in `~/Projects`, `~/.zora/workspace`, `~/.zora/memory/`
- Make HTTPS network requests
- Write to `~/.zora/workspace` only (no project file edits)

**What's blocked:**
- All shell commands (mode: `deny_all`)
- Writing to project files
- Accessing anything outside allowed paths

**Use when:** You want Zora to analyze code or draft content, but not make any changes.

---

### 2. Balanced (Recommended)

**Best for:** Day-to-day development work.

**What's allowed:**
- Read and write files in `~/Projects` and `~/.zora/workspace`
- Run `git`, `ls`, `pwd`, `rg`, `node`, `npm`, `pnpm`
- Make HTTPS network requests
- Execute reversible actions like `write_file`, `git_commit`, `mkdir`, `cp`, `mv`

**What's blocked:**
- Destructive commands: `sudo`, `rm`, `chmod`, `chown`, `curl`, `wget`
- Root filesystem access
- Sensitive directories: `~/.ssh`, `~/.gnupg`, `~/Library`, `~/Documents`, `~/Desktop`, `~/Downloads`

**Use when:** You trust Zora to write code and run tests, but want guardrails against destructive actions.

---

### 3. Power (Full Access)

**Best for:** Advanced users who understand the risks and need broader access.

**What's allowed:**
- Read and write in `~/Projects`, `~/Documents`, `~/.zora/workspace`
- Run `git`, dev tools, `python3`, `pip`, `jq`, `yq`, `find`, `sed`, `awk`
- Execute a wider range of shell commands
- Longer timeout (10 minutes instead of 5)

**What's still blocked:**
- `sudo`, `rm`, `chmod`, `chown` (destructive commands)
- `~/.ssh`, `~/.gnupg`, `~/Library` (critical system paths)

**Use when:** You need Zora to manage files across multiple directories or run advanced scripts.

---

## How to See Everything Zora Did

Every action Zora takes is logged to an audit file:

```bash
cat ~/.zora/audit/audit.jsonl
```

Each line is a JSON object with:
- `timestamp` — when the action happened
- `action` — what Zora did (`read_file`, `write_file`, `shell_exec`, etc.)
- `path` or `command` — the file or command involved
- `status` — whether it succeeded or failed
- `hash_chain` — cryptographic proof the log hasn't been tampered with

**Example:**
```json
{"timestamp":"2026-02-13T10:30:00Z","action":"write_file","path":"~/Projects/app/src/api.ts","status":"success","hash_chain":"a3f7..."}
{"timestamp":"2026-02-13T10:30:15Z","action":"shell_exec","command":"npm test","status":"success","hash_chain":"b8d2..."}
```

**Why hash chains?**
Each log entry includes a cryptographic hash of the previous entry. If someone (or something) tries to delete or modify a log entry, the chain breaks and you'll know.

---

## How to Change Permissions

You have two options:

### Option 1: Re-run `zora init`

```bash
zora init --force
```

This will prompt you to choose a preset again (safe, balanced, or power). Your existing audit logs and memory are preserved.

---

### Option 2: Edit `~/.zora/policy.toml` Directly

Open `~/.zora/policy.toml` in a text editor and modify the settings:

**Example: Allow `curl` in balanced mode**

```toml
[shell]
mode = "allowlist"
allowed_commands = ["ls", "pwd", "rg", "git", "node", "pnpm", "npm", "curl"]
denied_commands = ["sudo", "rm", "chmod", "chown", "wget"]
```

**Example: Allow access to `~/Documents`**

```toml
[filesystem]
allowed_paths = ["~/Projects", "~/Documents", "~/.zora/workspace", "~/.zora/memory/daily", "~/.zora/memory/items"]
denied_paths = ["~/Library", "~/.ssh", "~/.gnupg", "/"]
```

After editing, run `zora ask "test"` to verify your changes work.

---

## Your Data Never Leaves Your Computer

**What stays local:**
- All files Zora reads or writes
- All audit logs
- All memory (daily logs, items, relationships)
- Policy configuration

**What goes to the cloud:**
- API calls to Claude (Anthropic) or Gemini (Google) for AI inference
- The content of your prompts and the files Zora reads to answer them

**What Anthropic/Google sees:**
- Your prompt (e.g., "Refactor this function to use async/await")
- The code Zora reads to fulfill your request
- The conversation history (for context)

**What Anthropic/Google does NOT see:**
- Files Zora doesn't read
- Your audit logs
- Your filesystem structure
- Your policy configuration

**Encrypted in transit:** All API calls use HTTPS (TLS 1.3).

---

## Hash-Chain Audit (Tamper Detection)

Every audit log entry includes a hash of the previous entry, creating a cryptographic chain. If any entry is deleted or modified, the chain breaks.

**How it works:**
1. Entry 1: `hash_chain = hash(entry1)`
2. Entry 2: `hash_chain = hash(entry1_hash + entry2)`
3. Entry 3: `hash_chain = hash(entry2_hash + entry3)`

**Why it matters:**
If malware (or a rogue AI) tries to hide its tracks by deleting log entries, you'll detect it by verifying the chain.

**How to verify:**
```bash
zora audit verify
```

If the chain is intact, you'll see "Audit log verified (N entries)". If it's broken, you'll see which entry is missing or corrupted.

---

## Tool Stacks (Optional Extensions)

Zora supports tool stacks for common development environments. You can enable these in `policy.toml`:

**Node.js:**
```toml
allowed_commands = ["node", "npm", "npx", "tsc", "vitest"]
```

**Python:**
```toml
allowed_commands = ["python3", "pip", "pip3"]
```

**Rust:**
```toml
allowed_commands = ["cargo", "rustc", "rustup"]
```

**Go:**
```toml
allowed_commands = ["go"]
```

**General utilities:**
```toml
allowed_commands = ["ls", "pwd", "cat", "head", "tail", "wc", "grep", "find", "which", "echo", "mkdir", "cp", "mv", "touch"]
```

---

## Reporting a Vulnerability

Please use GitHub Security Advisories for private disclosure:

**https://github.com/ryaker/AgentDev/security/advisories**

If GitHub advisories are not available to you, open a GitHub issue with the minimum necessary detail and note that you can provide a private report if contacted.

We aim to acknowledge reports within 72 hours.

---

## v0.6 Implementation Status

Transparency about what's fully wired vs. in progress:

| Feature | Status |
|---------|--------|
| Path allow/deny enforcement | ✅ Enforced via PolicyEngine |
| Shell command allow/deny enforcement | ✅ Enforced via PolicyEngine |
| Symlink boundary checks | ✅ Enforced |
| Agent sees its own policy boundaries | ✅ Policy injected into system prompt |
| `check_permissions` tool (agent self-checks) | ✅ Available to agent |
| Hash-chain audit trail | ✅ Working |
| `always_flag` interactive approval | 🚧 Config parsed, enforcement in progress |
| Runtime permission expansion (mid-task grants) | 🚧 Planned |
| Locked-by-default fresh install | 🚧 Planned (currently defaults to Balanced) |

---

## Summary

- **Safe mode**: Read-only, no shell. Safe for sensitive data.
- **Balanced mode**: Read/write in dev paths, safe shell allowlist. Recommended.
- **Power mode**: Broader access, more tools. Use if you understand the risks.
- **Audit log**: Everything Zora does is logged to `~/.zora/audit/audit.jsonl`.
- **Your data is local**: Only API calls go to Claude/Gemini, all files stay on your machine.
- **Hash-chain verification**: Detect tampering with `zora audit verify`.

You're always in control. Adjust permissions, review logs, and change presets anytime.
