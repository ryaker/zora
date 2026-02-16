# Build Your Personal Operating System with Zora

A step-by-step cookbook for turning Zora into a personal AI operating system that manages your life, business, content, and projects — all from one place.

---

## What You're Building

By the end of this guide, you'll have:

1. **A persistent AI agent** that remembers everything about you and your work
2. **Organized memory** with daily briefs, projects, meetings, and archives
3. **Automated routines** that run your mornings, evenings, content pipeline, and inbox
4. **A web dashboard** where you can see and manage everything visually
5. **API connectivity** so external tools (Lovable, Notion, Slack) can talk to your agent
6. **A trained voice** so your agent writes content that sounds like you

This is the Zora equivalent of building a full personal operating system — but with security-first design, multi-model failover, and a tamper-proof audit trail baked in.

---

## Prerequisites

```bash
# Install Zora
npm i -g zora-agent

# Run the setup wizard (choose "Balanced" security preset)
zora-agent init

# Verify it works
zora-agent ask "What can you do?"
```

If you haven't set up Zora yet, follow the [Setup Guide](SETUP_GUIDE.md) first.

---

## Phase 1: Define Your Agent's Identity (SOUL.md)

Your agent's personality, priorities, and behavioral rules live in a single file called `SOUL.md`. This is injected into every task Zora runs — it's how the agent knows who it is and who it serves.

### Create your SOUL.md

```bash
zora-agent edit soul
```

Or edit directly:

```bash
nano ~/.zora/SOUL.md
```

### Template

```markdown
# Identity

You are [Agent Name], a personal AI operating system for [Your Name].
Your role is to manage tasks, projects, content, and documents.
You are proactive, organized, and always working in the background to keep things running.

# Owner

- Name: [Your Name]
- Time zone: [e.g., America/New_York]
- Role: [e.g., Agency owner, content creator, developer]
- Primary communication: [e.g., Slack, Telegram, CLI]

# Priorities

1. Protect the owner's time — automate repetitive work
2. Keep memory organized — never let context get stale
3. Maintain the daily brief — this is the source of truth for today
4. When in doubt, ask — don't assume intent on irreversible actions

# Rules

- Always update the daily brief after completing a task
- Save meeting notes under the correct category
- Archive daily briefs older than 7 days
- Never modify files outside the workspace without explicit permission
- Write content in the owner's voice (see Voice section below)

# Voice (for content generation)

- Tone: [e.g., Conversational, direct, no corporate-speak]
- Avoid: [e.g., Dashes at the start of sentences, buzzwords, filler words]
- Reference: See ~/Writing/voice-samples/ for example posts
```

---

## Phase 2: Build the Memory Architecture

The memory system is what turns a stateless chatbot into a persistent operating system. Zora has three memory tiers — you need to organize all three.

### Memory Directory Structure

```
~/.zora/memory/
├── MEMORY.md              # Long-term: who you are, preferences, key context
├── daily/                 # Rolling: one file per day (auto-created)
│   ├── 2026-02-16.md
│   ├── 2026-02-15.md
│   └── ...
├── items/                 # Structured: auto-extracted facts (JSON)
│   ├── abc123.json        # "Owner prefers TypeScript"
│   └── def456.json        # "Agency client: Acme Corp"
└── categories/            # Auto-organized topic summaries
    ├── projects.md
    ├── meetings.md
    └── content.md
```

### Set Up MEMORY.md (Your Index)

This is the master context file — Zora reads it at the start of every task. Think of it as the table of contents for everything your agent needs to know.

```bash
nano ~/.zora/memory/MEMORY.md
```

