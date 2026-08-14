# Routines Cookbook: Ready-to-Use Templates

Zora routines run on a schedule (like cron jobs) and execute AI-powered workflows automatically. Here are five copy-paste templates.

---

## How to Install a Routine

Each routine is **its own TOML file** in `~/.zora/routines/`. They do not go in
`config.toml`. `RoutineManager` creates that directory at boot and loads every
`.toml` file in it (`src/routines/routine-manager.ts`).

A routine file has exactly two tables: `[routine]` (the schedule and metadata)
and `[task]` (the prompt).

1. Create a file: `~/.zora/routines/<name>.toml`
2. Paste one of the blocks below into it
3. Restart the daemon so it picks the file up

**Example:**
```bash
mkdir -p ~/.zora/routines
nano ~/.zora/routines/daily-standup.toml   # or vim, VS Code, etc.
# Paste a routine below, save and exit

zora-agent daemon stop && zora-agent daemon start
```

There is no `zora-agent routines` command. To confirm a routine loaded, check
the daemon log for its name — an invalid definition is logged and skipped
rather than failing the boot.

Set `enabled = false` in `[routine]` to keep a file in place without scheduling it.

---

## 1. Daily Standup Summary

**What it does:** Every morning at 8:00 AM, summarize yesterday's git commits and open PRs across all your repos.

**When to use:** Start your day knowing what you and your team accomplished yesterday.

```toml
[routine]
name = "daily-standup"
schedule = "0 8 * * *"
model_preference = "claude"
timeout = "10m"

[task]
prompt = """
Generate a daily standup summary:

1. Check all git repos in ~/Projects for commits from yesterday
2. List open PRs (if GitHub MCP is configured)
3. Identify any uncommitted changes across repos
4. Write summary to ~/.zora/workspace/daily/{date}-standup.md

Format: "Yesterday: [commits], Today: [open work], Blockers: [issues]"
"""
```

**What each field means:**
- `name` — Internal identifier (use lowercase-with-dashes)
- `schedule` — Cron expression (`0 8 * * *` = 8:00 AM daily)
- `model_preference` — Which provider to use. This is a **provider `name` from your `config.toml`**, not a model ID. `zora-agent init` generates providers named `claude` and `gemini`; add more (e.g. an `ollama` entry) and their names become valid here.
- `max_cost_tier` — Cost ceiling: `free`, `included`, `metered`, or `premium` (optional)
- `timeout` — Max runtime before the routine is killed
- `prompt` — The task Zora will execute

**Expected output:**
A file at `~/.zora/workspace/daily/2026-02-13-standup.md` with:
```
Yesterday:
- Committed "Fix bug in auth flow" to myapp (3 files)
- Merged PR #42 in myproject

Today:
- PR #45 open in myapp (awaiting review)
- Uncommitted changes in myproject (2 files)

Blockers: None
```

---

## 2. Weekly Inbox Cleanup

**What it does:** Every Monday at 9:00 AM, organize files in `~/Downloads` by type (PDFs, images, videos, etc.).

**When to use:** Keep your Downloads folder from becoming a disaster.

```toml
[routine]
name = "weekly-cleanup"
schedule = "0 9 * * 1"
model_preference = "gemini"
timeout = "15m"

[task]
prompt = """
Organize my Downloads folder:

1. Scan ~/Downloads for all files
2. Group by type: PDFs, images (jpg/png), videos (mp4), documents (docx/xlsx), archives (zip/tar)
3. Create folders: ~/Downloads/PDFs, ~/Downloads/Images, etc.
4. Move files into appropriate folders
5. Write summary to ~/.zora/workspace/cleanup/{date}-downloads.md

If a file doesn't fit a category, leave it in ~/Downloads.
"""
```

**What each field means:**
- `schedule = "0 9 * * 1"` — 9:00 AM every Monday (day 1 of the week)
- `model_preference = "gemini"` — Use Gemini for this task (good for bulk file operations)

**Expected output:**
- `~/Downloads/PDFs/`, `~/Downloads/Images/`, etc. folders created
- Files moved into the correct folders
- Summary at `~/.zora/workspace/cleanup/2026-02-10-downloads.md`:
  ```
  Organized 47 files:
  - 12 PDFs → ~/Downloads/PDFs/
  - 8 images → ~/Downloads/Images/
  - 3 videos → ~/Downloads/Videos/
  - 24 left unsorted
  ```

