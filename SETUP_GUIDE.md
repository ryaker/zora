# Zora Setup Guide (Beginner-Friendly)

**No experience required.** This guide walks you through every step to get Zora running on your Mac, from installing prerequisites to giving it your first task. If you can copy and paste commands into a terminal, you can do this.

---

## Table of Contents

1. [What Is Zora?](#what-is-zora)
2. [What You Need Before Starting](#what-you-need-before-starting)
3. [Step 1: Install Node.js](#step-1-install-nodejs)
4. [Step 2: Download Zora](#step-2-download-zora)
5. [Step 3: Install Dependencies](#step-3-install-dependencies)
6. [Step 4: Build the Project](#step-4-build-the-project)
7. [Step 5: Create Your Configuration Files](#step-5-create-your-configuration-files)
8. [Step 6: Run the Tests](#step-6-run-the-tests)
9. [Step 7: Give Zora Its First Task](#step-7-give-zora-its-first-task)
10. [Step 8: Launch the Dashboard](#step-8-launch-the-dashboard)
11. [Common Commands Cheat Sheet](#common-commands-cheat-sheet)
12. [Troubleshooting](#troubleshooting)
13. [Understanding the Config Files](#understanding-the-config-files)
14. [What's Next?](#whats-next)

---

## What Is Zora?

Zora is a **personal AI assistant that runs on your Mac**. Unlike chatbots you use in a browser, Zora:

- Runs locally on your computer (your data stays private)
- Can execute multi-step tasks on its own without you clicking "approve" every 5 seconds
- Uses Claude as its primary AI brain, with Gemini as a backup
- Remembers context across sessions using a built-in memory system
- Comes with a local web dashboard so you can monitor what it's doing

Think of it as hiring a tireless digital employee that lives on your laptop.

---

## What You Need Before Starting

| Requirement | Why You Need It |
|-------------|-----------------|
| **A Mac** | Zora is built for macOS (Linux works too, but macOS is the primary target) |
| **Terminal app** | To type commands (already on your Mac: search for "Terminal" in Spotlight) |
| **Node.js 20 or newer** | The runtime that powers Zora (we'll install this in Step 1) |
| **Git** | To download the code (already on most Macs; we'll check in Step 1) |
| **A Claude account** | Zora uses Claude as its AI engine |
| **Internet connection** | For downloading and for AI API calls |

---

## Step 1: Install Node.js

### Check if you already have Node.js

Open **Terminal** (press `Cmd + Space`, type "Terminal", hit Enter) and run:

```bash
node --version
```

- If you see `v20.x.x` or higher (e.g., `v20.11.0`, `v22.1.0`), you're good. Skip to Step 2.
- If you see an older version or `command not found`, follow the install steps below.

### Install Node.js (if needed)

**Option A: Download from the website (easiest)**

1. Go to [https://nodejs.org](https://nodejs.org)
2. Download the **LTS** version (the big green button)
3. Open the downloaded `.pkg` file and follow the installer
4. Close and reopen Terminal, then verify:

```bash
node --version
```

**Option B: Use Homebrew (if you already have it)**

```bash
brew install node@20
```

### Check that Git is installed

```bash
git --version
```

If you see a version number, you're set. If not, macOS will prompt you to install the Xcode Command Line Tools. Click "Install" and wait for it to finish.

---

## Step 2: Download Zora

In Terminal, navigate to where you want to keep the project (your home directory is fine):

```bash
cd ~
git clone https://github.com/ryaker/zora.git
cd zora
```

You should now be inside the `zora` folder. Verify with:

```bash
pwd
```

It should show something like `/Users/yourname/zora`.

---

## Step 3: Install Dependencies

Still in the `zora` folder, run:

```bash
npm install
```

**What this does:** Downloads all the libraries Zora needs to work. You'll see a progress bar and some output. This only needs to be done once (or after pulling new code).

**If you see warnings** like `npm warn deprecated` -- that's normal and safe to ignore. Only red `ERR!` messages are actual problems.

---

## Step 4: Build the Project

Zora is written in TypeScript, which needs to be compiled before it can run:

```bash
npm run build
```

**What this does:** Converts the TypeScript source code into JavaScript that Node.js can execute. The compiled files go into a `dist/` folder.

You should see no errors. If it completes silently, that means it worked.

---

## Step 5: Create Your Configuration Files

Zora needs two configuration files to know how to behave. We'll create them now.

### 5a: Create the Zora directory

```bash
mkdir -p ~/.zora
```

**What is `~/.zora`?** It's a hidden folder in your home directory where Zora stores its configuration, memory, and logs. The dot (`.`) at the start makes it hidden in Finder.

### 5b: Create the main config file

```bash
cat > ~/.zora/config.toml << 'ENDOFCONFIG'
# ============================================
# Zora Configuration
# ============================================
# This file tells Zora how to behave.
# Lines starting with # are comments (ignored).

[agent]
name = "zora"
workspace = "~/.zora/workspace"
max_parallel_jobs = 3
default_timeout = "2h"
heartbeat_interval = "30m"
log_level = "info"

[agent.identity]
soul_file = "~/.zora/workspace/SOUL.md"

# --- AI Providers ---
# Claude is the primary AI engine.
# Gemini is the backup if Claude is unavailable.

[[providers]]
name = "claude"
type = "claude-sdk"
rank = 1
capabilities = ["reasoning", "coding", "creative"]
cost_tier = "included"
enabled = true
auth_method = "mac_session"
model = "claude-sonnet-4-5"
max_turns = 200

[[providers]]
name = "gemini"
type = "gemini-cli"
rank = 2
capabilities = ["search", "structured-data", "large-context", "coding"]
cost_tier = "included"
enabled = true
auth_method = "workspace_sso"
cli_path = "gemini"
model = "gemini-2.5-pro"
max_turns = 100

# --- Routing ---
# "respect_ranking" means: try Claude first, fall back to Gemini.
[routing]
mode = "respect_ranking"

# --- Failover ---
# If Claude goes down, automatically hand the task to Gemini.
[failover]
enabled = true
auto_handoff = true
max_handoff_context_tokens = 50000
retry_after_cooldown = true
max_retries = 3
checkpoint_on_auth_failure = true
notify_on_failover = true

# --- Memory ---
# Where Zora stores what it remembers.
[memory]
long_term_file = "~/.zora/memory/MEMORY.md"
daily_notes_dir = "~/.zora/memory/daily"
items_dir = "~/.zora/memory/items"
categories_dir = "~/.zora/memory/categories"
context_days = 7
max_context_items = 20
max_category_summaries = 5
auto_extract_interval = 10

# --- Security ---
# Points to the policy file that controls what Zora can/can't do.
[security]
policy_file = "~/.zora/policy.toml"
audit_log = "~/.zora/audit/audit.jsonl"
audit_hash_chain = true
audit_single_writer = true
integrity_check = true
integrity_interval = "30m"
leak_detection = true
sanitize_untrusted_content = true

# --- Dashboard ---
# The local web UI for monitoring Zora.
[steering]
enabled = true
poll_interval = "5s"
dashboard_port = 7070
notify_on_flag = true
flag_timeout = "10m"
auto_approve_low_risk = true
always_flag_irreversible = true

# --- Notifications ---
[notifications]
enabled = false
on_task_complete = false
on_error = true
on_failover = true
on_auth_expiry = true
on_all_providers_down = true
ENDOFCONFIG
```

### 5c: Create the security policy file

This file controls what Zora is allowed to do on your system:

```bash
cat > ~/.zora/policy.toml << 'ENDOFPOLICY'
# ============================================
# Zora Security Policy
# ============================================
# This file defines what Zora can and cannot access.
# Start restrictive. Expand as you build trust.

# --- Filesystem Access ---
# Which folders Zora can read from and write to.
# IMPORTANT: Replace "yourname" with your actual macOS username!
[filesystem]
allowed_paths = ["/Users/yourname/Projects", "/Users/yourname/.zora"]
denied_paths = ["/System", "/usr/bin", "/etc"]
resolve_symlinks = true
follow_symlinks = false

# --- Shell Commands ---
# Which terminal commands Zora is allowed to run.
# "allowlist" means: ONLY these commands are permitted.
[shell]
mode = "allowlist"
allowed_commands = ["git", "node", "npm", "ls", "cat", "grep", "echo", "mkdir"]
denied_commands = ["sudo", "rm", "rmdir", "chmod", "chown", "kill"]
split_chained_commands = true
max_execution_time = "2m"

# --- Actions ---
# Which types of actions need extra approval.
[actions]
reversible = ["write_file", "edit_file", "mkdir"]
irreversible = ["git_push"]
always_flag = ["git_push"]

# --- Network ---
# Which websites Zora can access.
[network]
allowed_domains = ["*"]
denied_domains = []
max_request_size = "10MB"
ENDOFPOLICY
```

### 5d: Update the policy with your username

**This step is important!** Replace `yourname` in the policy file with your actual macOS username:

```bash
# Find your username
whoami
```

Then edit the policy file. Open it in any text editor:

```bash
open -e ~/.zora/policy.toml
```

Find this line:
```
allowed_paths = ["/Users/yourname/Projects", "/Users/yourname/.zora"]
```

Replace `yourname` with the output of `whoami` (e.g., `john`, `sarah`, etc.).

Save and close the file.

### 5e: Create the workspace and memory directories

```bash
mkdir -p ~/.zora/workspace
mkdir -p ~/.zora/memory/daily
mkdir -p ~/.zora/memory/items
mkdir -p ~/.zora/memory/categories
mkdir -p ~/.zora/audit
```

---

## Step 6: Run the Tests

Before using Zora, verify everything is working:

```bash
npm test
```

This runs both unit tests and browser tests. You should see green checkmarks and a summary like:

```
Tests:  XX passed
```

**If tests fail**, see the [Troubleshooting](#troubleshooting) section below.

---

## Step 7: Give Zora Its First Task

Now for the fun part. Run a simple task:

```bash
node dist/cli/index.js ask "What files are in my home directory?"
```

**What happens:**
1. Zora loads your config and policy
2. It picks the best AI provider (Claude first)
3. It executes the task within your security boundaries
4. It returns the result

### Other CLI commands

```bash
# Check Zora's current status
node dist/cli/index.js status

# Start Zora as a background daemon
node dist/cli/index.js start

# Stop the daemon
node dist/cli/index.js stop
```

---

## Step 8: Launch the Dashboard

Zora includes a local web dashboard for monitoring tasks in real time.

### Start the dashboard backend

The dashboard runs on `http://localhost:7070` when the agent is started. To set up and run the dashboard frontend separately during development:

```bash
# In a new Terminal tab/window:
cd ~/zora/src/dashboard/frontend
npm install
npm run dev
```

Then open your browser to the URL shown in the terminal (usually `http://localhost:5173`).

The dashboard shows:
- Provider health status (is Claude online? Is Gemini?)
- Active and completed tasks
- Neural steering controls (inject instructions into running tasks)

---

## Common Commands Cheat Sheet

| What You Want To Do | Command |
|---------------------|---------|
| Install dependencies | `npm install` |
| Build the project | `npm run build` |
| Run all tests | `npm test` |
| Run unit tests only | `npm run test:unit` |
| Run browser tests only | `npm run test:browser` |
| Watch tests (re-run on save) | `npm run test:watch` |
| Check for type errors | `npm run lint` |
| Clean build output | `npm run clean` |
| Ask Zora to do something | `node dist/cli/index.js ask "your task"` |
| Check Zora's status | `node dist/cli/index.js status` |
| Start Zora daemon | `node dist/cli/index.js start` |
| Stop Zora daemon | `node dist/cli/index.js stop` |

---

## Troubleshooting

### "command not found: node"

Node.js isn't installed or isn't in your PATH. Go back to [Step 1](#step-1-install-nodejs).

### "command not found: git"

Run this and macOS will prompt you to install developer tools:
```bash
xcode-select --install
```

### npm install shows errors

- Make sure you're in the `zora` directory: `cd ~/zora`
- Make sure Node.js is version 20+: `node --version`
- Try deleting `node_modules` and reinstalling:
  ```bash
  rm -rf node_modules
  npm install
  ```

### Build fails with TypeScript errors

- Make sure you ran `npm install` first
- Try a clean build:
  ```bash
  npm run clean
  npm run build
  ```

### Tests fail

- **Unit tests failing**: Usually means a dependency issue. Try `npm install` again.
- **Browser tests failing**: You may need to install Playwright browsers:
  ```bash
  npx playwright install
  ```

### "Cannot find module" when running a command

You probably forgot to build. Run:
```bash
npm run build
```

### Config file errors (TOML parse errors)

TOML is picky about formatting. Common mistakes:
- Missing quotes around string values: `name = zora` should be `name = "zora"`
- Wrong bracket syntax: `[providers]` should be `[[providers]]` (double brackets for arrays)
- Tabs vs spaces: TOML doesn't care, but be consistent
- Unclosed quotes: every `"` needs a matching `"`

### "Permission denied" errors

Make sure your `policy.toml` has the correct paths and that your username is right:
```bash
whoami  # Shows your username
cat ~/.zora/policy.toml  # Check the paths
```

### Port 7070 already in use

Something else is using port 7070. Either stop that process or change `dashboard_port` in your `config.toml`:
```toml
[steering]
dashboard_port = 7071  # or any free port
```

---

## Understanding the Config Files

### config.toml -- The Brain

This file controls Zora's behavior. Here's what each section does:

| Section | What It Controls |
|---------|-----------------|
| `[agent]` | Name, workspace location, parallel job limits, log verbosity |
| `[[providers]]` | Which AI models to use and in what order |
| `[routing]` | How to pick which AI provider handles a task |
| `[failover]` | What happens when the primary AI goes down |
| `[memory]` | Where Zora stores its short-term and long-term memory |
| `[security]` | Where to find the policy file and audit log |
| `[steering]` | Dashboard port and behavior settings |
| `[notifications]` | What events trigger alerts |

### policy.toml -- The Guardrails

This file controls what Zora is and isn't allowed to do:

| Section | What It Controls | Example |
|---------|-----------------|---------|
| `[filesystem]` | Which folders Zora can read/write | Allow `~/Projects`, deny `/System` |
| `[shell]` | Which terminal commands it can run | Allow `git`, deny `sudo` |
| `[actions]` | Which actions need approval | Flag `git_push` before doing it |
| `[network]` | Which websites it can access | Allow all, or restrict to specific domains |

**Golden rule:** Start restrictive, expand as you build trust. You can always add more permissions later.

---

## What's Next?

Once you've got Zora running, here are some things to explore:

1. **Read the full spec** -- `specs/v5/ZORA_AGENT_SPEC.md` has the complete technical design
2. **Explore the architecture** -- `specs/v5/docs/ARCHITECTURE.md` explains how all the pieces fit together
3. **Customize your policy** -- `specs/v5/docs/POLICY_REFERENCE.md` and `specs/v5/docs/POLICY_PRESETS.md` cover all policy options
4. **Set up memory** -- Create a `~/.zora/workspace/SOUL.md` file that describes your goals and preferences so Zora knows your priorities
5. **Try scheduled routines** -- Set up recurring tasks in your config (e.g., daily summaries, weekly reports)
6. **Check the implementation plan** -- `specs/v5/IMPLEMENTATION_PLAN.md` shows the roadmap and what's coming next

---

**Still stuck?** Open an issue at [https://github.com/ryaker/zora/issues](https://github.com/ryaker/zora/issues) and describe what went wrong. Include:
- Your macOS version (`sw_vers`)
- Your Node.js version (`node --version`)
- The full error message
- What step you were on

---

*Built with care for humans who just want things to work.*