```markdown
# About Me
- Name: [Your Name]
- Role: [Your Role]
- Business: [Company/Project Name]
- Time zone: [Your timezone]

# Current Projects
- [Project 1]: [One-line description, status]
- [Project 2]: [One-line description, status]

# Key People
- [Name]: [Role, relationship, relevant context]
- [Name]: [Role, relationship, relevant context]

# Tools & Accounts
- Notion: Used for project docs and meeting notes
- Slack: Primary communication channel
- GitHub: Code repositories
- Fathom: Meeting recordings

# Content Strategy
- Platforms: [Twitter, LinkedIn, YouTube, etc.]
- Posting schedule: [e.g., 3x/week on Twitter, 1x/week blog]
- Voice reference: ~/Writing/voice-samples/

# Memory Organization Rules
- Daily briefs: Create each morning, update throughout the day
- Meetings: Categorize under agency/content/external/internal
- Archive: Move daily briefs older than 7 days to archive
- Projects: Detailed project docs in ~/.zora/workspace/projects/
```

### Configure Memory Settings in config.toml

```bash
zora-agent edit config
```

Add or update the `[memory]` section:

```toml
[memory]
long_term_file = "~/.zora/memory/MEMORY.md"
daily_notes_dir = "~/.zora/memory/daily"
items_dir = "~/.zora/memory/items"
categories_dir = "~/.zora/memory/categories"
context_days = 7                    # How many days of daily notes to load
max_context_items = 50              # Max memory items per task
auto_extract = true                 # Auto-learn from conversations
auto_extract_interval = "5m"        # How often to extract new facts
```

### Create the Project and Meeting Directories

Zora's memory is file-based, so you can add any directory structure you want inside the workspace:

```bash
mkdir -p ~/.zora/workspace/projects
mkdir -p ~/.zora/workspace/meetings/{agency,content,external,internal}
mkdir -p ~/.zora/workspace/references
mkdir -p ~/.zora/workspace/archive
mkdir -p ~/.zora/workspace/content
mkdir -p ~/.zora/workspace/reports
```

### Teach Zora to Use This Structure

Add this to your `MEMORY.md`:

```markdown
# Workspace Structure
- Projects: ~/.zora/workspace/projects/
- Meetings: ~/.zora/workspace/meetings/ (subfolders: agency, content, external, internal)
- References: ~/.zora/workspace/references/ (external resources, study guides)
- Archive: ~/.zora/workspace/archive/ (old daily briefs, completed projects)
- Content: ~/.zora/workspace/content/ (blog drafts, social media)
- Reports: ~/.zora/workspace/reports/ (weekly summaries, monthly reports)
```

Zora reads `MEMORY.md` on every task, so it will always know where to file things.

---

## Phase 3: Set Up Automated Routines

This is where your operating system comes alive. Routines are cron-scheduled tasks that run automatically in the background.

### Add Routines to config.toml

```bash
zora-agent edit config
```

### Routine 1: Morning Daily Brief (7:00 AM)

Creates a fresh daily brief every morning with your top priorities.

```toml
[[routines]]
name = "morning-brief"
schedule = "0 7 * * *"
model_preference = "claude"
timeout = "10m"

[routines.task]
prompt = """
Good morning. Create today's daily brief:

1. Read yesterday's daily brief from ~/.zora/memory/daily/
2. Check for any unfinished tasks from yesterday
3. Review my projects in ~/.zora/workspace/projects/ for deadlines
4. Create a new daily brief at ~/.zora/memory/daily/{today's date}.md with:
   - Top 3 priorities for today
   - Carry-over items from yesterday
   - Any scheduled meetings or deadlines
   - A "Notes" section (empty, to be filled throughout the day)
5. Save my top 3 priorities to memory
"""
```

### Routine 2: Update Daily Brief (Every 3 Hours)

Keeps the daily brief current as work gets done throughout the day.

```toml
[[routines]]
name = "brief-update"
schedule = "0 */3 * * *"
model_preference = "claude-haiku"
max_cost_tier = "included"
timeout = "5m"

[routines.task]
prompt = """
Update today's daily brief at ~/.zora/memory/daily/{today's date}.md:

1. Check what tasks have been completed since last update
2. Check for any new memory items or notes
3. Update the status of today's priorities
4. Add any new items that came up
5. Keep the format consistent with previous briefs
"""
```

### Routine 3: Meeting Importer (9:00 PM)

Pull and categorize meeting notes at end of day.