---

## 3. Nightly Code Review

**What it does:** Every evening at 6:00 PM, scan your projects for TODOs, FIXMEs, and uncommitted changes.

**When to use:** End your day knowing what needs attention tomorrow.

```toml
[routine]
name = "nightly-review"
schedule = "0 18 * * *"
model_preference = "claude"
timeout = "10m"

[task]
prompt = """
Run a nightly code review:

1. Search all files in ~/Projects for TODO, FIXME, HACK comments
2. Check all git repos for uncommitted changes
3. List repos that are behind their remote (need to pull)
4. Write findings to ~/.zora/workspace/daily/{date}-code-review.md
5. Send macOS notification with summary

Format: "TODOs: N, Uncommitted: N repos, Behind: N repos"
"""
```

**What each field means:**
- `schedule = "0 18 * * *"` — 6:00 PM daily
- `Send macOS notification` — Triggers a system notification (requires `osascript` access)

**Expected output:**
- File at `~/.zora/workspace/daily/2026-02-13-code-review.md`:
  ```
  TODOs (5):
  - ~/Projects/myapp/src/auth.ts:42 — TODO: Add rate limiting
  - ~/Projects/website/pages/index.tsx:18 — FIXME: Mobile layout broken

  Uncommitted changes (2 repos):
  - ~/Projects/myapp (3 files modified)
  - ~/Projects/website (1 file modified)

  Behind remote (1 repo):
  - ~/Projects/myapp (5 commits behind origin/main)
  ```
- macOS notification: "TODOs: 5, Uncommitted: 2 repos, Behind: 1 repo"

---

## 4. Monthly Report Generator

**What it does:** On the 1st of every month at 10:00 AM, compile your daily notes into a monthly summary.

**When to use:** Track long-term progress or generate reports for stakeholders.

```toml
[routine]
name = "monthly-report"
schedule = "0 10 1 * *"
model_preference = "gemini"
timeout = "20m"

[task]
prompt = """
Generate a monthly report:

1. Read all daily notes from ~/.zora/workspace/daily/ for the previous month
2. Summarize key activities: commits, PRs, meetings, tasks completed
3. Identify recurring themes or blockers
4. Calculate productivity metrics (commits per week, PRs merged, etc.)
5. Write report to ~/.zora/workspace/reports/{month}-summary.md

Format: Executive summary (3 sentences), detailed breakdown, metrics.
"""
```

**What each field means:**
- `schedule = "0 10 1 * *"` — 10:00 AM on the 1st of every month
- `timeout = "20m"` — Longer timeout for processing a month of data

**Expected output:**
- File at `~/.zora/workspace/reports/2026-02-summary.md`:
  ```
  # February 2026 Summary

  Executive Summary:
  Completed 3 major features, merged 12 PRs, and fixed 8 bugs. Primary focus was the auth refactor. No major blockers.

  Activity Breakdown:
  - 47 commits across 5 repos
  - 12 PRs merged (avg 2 days to merge)
  - 8 bugs fixed
  - 6 meetings attended

  Metrics:
  - Commits/week: 11.75
  - PRs merged/week: 3
  - Active repos: 5

  Themes:
  - Authentication system overhaul
  - Performance optimization
  - Documentation improvements

  Blockers: None
  ```

---

## 5. Content Pipeline (Weekly Blog + Social Media)

**What it does:** Every Tuesday at 8:00 AM, generate a blog post and social media content for the week.

**When to use:** Automate a weekly content workflow (blogging, newsletters, social media).

```toml
[routine]
name = "content-pipeline"
schedule = "0 8 * * 2"
model_preference = "claude"
timeout = "30m"

[task]
prompt = """
It's Tuesday — time for the weekly content pipeline.

1. Check ~/.zora/memory/daily/ for content ideas from this week
2. Choose the most interesting topic
3. Write a 1200-word blog post in my voice (reference past posts in ~/Writing/blog/)
4. Generate 5 social media posts (Twitter, LinkedIn, Instagram) promoting the blog
5. Write blog to ~/.zora/workspace/content/{date}-blog.md
6. Write social posts to ~/.zora/workspace/content/{date}-social.md

Blog structure: Hook, context, insights, actionable takeaway, call-to-action.
Social posts: Platform-specific tone (threads for Twitter, professional for LinkedIn, visual for Instagram).
"""
```

