# What Is Zora?

## The Short Version

Zora is a personal AI assistant that lives on your computer. You tell it what you need in everyday language, and it actually does it — organizing files, summarizing documents, automating repetitive tasks, running commands — while you focus on other things.

It's like having a capable assistant who works at your desk, sees your files, and follows your instructions. Except it never sleeps, never forgets your preferences, and always follows the safety rules you set.

---

## How Is It Different From ChatGPT or Claude.ai?

When you use ChatGPT or Claude in your browser, you're having a conversation. You ask a question, you get an answer. But the AI can't actually *do* anything on your computer. It can't organize your files, can't check your code, can't create reports from your data.

Zora can.

Zora runs directly on your Mac (or Linux machine). When you say "sort my Downloads folder," it actually reads your Downloads folder, decides how to organize the files, moves them, and tells you what it did. When you say "find all TODOs in my project," it actually searches through your code files and creates a summary.

The key differences:

**ChatGPT/Claude.ai:** You copy-paste content into a chat window. The AI talks about it. You copy the answer back out.

**Zora:** You describe what you want done. The AI does it. You review the result.

---

## How Does Authentication Work?

This is one of the best parts: **there are no API keys and no surprise bills.**

Many AI tools require you to create a developer account, generate an API key, attach a credit card, and pay per-token. One careless automation loop and you get a $500 bill.

Zora avoids this entirely. It authenticates through your existing CLI subscriptions:

- If you have **Claude Code** (Anthropic's coding tool), Zora uses that same authenticated session
- If you have **Google Gemini**, Zora can authenticate through your Google account

You're using the AI you already pay for, through the subscription you already have. No extra charges, no per-token billing, no credit card surprises.

When you run `zora-agent init`, Zora detects your existing Claude Code or Gemini CLI session and connects automatically. No extra sign-in step — if you're already authenticated in your CLI tools, Zora just works.

---

## What Can Zora Actually Do?

Here are everyday examples, organized by what kind of work you do:

### If You Work With Files a Lot
- "Organize my Downloads folder — group by file type, archive anything older than a month"
- "Find all PDFs on my Desktop and create a summary list"
- "Move all screenshots to a Screenshots folder, organized by month"

### If You Write Code
- "Find all TODO comments across my project and list them by priority"
- "Review this file and suggest improvements"
- "Create feature branches for all open GitHub issues labeled 'sprint-12'"

### If You Create Content
- "Draft replies to my unread emails about the product launch"
- "Summarize this 50-page PDF into a one-page executive brief"
- "Research the latest trends in [topic] and write a summary"

### If You Manage Projects
- "What changed across all my repos this week?"
- "Generate a standup summary from my recent git commits"
- "Check for outdated dependencies in all my projects"

### If You Want Things on Autopilot
- "Every morning at 8am, summarize my unread emails"
- "Every Friday, generate a weekly project status report"
- "Every night, back up my important config files"

---

## Is It Safe? Can It Break Anything?

Zora was designed with safety as a primary feature. Here's how it works:

**You set the boundaries.** During setup, you choose one of three trust levels:

- **Safe** — Zora can only read files, never write or run commands. Like a viewer with no edit permissions.
- **Balanced** (recommended) — Zora can read and write in your work folders, and run safe commands like `git` and `ls`. Destructive commands like `sudo` and `rm` are always blocked.
- **Power** — Broader access for experienced users who want maximum autonomy. Still blocks truly dangerous commands.

**Everything is logged.** Every single action Zora takes — every file it reads, every command it runs — goes into a tamper-proof audit log. You can review it anytime with `zora-agent audit`.

**Sensitive areas are always off-limits.** Your SSH keys, AWS credentials, and other sensitive directories are blocked by default, regardless of which trust level you choose.

**It stays on your computer.** Your files stay on your machine. The only data that leaves your computer is whatever Zora sends to Claude or Gemini to process your request — the same as if you copied text into a chat window yourself.

---

## What Do I Need to Run It?

- A Mac (Linux works too, Windows support is coming)
- Node.js version 20 or higher (free, takes 2 minutes to install)
- A Claude Code subscription or Google Gemini account
- About 5 minutes for setup

---

## How Do I Get Started?

The fastest path:

```bash
npm install -g zora-agent
zora-agent init
zora-agent ask "hello, what can you do?"
```

If you've never used a terminal before, our [Setup Guide](SETUP_GUIDE.md) walks you through every step with screenshots and explanations.

---

## How Does Zora Remember Things?

Zora has a built-in memory system. When you tell it your preferences ("I prefer TypeScript over JavaScript," "keep responses short"), it stores that information and uses it in every future interaction.

It also remembers context from previous tasks. If you asked Zora to analyze a project yesterday, it can reference that analysis today without you re-explaining everything.

Your memories are stored locally in `~/.zora/memory/` — plain text files on your computer. Nothing is sent to a cloud service. You can read, edit, or delete them anytime.

---

## The Dashboard

Zora includes a web dashboard that runs locally on your computer. It's where you can:

- Watch tasks happening in real time
- See which AI providers are connected and healthy
- Send corrections to running tasks ("actually, skip the test files")
- Browse your memory and audit logs

Start it with `zora-agent start` and it opens automatically in your browser at `http://localhost:8070`.

---

## What About Cost?

Zora itself is free and open source (MIT license).

The AI it uses (Claude, Gemini) is covered by your existing subscription. If you use Claude Code's Pro plan, for example, Zora uses that same plan. No extra charges.

If you want fully free, fully private operation, you can use Ollama — a local AI that runs entirely on your machine. It's slower and less capable than Claude, but it costs nothing and no data ever leaves your computer.

---

*Have more questions? Check the [FAQ](FAQ.md) or open an issue on [GitHub](https://github.com/ryaker/zora).*