```toml
[[routines]]
name = "meeting-import"
schedule = "0 21 * * *"
model_preference = "claude-haiku"
max_cost_tier = "included"
timeout = "15m"

[routines.task]
prompt = """
End-of-day meeting import:

1. Check ~/Downloads/ and ~/Documents/ for any new meeting notes or transcripts
2. For each meeting found:
   a. Determine the category (agency, content, external, internal)
   b. Extract key decisions, action items, and participants
   c. Save a structured summary to ~/.zora/workspace/meetings/{category}/{date}-{topic}.md
   d. Cross-reference participants with known people in MEMORY.md
3. Update today's daily brief with meeting highlights
4. Save important facts to memory (new decisions, deadlines, commitments)
"""
```

### Routine 4: Nightly Cleanup (3:00 AM)

System maintenance — archive old notes, summarize the day.

```toml
[[routines]]
name = "nightly-cleanup"
schedule = "0 3 * * *"
model_preference = "ollama"
max_cost_tier = "free"
timeout = "15m"

[routines.task]
prompt = """
End-of-day system cleanup:

1. Finalize today's daily brief with a summary of what was accomplished
2. Archive any daily briefs older than 7 days:
   - Move them from ~/.zora/memory/daily/ to ~/.zora/workspace/archive/
3. Check ~/.zora/workspace/projects/ for any stale projects (no updates in 14+ days)
4. Summarize the day in 3 sentences and save to memory
5. Write a cleanup log to ~/.zora/workspace/reports/{date}-cleanup.md
"""
```

### Routine 5: Weekly Content Pipeline (Sunday 9:00 AM)

Draft all your content for the week.

```toml
[[routines]]
name = "weekly-content"
schedule = "0 9 * * 0"
model_preference = "claude"
timeout = "30m"

[routines.task]
prompt = """
It's Sunday — time to draft this week's content.

1. Review the past week's daily briefs for interesting topics and insights
2. Check my voice reference in ~/Writing/voice-samples/ to match my style
3. Choose 3-5 topics based on what happened this week or trending themes
4. For each topic, draft:
   - A Twitter/X post (thread-friendly, 1-3 tweets)
   - A LinkedIn post (professional tone, 150-250 words)
   - If the topic is strong enough, a blog post outline (500-1200 words)
5. Save all drafts to ~/.zora/workspace/content/{date}-weekly-content.md
6. Update today's daily brief with content summary
"""
```

### Routine 6: Heartbeat Check (Every 30 Minutes)

Monitor for unanswered messages and pending items.

```toml
[[routines]]
name = "heartbeat-check"
schedule = "*/30 * * * *"
model_preference = "ollama"
max_cost_tier = "free"
timeout = "5m"

[routines.task]
prompt = """
Quick heartbeat check:

1. Check if there are any pending steering messages
2. Review ~/.zora/workspace/ for any files that need attention
3. Check the retry queue for failed tasks
4. If anything urgent is found, add it to today's daily brief
"""
```

---

## Phase 4: Train Your Agent's Voice

To generate content that sounds like you, Zora needs reference material.

### Step 1: Collect Your Best Content

Gather your top-performing posts, emails, or articles into a reference folder:

```bash
mkdir -p ~/Writing/voice-samples
```

Copy 20-50+ examples of your writing into that folder — tweets, LinkedIn posts, blog posts, emails. The more variety, the better.

### Step 2: Create a Voice Profile

Ask Zora to analyze your writing and create a style guide:

```bash
zora-agent ask "Read all files in ~/Writing/voice-samples/ and create a detailed voice and style guide. Include: tone, sentence structure patterns, common phrases, vocabulary preferences, things I avoid, and formatting habits. Save the guide to ~/.zora/workspace/references/voice-guide.md"
```

### Step 3: Add Voice Rules to SOUL.md

Take the output and distill the key rules into your `SOUL.md`:

```markdown
# Voice Rules (for content generation)
- Write like a human, not a press release
- Short paragraphs (2-3 sentences max)
- Start with a hook — no throat-clearing
- Never use dashes to start sentences
- Avoid: "leverage", "synergy", "game-changer", "ecosystem"
- Use "you" more than "I"
- End with a clear takeaway or question
```