**What each field means:**
- `schedule = "0 8 * * 2"` — 8:00 AM every Tuesday (day 2 of the week)
- `timeout = "30m"` — Longer timeout for research and writing
- `reference past posts in ~/Writing/blog/` — Zora will read existing posts to match your voice

**Expected output:**
- Blog post at `~/.zora/workspace/content/2026-02-11-blog.md`:
  ```markdown
  # Why Remote Work Failed (And How to Fix It)

  We've been doing remote work wrong. After 5 years of experimentation...
  [1200 words of content in your voice]
  ```

- Social posts at `~/.zora/workspace/content/2026-02-11-social.md`:
  ```
  TWITTER THREAD:
  1/ We've been doing remote work wrong.
  2/ The problem isn't Zoom fatigue — it's async communication.
  [Thread continues...]

  LINKEDIN POST:
  Remote work isn't failing because of technology. It's failing because we're trying to replicate office culture online.
  [Professional tone, 200 words]

  INSTAGRAM CAPTION:
  Unpopular opinion: Remote work failed because we didn't commit to it. Here's what we should've done instead 👇
  [Short, visual-first caption]
  ```

---

## Customizing These Templates

All these routines are starting points. Here's how to adapt them:

### Change the Schedule

Use cron syntax:
- `0 8 * * *` — 8:00 AM daily
- `0 9 * * 1` — 9:00 AM every Monday
- `0 18 * * 1-5` — 6:00 PM Monday through Friday
- `0 10 1 * *` — 10:00 AM on the 1st of every month
- `*/15 * * * *` — Every 15 minutes (use sparingly!)

### Switch the Provider

`model_preference` names a provider from your `config.toml`. On a fresh install
`zora-agent init` writes at most two, depending on which CLIs it detects:

- `model_preference = "claude"` — the `claude-sdk` provider. Best for reasoning, architecture, coding. Runs `claude-opus-5` by default.
- `model_preference = "gemini"` — the `gemini-cli` provider. Best for large context (e.g. reading months of notes), search, structured data.

To route a routine at a cheaper or local model, add a provider for it in
`config.toml` and use that entry's `name`. A second Claude entry pointed at a
smaller model, or an `ollama` entry for local models (Llama, Mistral — free, no
API limits, fully offline), both work:

```toml
[[providers]]
name = "claude-fast"
type = "claude-sdk"
rank = 2
capabilities = ["fast"]
cost_tier = "included"
enabled = true
model = "claude-haiku-4-5-20251001"
```

Then `model_preference = "claude-fast"`.

### Limit Cost per Routine

Use `max_cost_tier` to cap how much a routine can spend:

- `max_cost_tier = "free"` — Only use free providers (Haiku, Gemini, Ollama)
- `max_cost_tier = "included"` — Free + included-tier providers (skips premium)
- `max_cost_tier = "metered"` — Anything except premium
- `max_cost_tier = "premium"` — No limit (default)

The Router picks the cheapest capable provider within your ceiling. If no providers fit, it falls through to whatever's available (better expensive than broken).

### Adjust Timeout

- `timeout = "5m"` — Short tasks (standup summary, file organization)
- `timeout = "15m"` — Medium tasks (code review, content generation)
- `timeout = "30m"` — Long tasks (monthly reports, research-heavy workflows)

### Add Notifications

Include `Send macOS notification with summary` in the prompt to get alerts when the routine completes.

---

## Testing a Routine Before Scheduling

Run it manually first:

```bash
zora-agent ask "$(cat <<EOF
[paste the prompt from the routine here]
EOF
)"
```

This lets you verify the output before committing to a schedule.

---

## Viewing Routine Logs

Routines submit ordinary tasks, so their tool calls land in the audit log like
any other:

```bash
zora-agent audit --last 24h
```

To list what is installed, list the directory — there is no CLI command for it:

```bash
ls ~/.zora/routines/
```

---

## Next Steps

- **Copy a routine** from above into its own file under `~/.zora/routines/`
- **Test it manually** with `zora-agent ask "..."`
- **Let it run on schedule** and check `~/.zora/workspace/` for output
- **Iterate** — adjust the prompt, schedule, or timeout based on results

Happy automating!
