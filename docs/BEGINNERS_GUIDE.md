![Zora LCARS Header](archive/v5-spec/assets/zora_lcars_header.png)

# Zora Beginner's Guide

**Already installed Zora?** This guide explains what it can do, how to use it day-to-day, and walks through real examples. No jargon. No deep technical specs. Just the practical stuff.

> **Haven't installed yet?** Start with the [Setup Guide](../SETUP_GUIDE.md) first, then come back here.

![LCARS Divider](archive/v5-spec/assets/lcars_divider.svg)

## Table of Contents

1. [What Can Zora Actually Do?](#what-can-zora-actually-do)
2. [Talking to Zora (The Basics)](#talking-to-zora-the-basics)
3. [Real Examples You Can Try Right Now](#real-examples-you-can-try-right-now)
4. [How Zora Remembers Things](#how-zora-remembers-things)
5. [Automating Tasks with Routines](#automating-tasks-with-routines)
6. [The Dashboard (Your Control Panel)](#the-dashboard-your-control-panel)
7. [The Two Brains: Claude and Gemini](#the-two-brains-claude-and-gemini)
8. [Security: What Zora Can and Can't Do](#security-what-zora-can-and-cant-do)
9. [Tips for Getting the Best Results](#tips-for-getting-the-best-results)
10. [Frequently Asked Questions](#frequently-asked-questions)

![LCARS Divider](archive/v5-spec/assets/lcars_divider.svg)

## What Can Zora Actually Do?

Zora is like a digital assistant that lives on your computer and can **actually do things** -- not just answer questions. Here's the difference:

```
┌──────────────────────────────────────────────────────────────┐
│  REGULAR CHATBOT              vs.        ZORA                │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  "Here's how to organize       "Done. I organized your      │
│   your files..."                files. Here's what I did."   │
│                                                              │
│  "You could write a script     "I wrote the script, ran     │
│   that does X..."               it, and saved the output."  │
│                                                              │
│  "Try running these 5          "All 5 commands ran.          │
│   commands..."                  3 passed, 2 had issues       │
│                                 -- here's what I fixed."     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Things Zora can do for you

**Working with files:**
- Read, write, and organize files on your computer
- Summarize documents or meeting notes
- Create new files from templates or instructions

**Working with code:**
- Write, edit, and debug code across your projects
- Run tests and fix what's broken
- Clean up messy repos, manage git branches

**Research and writing:**
- Draft blog posts, emails, reports, cover letters
- Search for information and compile results
- Rewrite or edit content in a specific tone or style

**Automation:**
- Run recurring tasks on a schedule (daily, weekly, etc.)
- Monitor your projects for issues
- Produce daily summaries of what happened

**And it does all of this:**
- Without you clicking "approve" for every little action
- While staying inside security boundaries you define
- On your local machine -- your data never leaves your computer

![LCARS Divider](archive/v5-spec/assets/lcars_divider.svg)

## Talking to Zora (The Basics)

Every interaction with Zora starts with one command:

```bash
node dist/cli/index.js ask "your task here"
```

That's it. You describe what you want in plain English, and Zora figures out how to do it.

### The golden rule: be specific

The more detail you give, the better the results.

```
┌──────────────────────────────────────────────────────────────┐
│  VAGUE (works, but meh)       SPECIFIC (much better)        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  "Clean up my project"        "In ~/Projects/myapp, find    │
│                                all TODO comments, list them  │
│                                in a markdown file, and       │
│                                delete any empty files."      │
│                                                              │
│  "Write a blog post"          "Write a 500-word blog post   │
│                                about remote work tips in a   │
│                                casual, friendly tone. Save   │
│                                it to ~/writing/blog.md"      │
│                                                              │
│  "Check my code"              "Run the test suite in        │
│                                ~/Projects/api and fix any    │
│                                failing tests related to      │
│                                the user login flow."         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Other commands you should know

```bash
# Check if Zora is running and healthy
node dist/cli/index.js status

# Start Zora as a background service (runs routines, heartbeat, dashboard)
node dist/cli/index.js start

# Stop the background service
node dist/cli/index.js stop
```

![LCARS Divider](archive/v5-spec/assets/lcars_divider.svg)

## Real Examples You Can Try Right Now

Here are copy-paste-ready commands to see Zora in action. Start simple, then try bigger tasks.

### Example 1: Summarize a folder

```bash
node dist/cli/index.js ask "List all files in ~/Projects and give me a one-sentence summary of what each project does based on its README"
```

### Example 2: Write something for you

```bash
node dist/cli/index.js ask "Write a professional email declining a meeting invitation. Keep it polite but firm, 3 sentences max. Save it to ~/.zora/workspace/draft-email.md"
```

### Example 3: Git repo health check

```bash
node dist/cli/index.js ask "Check the git status of ~/Projects/myapp. Are there uncommitted changes? Any branches that haven't been merged in over 2 weeks? Give me a summary."
```

### Example 4: Code review

```bash
node dist/cli/index.js ask "Look at the last 3 commits in ~/Projects/myapp and tell me if there are any obvious bugs, security issues, or style problems."
```

### Example 5: Research and compile

```bash
node dist/cli/index.js ask "Search my daily notes in ~/.zora/memory/daily/ for anything related to 'project deadlines' and compile a timeline of upcoming due dates."
```

### Example 6: Multi-step task

```bash
node dist/cli/index.js ask "In ~/Projects/website: 1) Run npm test 2) If any tests fail, fix them 3) Run the tests again to verify 4) Write a summary of what was broken and how it was fixed to ~/.zora/workspace/test-report.md"
```

![LCARS Divider](archive/v5-spec/assets/lcars_divider.svg)

## How Zora Remembers Things

Unlike a chatbot that forgets everything when you close the tab, Zora has a **built-in memory system** that persists between sessions.

```
┌──────────────────────────────────────────────────────────────┐
│                    ZORA'S MEMORY SYSTEM                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  LONG-TERM MEMORY  ──→  ~/.zora/memory/MEMORY.md            │
│  (permanent)            Your goals, preferences, brand       │
│                         guidelines, project context.         │
│                         Zora reads this every time.          │
│                                                              │
│  DAILY NOTES  ─────→  ~/.zora/memory/daily/                  │
│  (rolling window)       One file per day. Zora logs what     │
│                         it did, what worked, what didn't.    │
│                         Keeps the last 7 days by default.    │
│                                                              │
│  EXTRACTED FACTS  ──→  ~/.zora/memory/items/                 │
│  (auto-organized)       Key facts Zora picks out from        │
│                         conversations and tasks. Sorted      │
│                         into categories automatically.       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### How to use the memory system

**Tell Zora about yourself** by editing the long-term memory file:

```bash
open -e ~/.zora/memory/MEMORY.md
```

Add things like:
- Your name and role
- Projects you're working on and their goals
- Writing style preferences ("I prefer casual tone", "always use Oxford commas")
- Brand guidelines if you have a business
- Things you want Zora to always keep in mind

**Example MEMORY.md:**

```markdown
# About Me
- Name: Alex
- Role: Freelance developer and content creator
- Main project: MyMoneyCoach.ai (personal finance education platform)

# Preferences
- Writing tone: Friendly, approachable, never corporate-speak
- Code style: Prefer TypeScript, functional patterns, minimal dependencies
- Always use semantic commit messages

# Current Goals
- Launch blog by end of March
- Migrate API from Express to Fastify
- Build email subscriber list to 1,000
```

Zora reads this file at the start of every task, so it always has context about who you are and what matters to you.

### Reading what Zora remembers

```bash
# See today's daily note
cat ~/.zora/memory/daily/$(date +%Y-%m-%d).md

# See all extracted memory items
ls ~/.zora/memory/items/

# See memory categories
ls ~/.zora/memory/categories/

# Ask Zora to summarize its own memory
node dist/cli/index.js ask "Summarize what you remember about my recent work from your daily notes and memory items."
```

![LCARS Divider](archive/v5-spec/assets/lcars_divider.svg)

## Automating Tasks with Routines

Routines are tasks that Zora runs automatically on a schedule -- like a cron job, but powered by AI.

### How routines work

```
┌──────────────────────────────────────────────────────────────┐
│                    HOW ROUTINES WORK                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. You write a .toml file describing the task               │
│  2. You set a schedule (daily at 8am, every Monday, etc.)    │
│  3. Zora's Routine Manager picks it up automatically         │
│  4. At the scheduled time, Zora executes the task            │
│  5. Results are saved to the location you specify            │
│                                                              │
│  SCHEDULE FORMAT (cron-style):                               │
│                                                              │
│  "0 8 * * 1-5"  =  8:00 AM, Monday through Friday           │
│  "0 8 * * 2"    =  8:00 AM, every Tuesday                   │
│  "0 9 * * *"    =  9:00 AM, every day                        │
│  "0 7 1 * *"    =  7:00 AM, first day of every month        │
│                                                              │
│  ┌───────── minute (0-59)                                    │
│  │ ┌─────── hour (0-23)                                      │
│  │ │ ┌───── day of month (1-31)                              │
│  │ │ │ ┌─── month (1-12)                                     │
│  │ │ │ │ ┌─ day of week (0=Sun, 1=Mon ... 6=Sat)            │
│  │ │ │ │ │                                                    │
│  0 8 * * 1-5                                                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Example routines (included in the project)

Zora ships with three example routines in the `examples/routines/` folder:

**1. Weekly Content Pipeline** (`content-pipeline.toml`)
Every Tuesday at 8 AM: writes a blog post, generates social media content, and schedules everything for the week.

**2. Daily Repo Cleanup** (`repo-cleanup.toml`)
Every weekday at 9 AM: checks all your git repos for stale branches, uncommitted changes, and out-of-date remotes.

**3. Daily Job Search** (`job-search.toml`)
Every weekday at 7 AM: searches job boards, filters matches, drafts personalized cover letters for the top 3 results.

### Writing your own routine

Create a `.toml` file with this structure:

```toml
[routine]
name = "my-daily-summary"
schedule = "0 18 * * 1-5"       # 6 PM on weekdays
model_preference = "claude"      # which AI brain to use
timeout = "15m"                  # max time allowed

[routine.task]
prompt = """
End-of-day summary:

1. Check my daily notes for today
2. List the top 3 things accomplished
3. Note any unfinished items
4. Write a 5-sentence summary to ~/.zora/workspace/daily/{date}-summary.md
"""
```

Save this file and Zora will pick it up when running as a daemon (`node dist/cli/index.js start`).

![LCARS Divider](archive/v5-spec/assets/lcars_divider.svg)

## The Dashboard (Your Control Panel)

Zora includes a local web dashboard so you can see what's happening without using the terminal. It's styled with a retro-futuristic LCARS look (yes, like Star Trek).

```
┌──────────────────────────────────────────────────────────────┐
│              ZORA TACTICAL DASHBOARD                         │
├────────────────────┬─────────────────────────────────────────┤
│  PROVIDER STATUS   │  What it shows:                        │
│  ● Claude: LIVE    │  Whether each AI brain is online,      │
│  ● Gemini: LIVE    │  authenticated, and within quota.      │
├────────────────────┼─────────────────────────────────────────┤
│  TASK MONITOR      │  What it shows:                        │
│                    │  Active tasks, completed tasks,        │
│                    │  execution history, and any errors.    │
├────────────────────┼─────────────────────────────────────────┤
│  NEURAL STEERING   │  What it does:                         │
│                    │  Send course corrections to a running  │
│                    │  task. Example: "Focus on the login    │
│                    │  page, skip the admin panel for now."  │
│                    │  Zora adjusts without restarting.      │
├────────────────────┼─────────────────────────────────────────┤
│  MEMORY VIEW       │  What it shows:                        │
│                    │  Contents of long-term memory, recent  │
│                    │  daily notes, and extracted facts.     │
└────────────────────┴─────────────────────────────────────────┘
```

### Accessing the dashboard

```bash
# Start Zora (dashboard starts automatically on port 8070)
node dist/cli/index.js start

# Open in your browser
open http://localhost:8070
```

### Neural Steering: the coolest feature

Imagine Zora is halfway through a big task and you realize you want it to change direction. With regular tools, you'd have to stop everything and start over. With Neural Steering, you type a message into the dashboard and Zora adjusts mid-task.

**Example:**
- You asked Zora to "review all files in ~/Projects/app"
- 10 minutes in, you realize you only care about the API folder
- In the dashboard, you type: "Only focus on src/api/ -- skip everything else"
- Zora reads your steering message and narrows its focus without losing progress

![LCARS Divider](archive/v5-spec/assets/lcars_divider.svg)

## Multi-Model Architecture

Zora supports multiple AI providers and model tiers. Pick the right model for each task — expensive for hard problems, cheap for simple ones, local for zero-cost work.

```
┌──────────────────────────────────────────────────────────────┐
│                  MULTI-MODEL SYSTEM                          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  CLAUDE (Opus / Sonnet / Haiku)                              │
│  ├── Opus: complex reasoning, architecture, difficult tasks  │
│  ├── Sonnet: balanced quality + cost for coding, writing     │
│  ├── Haiku: fast and cheap for summaries, content, simple    │
│  └── Connected via the official Claude Agent SDK             │
│                                                              │
│  GEMINI                                                      │
│  ├── Best at: search, large documents, structured data       │
│  └── Connected via the Gemini CLI                            │
│                                                              │
│  OLLAMA (Local Models)                                       │
│  ├── Llama, Mistral, Qwen, DeepSeek, etc.                   │
│  ├── Runs on your machine — zero API cost, no limits         │
│  └── Connected via Ollama REST API                           │
│                                                              │
│  FAILOVER (Automatic):                                       │
│  ├── Provider hits rate limit? → Next one takes over         │
│  ├── Full context is handed off (nothing is lost)            │
│  └── When the original recovers, it can pick back up         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### What this means for you

- **You don't have to do anything.** The failover is automatic.
- **Your work doesn't stop.** If one provider goes down, the next picks up right where it left off.
- **You can pick models per task.** In routine files, use `model_preference = "claude-haiku"` for cheap tasks or `"ollama"` for free local execution.
- **You can cap costs.** Set `max_cost_tier = "free"` on a routine to only use free providers (Haiku, Gemini, Ollama).
- **You can add more providers.** See the [Architecture docs](archive/v5-spec/docs/ARCHITECTURE.md) for details.

![LCARS Divider](archive/v5-spec/assets/lcars_divider.svg)

## Security: What Zora Can and Can't Do

Zora runs autonomously, which means security boundaries matter. The `policy.toml` file is your control switch.

> **v0.6 Security:** Zora has been hardened against OWASP LLM Top 10 (2025) and OWASP Agentic Top 10 (ASI-2026). See [SECURITY.md](../SECURITY.md) for the full guide.

### The four security presets

Pick a starting point that matches your comfort level:

```
┌──────────────────────────────────────────────────────────────┐
│                    SECURITY PRESETS                          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  LOCKED (Fresh install default)                              │
│  ├── Zero access -- nothing is permitted                     │
│  ├── Run `zora-agent init` to choose a real preset                 │
│  └── Budget: 0 actions, 0 tokens                             │
│                                                              │
│  SAFE (Start here if nervous)                                │
│  ├── Read-only file access                                   │
│  ├── No shell commands at all                                │
│  ├── Zora can look but not touch                             │
│  ├── Budget: 100 actions, 200K tokens (hard stop)            │
│  └── Best for: first-time users, sensitive environments      │
│                                                              │
│  BALANCED (Recommended for most people)                      │
│  ├── Read/write inside ~/Projects and ~/.zora                │
│  ├── Safe shell commands (git, node, npm, ls, etc.)          │
│  ├── Dangerous commands blocked (sudo, rm, chmod)            │
│  ├── Budget: 500 actions, 1M tokens (asks before exceeding)  │
│  └── Best for: daily use, development work                   │
│                                                              │
│  POWER (For experienced users)                               │
│  ├── Broader file access (includes ~/Documents)              │
│  ├── More shell commands (python, pip, find, sed, etc.)      │
│  ├── Still blocks truly dangerous commands                   │
│  ├── Budget: 2,000 actions, 5M tokens                        │
│  └── Best for: power users who know the risks                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

Full preset configurations are in [Policy Presets](archive/v5-spec/docs/POLICY_PRESETS.md).

### Key concepts in plain English

| Concept | What it means |
|---------|---------------|
| **Allowed paths** | Folders Zora can read from and write to. Everything else is off-limits. |
| **Denied paths** | Folders that are always blocked, even if a parent folder is allowed. |
| **Allowlist mode** | Zora can ONLY run commands on the list. Everything else is denied. |
| **Action budgets** | Per-session limits on how many actions Zora can take. Prevents unbounded loops. |
| **Dry-run mode** | Preview what Zora *would* do without actually executing. Great for testing configs. |
| **Reversible actions** | Things Zora can undo (writing a file, making a folder). These run freely. |
| **Irreversible actions** | Things that can't be undone (pushing to git). Flagged for approval. |
| **Intent capsules** | Cryptographic signatures that detect if Zora's goal gets hijacked mid-task. Automatic. |
| **Audit log** | A record of every action Zora takes. Stored in `~/.zora/audit/audit.jsonl`. Tamper-proof via hash chains. |

### The golden rule of security

**Start restrictive. Expand as you build trust.**

If Zora tells you it can't do something because of policy, you can update `~/.zora/policy.toml` to allow it -- but do so deliberately.

![LCARS Divider](archive/v5-spec/assets/lcars_divider.svg)

## Tips for Getting the Best Results

### 1. Write a good MEMORY.md

This is the single biggest thing you can do to improve Zora's output. The more context it has about you, your projects, and your preferences, the more relevant and useful its work will be.

### 2. Be specific in your tasks

Instead of "clean up my project", say "In ~/Projects/myapp, delete all `.log` files, remove unused npm dependencies, and format all `.ts` files with prettier."

### 3. Tell Zora where to save output

Always include a file path when you want Zora to produce something:
```bash
node dist/cli/index.js ask "Write a weekly report and save it to ~/.zora/workspace/reports/week-12.md"
```

### 4. Use multi-step instructions

Zora handles numbered lists well. Break complex tasks into steps:
```bash
node dist/cli/index.js ask "1) Check the test suite 2) Fix any failures 3) Run again to verify 4) Summarize what changed"
```

### 5. Review the audit log

Curious what Zora has been doing? Check the audit log:
```bash
# See recent actions
tail -20 ~/.zora/audit/audit.jsonl
```

### 6. Start with the Balanced policy preset

Don't overthink security on day one. The Balanced preset is safe enough for daily use and permissive enough to be useful.

![LCARS Divider](archive/v5-spec/assets/lcars_divider.svg)

## Frequently Asked Questions

### "Is my data sent to the cloud?"

No. Zora runs locally on your machine. The only network traffic is to the AI providers (Claude and Gemini APIs) to process your tasks. Your files, memory, and audit logs stay on your computer.

### "Can Zora delete my files?"

Only if your policy allows it. With the default setup, destructive commands like `rm` and `sudo` are blocked. You would have to explicitly add them to the allowed commands list.

### "What happens if both Claude and Gemini are down?"

Zora queues the task in its **Persistent Retry Queue** and retries automatically with increasing wait times. Your task won't be lost.

### "Can I use Zora without Gemini?"

Yes. Gemini is optional. If you only have Claude configured, Zora will use Claude for everything. You just won't have automatic failover.

### "How do I update Zora?"

```bash
cd ~/zora
git pull origin main
npm install
npm run build
```

### "Can Zora access the internet?"

Yes, within the boundaries of your `policy.toml`. By default, all domains are allowed. You can restrict this to specific domains if you want.

### "What's the Heartbeat System?"

Every 30 minutes, Zora checks a file called `HEARTBEAT.md` for pending maintenance tasks. It's like a to-do list that Zora processes proactively even when you haven't asked it to do anything.

### "Can I run multiple tasks at once?"

Yes. Zora supports up to 3 parallel jobs by default (configurable in `config.toml` under `max_parallel_jobs`).

### "Where do I go for help?"

- Check the [Troubleshooting section](../SETUP_GUIDE.md#troubleshooting) in the Setup Guide
- Browse the [full technical spec](archive/v5-spec/ZORA_AGENT_SPEC.md) for deep details
- Open an issue at [github.com/ryaker/zora/issues](https://github.com/ryaker/zora/issues)

![LCARS Divider](archive/v5-spec/assets/lcars_divider.svg)

## Quick Reference Card

```
┌──────────────────────────────────────────────────────────────┐
│                    ZORA QUICK REFERENCE                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  GIVE A TASK    node dist/cli/index.js ask "..."             │
│  CHECK STATUS   node dist/cli/index.js status                │
│  START DAEMON   node dist/cli/index.js start                 │
│  STOP DAEMON    node dist/cli/index.js stop                  │
│  DASHBOARD      http://localhost:8070                        │
│                                                              │
│  CONFIG FILES   ~/.zora/config.toml   (behavior)             │
│                 ~/.zora/policy.toml   (security)             │
│                                                              │
│  MEMORY         ~/.zora/memory/MEMORY.md      (permanent)    │
│                 ~/.zora/memory/daily/         (daily notes)  │
│                 ~/.zora/memory/items/         (auto-saved)   │
│                                                              │
│  LOGS           ~/.zora/audit/audit.jsonl     (all actions)  │
│                                                              │
│  EXAMPLES       examples/routines/            (templates)    │
│                                                              │
│  DOCS           SETUP_GUIDE.md                (installation) │
│                 docs/BEGINNERS_GUIDE.md       (this file)    │
│                 docs/archive/v5-spec/ZORA_AGENT_SPEC.md      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

*Build fast. Ship real output. Local first.*