### Step 4: Reference in Routines

In your content routines, always include:

```
Reference my voice guide at ~/.zora/workspace/references/voice-guide.md
and match the style of posts in ~/Writing/voice-samples/
```

---

## Phase 5: Connect External Tools via MCP and APIs

Zora supports MCP (Model Context Protocol) servers for extending its capabilities. This is how you connect external services.

### Option A: MCP Servers (Built-in Integration)

Add MCP servers to your `config.toml`:

```toml
# Notion integration
[mcp.servers.notion]
type = "stdio"
command = "npx"
args = ["-y", "@notionhq/mcp-server"]
env = { NOTION_API_KEY = "${env:NOTION_API_KEY}" }

# Google Calendar
[mcp.servers.google-calendar]
type = "stdio"
command = "npx"
args = ["-y", "@anthropic/mcp-google-calendar"]
env = { GOOGLE_CREDENTIALS = "${env:GOOGLE_CREDENTIALS_PATH}" }

# Slack
[mcp.servers.slack]
type = "stdio"
command = "npx"
args = ["-y", "@anthropic/mcp-slack"]
env = { SLACK_BOT_TOKEN = "${env:SLACK_BOT_TOKEN}" }

# GitHub
[mcp.servers.github]
type = "stdio"
command = "npx"
args = ["-y", "@anthropic/mcp-github"]
env = { GITHUB_TOKEN = "${env:GITHUB_TOKEN}" }
```

### Option B: Store API References in Memory

If an MCP server isn't available for a service, store API keys and endpoints so Zora can use them via shell commands:

```bash
# Store a secret securely
zora-agent ask "Store this API key securely: my Notion API key is secret_abc123"
```

Or create an API reference document:

```bash
nano ~/.zora/workspace/references/api-reference.md
```

```markdown
# API Reference

## Notion
- Base URL: https://api.notion.com/v1
- API Key: (stored in Zora secrets manager)
- Database IDs:
  - Tasks: abc123
  - Projects: def456
  - Content Calendar: ghi789

## Supabase (Dashboard Backend)
- Project URL: https://your-project.supabase.co
- Endpoints:
  - Tasks: /rest/v1/tasks
  - Projects: /rest/v1/projects
  - Content: /rest/v1/content
  - Documents: /rest/v1/documents
- Auth: Bearer token (stored in Zora secrets manager)
```

Add to `MEMORY.md`:

```markdown
# API Reference
- Full API docs: ~/.zora/workspace/references/api-reference.md
- Secrets are stored in Zora's encrypted secrets manager
- Use `zora-agent ask` to interact with any API via shell (curl/httpie)
```

---

## Phase 6: Build a Visual Dashboard with Lovable

While Zora includes a built-in dashboard at `http://localhost:8070`, you can build a richer custom dashboard using Lovable (a no-code app builder) connected to a Supabase database.

### Step 1: Design with Your Agent

Ask Zora to scope the dashboard:

```bash
zora-agent ask "I want to build a project management dashboard in Lovable with a Supabase backend. It should manage tasks (kanban board), projects, content calendar, and documents. Design the Supabase schema and give me 3 sequential prompts I can feed to Lovable to build this. Reference Linear app's design language (dark mode, minimal, clean)."
```

### Step 2: Build in Lovable

Take the prompts Zora generates and feed them into Lovable sequentially. Typical phases:

1. **Prompt 1**: Core layout — kanban board, navigation, dark theme matching Linear
2. **Prompt 2**: Additional views — projects list, content calendar, document library
3. **Prompt 3**: Connect to Supabase — create tables, remove mock data, wire real data

### Step 3: Connect Supabase

In Lovable:
1. Go to Settings > Integrations > Supabase
2. Connect your Supabase project
3. Set up Row Level Security (RLS) for all tables
4. Get your Supabase REST API URL and keys

### Step 4: Give Zora Access to the Dashboard Backend

Store the Supabase credentials so Zora can create tasks, update projects, and manage content directly:

```bash
zora-agent ask "Store these API credentials securely:
- Supabase URL: https://your-project.supabase.co
- Supabase anon key: eyJhbGci...
- Supabase service key: eyJhbGci..."
```

