# Use Cases: Who Uses Zora and How

Zora is an AI agent that can complete complex workflows on your computer. Here's how different people use it.

---

## The Developer

**Meet Jamie**: Full-stack developer who wants to automate repetitive code tasks and keep repos clean.

### "Review my PR and find bugs"

```bash
zora-agent ask "Review PR #42 for potential bugs and edge cases"
```

**What happens:**
1. Zora reads the PR diff from GitHub
2. Analyzes changed files for common bug patterns (null checks, race conditions, edge cases)
3. Runs static analysis if configured
4. Writes findings to a review comment draft

**You get:** A detailed review with line-by-line feedback, ready to post or refine.

---

### "Run tests, fix failures, run again"

```bash
zora-agent ask "Run the test suite. If any tests fail, analyze the errors, fix them, and re-run until all pass."
```

**What happens:**
1. Zora runs `npm test` (or whatever your test command is)
2. Reads failure output and stack traces
3. Locates failing test files and implementation code
4. Makes targeted fixes based on error messages
5. Re-runs tests, repeating until green or hitting timeout

**You get:** Either a passing test suite or a clear summary of what's still broken and why.

---

### "Clean up stale git branches across all my repos"

```bash
zora-agent ask "Find all git repos in ~/Projects, check for branches merged >30 days ago, and delete them locally"
```

**What happens:**
1. Zora scans `~/Projects` for git repositories
2. For each repo, runs `git branch --merged` and checks last commit date
3. Identifies branches older than 30 days
4. Deletes local branches (asks permission for each repo if `always_flag` is set)

**You get:** Clean repos with only active branches remaining.

---

### "Refactor this function to use async/await"

```bash
zora-agent ask "Refactor the fetchData function in src/api.ts to use async/await instead of promises"
```

**What happens:**
1. Zora reads `src/api.ts`
2. Locates the `fetchData` function
3. Rewrites it using async/await syntax
4. Updates any dependent code that calls the function
5. Runs linter/formatter if configured

**You get:** Modernized code, ready to commit.

---

## The Writer/Creator

**Meet Alex**: Content creator juggling blog posts, newsletters, and social media.

### "Write a blog post about X in my voice"

```bash
zora-agent ask "Write a 1200-word blog post about remote work trends in 2026. Use the tone and style from my previous posts in ~/Writing/blog/"
```

**What happens:**
1. Zora reads your existing blog posts to learn your voice
2. Researches the topic (if grounding/search tools are enabled)
3. Drafts a post matching your style
4. Saves it to `~/.zora/workspace/drafts/remote-work-2026.md`

**You get:** A ready-to-edit draft that sounds like you wrote it.

---

### "Summarize these meeting notes"

```bash
zora-agent ask "Summarize the 5 meeting notes in ~/Meetings/ from this week into action items and key decisions"
```

**What happens:**
1. Zora reads all `.md` or `.txt` files in `~/Meetings/`
2. Extracts action items, decisions, and notable quotes
3. Organizes them by category or meeting
4. Writes a summary to `~/.zora/workspace/summaries/weekly-meetings.md`

**You get:** A clean, scannable summary instead of 20 pages of raw notes.

---

### "Draft 5 social media posts from this article"

```bash
zora-agent ask "Read my latest blog post and draft 5 social media posts (Twitter, LinkedIn, Instagram) promoting it"
```

**What happens:**
1. Zora reads the blog post
2. Identifies key insights and quotes
3. Adapts tone/length for each platform (threads for Twitter, professional for LinkedIn, visual for Instagram)
4. Saves drafts to `~/.zora/workspace/social/`

**You get:** Platform-optimized posts ready to schedule.

---

### "Proofread this document and fix grammar"

```bash
zora-agent ask "Proofread ~/Documents/proposal.md, fix grammar/spelling, improve clarity, but keep my voice"
```

**What happens:**
1. Zora reads `proposal.md`
2. Identifies typos, grammatical errors, and unclear phrasing
3. Makes inline fixes (or suggests them)
4. Preserves your original tone and structure

**You get:** A polished document with your ideas intact.

---

## The Small Business Owner

**Meet Sam**: Runs a consulting business, drowning in admin work.

### "Organize my invoices folder by client and date"

```bash
zora-agent ask "Organize all PDFs in ~/Downloads/Invoices/ into folders by client name and year"
```

**What happens:**
1. Zora reads each PDF to extract client name and date (OCR if needed)
2. Creates folder structure: `~/Invoices/ClientName/2026/`
3. Moves files into the correct folders
4. Renames files for consistency: `2026-02-13_ClientName_Invoice.pdf`

**You get:** A clean, searchable invoice archive.

---

### "Write a follow-up email to all clients I met this week"

```bash
zora-agent ask "Read my calendar for this week, find all client meetings, and draft personalized follow-up emails"
```

**What happens:**
1. Zora reads your calendar (via Google Workspace MCP or local calendar data)
2. Identifies client meetings based on titles/attendees
3. Drafts a unique follow-up email for each client
4. Saves drafts to `~/.zora/workspace/emails/`

**You get:** Personalized emails ready to send (you review and approve).

---

### "Create a weekly report of what happened in my business"

```bash
zora-agent ask "Summarize this week's activity: completed projects, new clients, revenue, and open tasks"
```

**What happens:**
1. Zora checks your project management tool, invoices, calendar, and notes
2. Compiles metrics: projects completed, new clients, revenue, meetings held
3. Lists outstanding tasks and upcoming deadlines
4. Writes a formatted report to `~/.zora/workspace/reports/week-of-2026-02-10.md`

**You get:** A snapshot of your week, perfect for accountability or investor updates.

---

### "Convert this spreadsheet data into a formatted PDF"

```bash
zora-agent ask "Take the client data in ~/Data/clients.csv and create a professional PDF report with charts"
```

**What happens:**
1. Zora reads the CSV file
2. Generates summary statistics and visualizations
3. Formats it into a branded PDF (using templates if configured)
4. Saves the PDF to `~/.zora/workspace/reports/client-report.pdf`

**You get:** A presentation-ready PDF from raw data.

---

## Next Steps

- **Want to try Zora?** Run `zora-agent ask "..."` with your own task.
- **Need security details?** See [SECURITY.md](./SECURITY.md) for what Zora can and can't do.
- **Want to automate recurring tasks?** Check out [ROUTINES_COOKBOOK.md](./ROUTINES_COOKBOOK.md) for copy-paste templates.
