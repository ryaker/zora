# Quick Start

Get Zora running and complete your first task in under 5 minutes.

---

## Before You Start

You need two things:

1. **Node.js 20 or higher** — Check by opening Terminal and typing `node --version`. If you see `v20.x.x` or higher, you're good. If not, download it from [nodejs.org](https://nodejs.org) (click the big green "LTS" button).

2. **A Claude Code or Gemini account** — Zora uses your existing subscription. No API keys, no extra charges.

---

## Step 1: Install Zora

```bash
npm install -g zora-agent
```

Verify it worked:

```bash
zora-agent --version
```

You should see `0.9.5` (or similar).

---

## Step 2: Run Setup

```bash
zora-agent init
```

The setup wizard asks you a few questions:

- **How much access should Zora have?** Pick "Balanced" (recommended). It lets Zora read and write in your work folders while blocking anything dangerous.
- **Where do you do your work?** Point it at your main project folder (like `~/Projects` or `~/Documents`).
- **Anything off-limits?** The defaults protect your SSH keys, GPG keys, and AWS credentials. Accept them.

When prompted, your browser will open so you can sign into your Claude or Gemini account. This connects Zora to your existing subscription — no API keys or credit cards involved.

Want to skip the questions and accept all defaults? Run:

```bash
zora-agent init -y
```

---

## Step 3: Your First Task

```bash
zora-agent ask "What files are in my home directory? Give me a quick summary."
```

Zora reads your home directory (within its safety boundaries), uses AI to analyze what it finds, and gives you a formatted summary. That's it — you just used an autonomous AI agent.

---

## Try a Few More

**Teach Zora your preferences:**
```bash
zora-agent ask "Remember that I prefer concise answers and dark mode"
```

**Organize something:**
```bash
zora-agent ask "List everything in ~/Downloads, grouped by file type"
```

**Get a summary:**
```bash
zora-agent ask "Summarize the README files in ~/Projects"
```

**Multi-step task:**
```bash
zora-agent ask "Find all TODO comments in ~/Projects/my-app and create a summary file"
```

---

## Launch the Dashboard

```bash
zora-agent start
```

Your browser opens to `http://localhost:8070` — a live dashboard showing task progress, AI provider health, and your security status. You can submit tasks here too.

---

## What Zora Created During Setup

Everything lives in `~/.zora/` on your computer:

- **config.toml** — Which AI providers to use and how
- **policy.toml** — What Zora can and can't access (the safety rules)
- **SOUL.md** — Zora's personality and your preferences (edit this to customize)
- **memory/** — Long-term memory across sessions
- **audit/** — A log of every action Zora takes

All plain text. You can read or edit any of it anytime.

---

## Check Health

If something isn't working:

```bash
zora-agent doctor
```

This checks your environment, AI provider connections, config files, and reports anything that needs attention.

---

## Next Steps

- **[What Is Zora?](WHAT_IS_ZORA.md)** — Full explainer of what Zora is and how it works
- **[FAQ](FAQ.md)** — Common questions answered simply
- **[Use Cases](USE_CASES.md)** — Real-world examples for inspiration
- **[Setup Guide](SETUP_GUIDE.md)** — Detailed walkthrough if you hit snags
- **[Routines Cookbook](ROUTINES_COOKBOOK.md)** — Set up recurring scheduled tasks

---

*Three commands. Five minutes. Go.*