Update your API reference:

```markdown
## Supabase (Lovable Dashboard)
- URL: https://your-project.supabase.co
- REST API: {URL}/rest/v1/{table}
- Headers: apikey: {anon_key}, Authorization: Bearer {service_key}
- Tables: tasks, projects, content, documents
- To create a task: POST /rest/v1/tasks with { title, status, description, assignee }
- To update a task: PATCH /rest/v1/tasks?id=eq.{id} with { status: "done" }
```

Now your routines can update the dashboard:

```toml
[[routines]]
name = "sync-dashboard"
schedule = "*/15 * * * *"
model_preference = "ollama"
max_cost_tier = "free"
timeout = "5m"

[routines.task]
prompt = """
Sync tasks between Zora workspace and the Supabase dashboard:

1. Check for any new tasks in ~/.zora/workspace/ that aren't in Supabase
2. Check for any status changes in Supabase that need to be reflected locally
3. Use curl to POST/PATCH the Supabase REST API (see ~/.zora/workspace/references/api-reference.md)
4. Log sync results to today's daily brief
"""
```

---

## Phase 7: Connect Messaging (Telegram or Slack)

### Telegram (Built-in)

Zora has a native Telegram gateway. Add to `config.toml`:

```toml
[steering.telegram]
enabled = true
allowed_users = ["your_telegram_user_id"]
rate_limit_per_min = 20
mode = "long_polling"
```

Set the environment variable:

```bash
export TELEGRAM_BOT_TOKEN="your-bot-token-from-botfather"
```

Now you can chat with your agent from your phone via Telegram, and it will:
- Execute tasks you send
- Respond with results
- Access your full memory and workspace
- Respect all security policies

### Slack (via MCP or Webhook)

For Slack integration, use the MCP server approach from Phase 5, or set up a Slack webhook:

```bash
zora-agent ask "Set up a workflow where you check Slack for unanswered messages every 30 minutes using the Slack MCP server, and respond to any that are directed at you."
```

---

## Phase 8: Team Access

If you want other people (team members, collaborators) to interact with your agent, use Zora's multi-agent teams feature.

### Create a Team

```bash
zora-agent team create my-agency
```

### Add Team Members

Each team member gets their own mailbox within the team directory:

```
~/.zora/teams/my-agency/
├── team.json              # Team configuration
├── coordinator-mailbox.json
├── aaron-mailbox.json
└── tom-mailbox.json
```

### Configure Team Access

Team members can send messages to the agent via their mailbox, and the agent can respond with context scoped to their role.

Add to `MEMORY.md`:

```markdown
# Team
- Aaron: Agency operations lead. Has access to agency projects and meetings.
- Tom: Content manager. Has access to content calendar and drafts.

When Aaron asks a question, reference agency meetings and projects.
When Tom asks a question, reference content pipeline and voice guide.
```

---

## Phase 9: The Daily Workflow

Here's what a typical day looks like once everything is set up:

```
 7:00 AM  ─  [morning-brief] Creates daily brief with top 3 priorities
 7:01 AM  ─  You check the brief on your dashboard or via Telegram
 9:00 AM  ─  [heartbeat] Checks for pending tasks, unanswered messages
10:00 AM  ─  You chat with your agent via Slack/Telegram throughout the day
10:00 AM  ─  [brief-update] Updates the daily brief (runs every 3 hours)
 1:00 PM  ─  [brief-update] Another update
 4:00 PM  ─  [brief-update] Afternoon update
 7:00 PM  ─  [brief-update] Evening update
 9:00 PM  ─  [meeting-import] Pulls and categorizes all meetings from today
10:00 PM  ─  [brief-update] Final update
 3:00 AM  ─  [nightly-cleanup] Archives old notes, summarizes the day

SUNDAY:
 9:00 AM  ─  [weekly-content] Drafts all content for the week
```

### Ad-hoc Commands

Between routines, you interact with your agent directly:

