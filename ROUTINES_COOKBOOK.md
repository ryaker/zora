# Routines Cookbook: Ready-to-Use Templates

Zora routines run on a schedule (like cron jobs) and execute AI-powered workflows automatically. Here are five copy-paste templates you can add to your `~/.zora/config.toml`.

---

## How to Install a Routine

1. Open `~/.zora/config.toml` in a text editor
2. Copy the entire `[[routines]]` block from below
3. Paste it at the end of your config file
4. Save and run `zora routines list` to verify

**Example:**
```bash
nano ~/.zora/config.toml  # or vim, VS Code, etc.
# Paste routine below
# Save and exit
zora routines list
```

---

## 1. Daily Standup Summary

**What it does:** Every morning at 8:00 AM, summarize yesterday's git commits and open PRs across all your repos.

**When to use:** Start your day knowing what you and your team accomplished yesterday.

```toml
[[routines]]
name = "daily-standup"
schedule = "0 8 * * *"
model_preference = "claude"
timeout = "10m"

[routines.task]
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
- `model_preference` — Which provider to use (e.g. `claude-opus`, `claude-haiku`, `gemini`, `ollama`)
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
[[routines]]
name = "weekly-cleanup"
schedule = "0 9 * * 1"
model_preference = "gemini"
timeout = "15m"

[routines.task]
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
[[routines]]
name = "nightly-review"
schedule = "0 18 * * *"
model_preference = "claude"
timeout = "10m"

[routines.task]
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
[[routines]]
name = "monthly-report"
schedule = "0 10 1 * *"
model_preference = "gemini"
timeout = "20m"

[routines.task]
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
[[routines]]
name = "content-pipeline"
schedule = "0 8 * * 2"
model_preference = "claude"
timeout = "30m"

[routines.task]
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

### Switch the AI Model

- `model_preference = "claude-opus"` — Best for complex reasoning, architecture, difficult tasks
- `model_preference = "claude-sonnet"` — Good balance of quality and cost for coding, writing
- `model_preference = "claude-haiku"` — Fast and cheap for simple tasks, content generation, summaries
- `model_preference = "gemini"` — Best for large context (e.g., reading months of notes), search, speed
- `model_preference = "ollama"` — Local models (Llama, Mistral, etc.) — free, no API limits, fully offline

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
zora ask "$(cat <<EOF
[paste the prompt from the routine here]
EOF
)"
```

This lets you verify the output before committing to a schedule.

---

## Viewing Routine Logs

Check the audit log to see when routines ran and what they did:

```bash
cat ~/.zora/audit/audit.jsonl | grep "routine:"
```

Or list all routines:

```bash
zora routines list
```

---

## Next Steps

- **Copy a routine** from above and add it to `~/.zora/config.toml`
- **Test it manually** with `zora ask "..."`
- **Let it run on schedule** and check `~/.zora/workspace/` for output
- **Iterate** — adjust the prompt, schedule, or timeout based on results

Happy automating!
