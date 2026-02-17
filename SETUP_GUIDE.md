# Setup Guide

**No experience required.** This guide walks you through every step, from opening Terminal for the first time to giving Zora its first task. If you can click and paste, you can do this.

---

## What You'll Need

- **A Mac** (Linux works too — Windows support is coming)
- **About 10 minutes** of your time
- **Claude Code or the Gemini CLI, signed in** — This is how Zora accesses AI. Install [Claude Code](https://claude.ai/claude-code) or the [Gemini CLI](https://ai.google.dev/gemini-api/docs/cli) and sign in. No API keys or credit cards needed — Zora uses your existing CLI session.

---

## Step 1: Open Terminal

Terminal is an app that comes with every Mac. It lets you type commands instead of clicking buttons.

**How to open it:** Press `Cmd + Space` (opens Spotlight search), type **Terminal**, and press Enter.

You'll see a window with a blinking cursor. This is where you'll type the commands in this guide.

> **Tip:** Every command in this guide is in a gray box. You can copy it by clicking the box, then paste it into Terminal with `Cmd + V`.

---

## Step 2: Check for Node.js

Node.js is the engine that runs Zora. Let's see if you already have it.

Type this and press Enter:

```bash
node --version
```

**If you see `v20.x.x` or higher** (like `v20.11.0` or `v22.1.0`): Skip to Step 3.

**If you see "command not found" or a version below 20:** You need to install it. Here's how:

### Install Node.js (the easy way)

1. Open your browser and go to [https://nodejs.org](https://nodejs.org)
2. Click the big green button that says **"LTS"** (this is the stable version)
3. A file downloads. Open it and follow the installer — just click "Continue" through each screen
4. When it's done, **close Terminal and open it again** (this refreshes your settings)
5. Verify it worked:

```bash
node --version
```

You should now see `v20.x.x` or higher.

### If you use Homebrew

If you already use Homebrew (a popular Mac tool installer), you can install Node.js this way instead:

```bash
brew install node@20
```

---

## Step 3: Install Zora

Now install Zora itself. Type:

```bash
npm install -g zora-agent
```

This downloads Zora and makes it available as a command you can run from anywhere. It takes about 30 seconds.

**What "npm" means:** It's Node.js's package manager — a tool that downloads and installs programs. It came with Node.js automatically.

Verify it worked:

```bash
zora-agent --version
```

You should see a version number (like `0.9.4` or higher).

---

## Step 4: Run the Setup Wizard

This is where you tell Zora how you want it to behave:

```bash
zora-agent init
```

The wizard walks you through a few questions. Here's what they mean and what to pick:

### Question 1: "Which directories should be off-limits?"

The defaults protect your sensitive credentials (pre-selected):

- `~/.ssh` — Your SSH keys (for connecting to servers)
- `~/.gnupg` — Your encryption keys
- `~/.aws` — Your Amazon Web Services credentials

You can also add `~/Documents`, `~/Desktop`, `~/Downloads`, or `~/Library`. **Accept the defaults** unless you have a specific reason to change them.

### Question 2: "Pick your first folder"

This is where Zora can read and work. Zora auto-detects common folders like `~/Projects`, `~/Dev`, or `~/Code`. Pick the one where your important files live.

If you're not a developer, you might want to point this at `~/Documents` instead.

### Question 3: "Want to go further?"

This controls how much Zora can do on your computer:

- **"I'm good for now"** — Read-only access to your folder, no shell commands. Good if you're cautious.
- **"Add shell commands too"** (recommended) — git, npm, ls — the standard dev toolkit.
- **"Full dev setup"** — Expanded tools: python, find, sed, awk. For experienced users.

**Our recommendation:** Start with **"Add shell commands too."** You can always expand later.

### Question 4: "Which tool stacks do you use?"

Only shown if you chose shell access. Pick your languages (Node.js, Python, Rust, Go). This tells Zora which commands it's allowed to run.

If you're not a developer, pick **"General CLI"** — this gives Zora access to basic commands like listing files, reading file contents, and searching text.

### Authentication

Zora connects to AI providers through your existing CLI sessions:

- **For Claude:** Install and sign into [Claude Code](https://claude.ai/claude-code). Zora uses that authenticated session automatically.
- **For Gemini:** Install and sign into the [Gemini CLI](https://ai.google.dev/gemini-api/docs/cli). Zora uses your Google account session.

That's it. No API keys, no credit card, no per-token charges. You're using the subscription you already pay for.

Run `zora-agent doctor` to verify your providers are connected.

### Quick Mode (skip the questions)

If you just want sensible defaults without answering questions:

```bash
zora-agent init -y
```

This chooses Balanced security, auto-detects your work folder, and protects your credentials.

---

## Step 5: Your First Task

Let's make Zora do something:

```bash
zora-agent ask "What's in my home directory? Summarize what you find."
```

Zora will read your home directory (within its safety rules), analyze what's there, and give you a formatted summary.

**What just happened behind the scenes:**

1. Zora loaded your safety rules
2. Connected to Claude (or Gemini)
3. Asked the AI to plan how to answer your question
4. Executed the plan (read your directory listing)
5. Formatted and returned the result

All within the boundaries you set in Step 4.

---

## Step 6: Teach Zora About You

Tell Zora your preferences so it works the way you like:

```bash
zora-agent ask "Remember these things about me: I prefer short, direct answers. I work mostly with documents and spreadsheets. My most important folder is ~/Documents/Work."
```

Zora stores this in its memory. From now on, every response will be shaped by these preferences.

---

## Step 7: Try the Dashboard

```bash
zora-agent start
```

Your browser opens automatically to `http://localhost:8070`. This is Zora's dashboard — a live control panel where you can:

- **Watch tasks in real time** — See what Zora is doing as it works
- **Check AI provider health** — Are Claude and Gemini connected?
- **Send corrections** — Tell Zora to adjust course mid-task
- **Try pre-built tasks** — Click a template to run common workflows instantly

---

## Step 8: Health Check

If anything isn't working right, run:

```bash
zora-agent doctor
```

This checks everything — Node.js version, config files, AI provider connections, security policy — and tells you exactly what needs fixing.

---

## What Zora Created on Your Computer

Everything lives in a hidden folder called `~/.zora/`:

| File/Folder | What It Is | Can I Edit It? |
|------------|-----------|---------------|
| **config.toml** | Settings — which AI to use, dashboard options | Yes |
| **policy.toml** | Safety rules — what Zora can access | Yes |
| **SOUL.md** | Zora's personality and your preferences | Yes — customize this! |
| **workspace/** | Temporary files Zora creates while working | Leave alone |
| **memory/** | What Zora remembers between sessions | You can read these |
| **audit/** | Complete log of every action Zora took | Read-only (tamper-proof) |

> **"Hidden folder"** means it starts with a dot (`.zora`) so it doesn't clutter your Finder. To see it in Finder: open Finder, press `Cmd + Shift + .` to show hidden files.

---

## Customizing Zora's Personality

Want Zora to match your style? Edit its personality file:

```bash
open -e ~/.zora/SOUL.md
```

This opens in TextEdit. Write your preferences in plain English:

```markdown
## About Me
- I'm a project manager, not a developer
- I work with documents, spreadsheets, and presentations
- My main work folder is ~/Documents/Work

## How I Like Responses
- Keep them short and direct
- Use bullet points for lists
- Don't explain technical details unless I ask
- Always tell me what you did and what changed
```

Save the file. Zora reads it before every task.

---

## Changing Your Safety Settings Later

If you want to give Zora more (or less) access, re-run the setup wizard:

```bash
zora-agent init --force
```

The `--force` flag tells Zora to overwrite your existing settings.

Or switch to a specific preset:

```bash
zora-agent init --preset safe --force     # More restrictive
zora-agent init --preset power --force    # More permissive
```

---

## Common Issues

### "command not found: zora-agent"

Node.js's global install folder might not be in your system path. Try:

```bash
npx zora-agent --version
```

If that works, use `npx zora-agent` instead of `zora-agent` for all commands.

### "No providers detected"

Zora can't find Claude or Gemini. Run `zora-agent doctor` to see what's missing. Usually it means you need to install and sign into Claude Code or the Gemini CLI.

### "Permission denied" when running a task

Zora's safety system blocked the action. This means the file or command falls outside your allowed boundaries. Check what's allowed:

```bash
zora-agent ask "Show me my current security policy in simple terms"
```

### Setup wizard is confusing

Skip it entirely and use defaults:

```bash
zora-agent init -y
```

You can always fine-tune settings later.

---

## What's Next?

- **[What Is Zora?](WHAT_IS_ZORA.md)** — Understand what Zora is and how it's different from other AI tools
- **[FAQ](FAQ.md)** — Quick answers to common questions
- **[Use Cases](USE_CASES.md)** — Inspiration for what to use Zora for
- **[Routines Cookbook](ROUTINES_COOKBOOK.md)** — Set up tasks that run automatically on a schedule

---

*You did it. Zora is ready. Go ask it something.*