```bash
# Create a task on the dashboard
zora-agent ask "Create a new task on the Supabase dashboard: 'Write playbook on building an OS with Zora'. Set status to 'to-do' and link to the Notion doc."

# Ask about something from a meeting
zora-agent ask "What did we decide about the pricing model in last week's agency meeting?"

# Move a task to done
zora-agent ask "Mark the 'landing page redesign' task as done in Supabase and update the daily brief."

# Draft an email
zora-agent ask "Draft a follow-up email to the client from yesterday's meeting. Reference the action items we discussed."
```

---

## Phase 10: Iterate and Improve

Your operating system gets better as you use it. Here's how to keep improving:

### Review Memory Regularly

```bash
# See what Zora remembers
zora-agent memory search "projects"

# Check daily note quality
cat ~/.zora/memory/daily/$(date +%Y-%m-%d).md

# Verify the audit trail
zora-agent audit verify
```

### Tune Routines Based on Results

If a routine isn't producing good output:

1. Run it manually first: `zora-agent ask "[paste the prompt]"`
2. Review the output
3. Adjust the prompt — be more specific about format, sources, or scope
4. Test again before re-enabling the schedule

### Expand Over Time

Start with the core routines (morning brief, nightly cleanup) and add more as you build trust:

- **Email monitoring**: Check inbox for time-sensitive messages
- **Social media monitoring**: Track mentions, comments, DMs
- **Financial tracking**: Import and categorize transactions
- **Learning pipeline**: Summarize articles, videos, podcasts you consume
- **CRM updates**: Log client interactions and follow-ups

---

## Quick Reference

| What | Where |
|------|-------|
| Agent identity | `~/.zora/SOUL.md` |
| Configuration | `~/.zora/config.toml` |
| Security policy | `~/.zora/policy.toml` |
| Long-term memory | `~/.zora/memory/MEMORY.md` |
| Daily briefs | `~/.zora/memory/daily/` |
| Auto-extracted facts | `~/.zora/memory/items/` |
| Projects | `~/.zora/workspace/projects/` |
| Meetings | `~/.zora/workspace/meetings/` |
| Content drafts | `~/.zora/workspace/content/` |
| Reports | `~/.zora/workspace/reports/` |
| API reference | `~/.zora/workspace/references/api-reference.md` |
| Voice guide | `~/.zora/workspace/references/voice-guide.md` |
| Archive | `~/.zora/workspace/archive/` |
| Audit log | `~/.zora/audit/audit.jsonl` |
| Dashboard | `http://localhost:8070` |
| Routines | `~/.zora/config.toml` (inline) or `~/.zora/routines/` (files) |

---

## Zora vs. OpenClaw: Key Differences

| Feature | OpenClaw | Zora |
|---------|----------|------|
| Memory | Custom folder structure | Three-tier: long-term + daily + structured items with salience scoring |
| Security | No policy engine | OWASP-hardened policy engine with action budgets, intent verification, audit trails |
| Scheduling | Custom cron setup | Built-in routine manager with model preference and cost tier per routine |
| Dashboard | Build your own (or Lovable) | Built-in web dashboard + optional Lovable for custom UI |
| Failover | Single provider | Multi-provider (Claude + Gemini + Ollama) with automatic failover and retry queue |
| Messaging | Slack integration | Telegram gateway built-in, Slack via MCP |
| Audit | None | Hash-chain tamper-proof audit log of every action |
| Secrets | Stored in plaintext docs | AES-256-GCM encrypted secrets manager |
| Teams | Shared Slack channels | Multi-agent teams with per-member mailboxes |
| Cost control | None | Per-routine cost tier caps, action budgets, free-tier routing |

---

## Next Steps

- **Just getting started?** Set up Phase 1 (SOUL.md) and Phase 2 (Memory), then add one routine at a time.
- **Want the full setup?** Work through all 10 phases over a weekend.
- **Need help with configuration?** Run the config advisor: ask Zora to help you tune your `config.toml` and `policy.toml`.
- **Want to see examples?** Check `examples/routines/` for ready-to-use routine templates.
- **Have questions?** Open an issue at [github.com/ryaker/zora](https://github.com/ryaker/zora).
