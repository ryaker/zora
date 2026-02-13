# Zora Configuration Playbook

A guided walkthrough for you and your AI assistant to dial in a Zora setup for your specific workflow.

---

## How to Use This Guide

1. Open a conversation with your AI assistant (Claude, etc.)
2. Tell it: *"I want to configure Zora for [your workflow]. Let's walk through the Configuration Playbook."*
3. Work through each section together — the assistant asks questions, you answer, and it builds your config

You can also read this solo and fill in the answers yourself, then run `zora init` with the right flags.

---

## Phase 1: Define Your Workflow

Before touching any config file, answer these questions clearly.

### 1.1 What is the task?

Describe what Zora should do in one paragraph. Be specific.

**Examples:**
- "Monitor my content calendar, write weekly blog posts in Sophia's voice, generate matching images, and schedule them on social media."
- "Refactor my TypeScript monorepo — rename modules, update imports, run tests, commit changes."
- "Summarize my daily emails, create action items in Google Tasks, and file important messages."

### 1.2 What does the task touch?

List every resource category the workflow needs:

| Resource | Needed? | Details |
|----------|---------|---------|
| **Files to read** | | Which directories? |
| **Files to write** | | Where does output go? |
| **Shell commands** | | Which tools? (git, npm, python, etc.) |
| **Network access** | | Which domains? (APIs, webhooks) |
| **MCP servers** | | Which integrations? |
| **Secrets/credentials** | | API keys, tokens? |

### 1.3 What should the task NEVER touch?

This is just as important. List explicit boundaries:

- Directories that are off-limits (credentials, personal files, system)
- Commands that should never run (destructive ops, package managers, etc.)
- Data that should never leave the machine

---

## Phase 2: Map Your Filesystem

Zora's policy controls which paths the agent can read and write. You need to map your actual directory structure.

### 2.1 Discover your layout

Run these commands and share the output with your assistant:

```bash
# Where do you code?
ls ~/Dev ~/Projects ~/Code ~/src ~/Developer 2>/dev/null

# What's in your home directory?
ls -d ~/*/

# Sensitive directories that exist
ls -d ~/.ssh ~/.gnupg ~/.aws ~/.config 2>/dev/null
```

### 2.2 Classify each directory

Work with your assistant to fill in this table:

| Path | Access Level | Reason |
|------|-------------|--------|
| `~/Dev` | read + write | My code lives here |
| `~/.zora/workspace` | read + write | Zora's working area |
| `~/.zora/memory` | read + write | Agent memory |
| `~/Documents` | read only | Reference docs, never modify |
| `~/.ssh` | **denied** | SSH keys |
| `~/.gnupg` | **denied** | GPG keys |
| `~/.aws` | **denied** | Cloud credentials |
| `/` | **denied** | System root |

### 2.3 The golden rule

> **Start narrow, widen later.** It's easy to add a path to `allowed_paths`. It's hard to undo damage from an overly broad policy.

---

## Phase 3: Choose Your Shell Posture

Zora supports three shell modes. Pick one based on your risk tolerance.

### Mode comparison

| Mode | What it means | Best for |
|------|---------------|----------|
| `deny_all` | No shell commands at all | Read-only tasks, first run, paranoia |
| `allowlist` | Only listed commands run | Most workflows (recommended) |
| `denylist` | Everything EXCEPT listed commands | Power users who understand risks |

### Building your allowlist

If using `allowlist` mode (recommended), build the list from your workflow:

**Step 1: Start with safe universals**
```toml
allowed_commands = ["ls", "pwd", "cat", "head", "tail", "wc", "grep", "find", "which", "echo"]
```

**Step 2: Add your dev tools**
```toml
# Node.js stack
"node", "npm", "npx", "tsc", "vitest"

# Python stack
"python3", "pip", "pip3"

# Rust stack
"cargo", "rustc", "rustup"

# Go stack
"go"
```

**Step 3: Add git (if the workflow commits)**
```toml
"git"
```

**Step 4: Add workflow-specific tools**
```toml
# Content workflows
"rg"        # ripgrep for searching

# Data processing
"jq", "yq"  # JSON/YAML processing

# Build tools
"make", "cmake"
```

**Step 5: Explicitly deny dangerous commands**
```toml
denied_commands = ["sudo", "rm", "chmod", "chown", "curl", "wget", "kill", "shutdown", "reboot"]
```

### Execution time limits

Set `max_execution_time` based on your longest expected command:

| Workflow | Suggested limit |
|----------|----------------|
| Quick tasks (grep, git status) | `1m` |
| Build + test cycles | `5m` |
| Large builds, data processing | `10m` |
| Long-running jobs | `30m` |

---

## Phase 4: Configure Actions

Actions classify tool operations by reversibility. This determines what Zora auto-approves vs. flags for review.

### 4.1 Reversible actions (auto-approved)

These can be undone. Safe to allow:

```toml
reversible = ["write_file", "edit_file", "git_commit", "mkdir", "cp", "mv"]
```

### 4.2 Irreversible actions (logged, may be flagged)

These can't be undone. Always log, consider flagging:

```toml
irreversible = ["git_push", "shell_exec_destructive"]
```

### 4.3 Always-flag actions (requires human steering)

These pause execution and wait for approval:

```toml
always_flag = ["git_push"]
```

### Decision framework

Ask: *"If this action went wrong, could I undo it in under 5 minutes?"*
- **Yes** -> reversible
- **No** -> irreversible
- **No, and it affects others** -> always_flag

---

## Phase 5: Network Policy

### 5.1 Default: HTTPS only

```toml
[network]
allowed_domains = ["https://*"]
denied_domains = []
max_request_size = "10mb"
```

### 5.2 Restrict to specific domains

If your workflow only needs specific APIs:

```toml
allowed_domains = [
  "https://api.github.com",
  "https://registry.npmjs.org",
  "https://api.anthropic.com"
]
```

### 5.3 Block specific domains

If you want broad access minus certain sites:

```toml
allowed_domains = ["https://*"]
denied_domains = [
  "https://malware-domain.example",
  "http://*"    # Block all non-HTTPS
]
```

---

## Phase 6: Provider Setup

Providers are the LLMs that Zora routes tasks to. Each has a rank (priority) and capabilities.

### 6.1 Detect what you have

Run these commands:

```bash
# Check for Claude CLI
which claude && claude --version

# Check for Gemini CLI
which gemini && gemini --version

# Check Node.js version
node --version
```

Or run `zora init` which does this automatically.

### 6.2 Provider types

| Type | CLI Required | Auth Method | Cost |
|------|-------------|-------------|------|
| `claude-sdk` | `claude` | Mac session (automatic) | Included with Pro/Max |
| `gemini-cli` | `gemini` | Google Workspace SSO | Included with Workspace |
| `openai-api` | None (API) | API key env var | Metered |
| `ollama` | `ollama` | None (local) | Free |

### 6.3 Ranking strategy

Rank = priority. Lower number = tried first.

| Strategy | How to rank |
|----------|-------------|
| Quality first | Claude (1) -> Gemini (2) -> Ollama (3) |
| Cost first | Ollama (1) -> Gemini (2) -> Claude (3) |
| Speed first | Ollama (1) -> Claude (2) -> Gemini (3) |
| Single provider | Use routing mode `provider_only` |

### 6.4 Capabilities

Tag each provider with what it's good at:

| Capability | Meaning | Good providers |
|-----------|---------|----------------|
| `reasoning` | Complex logic, planning | Claude, GPT-4 |
| `coding` | Write/review code | Claude, Gemini |
| `creative` | Writing, brainstorming | Claude, GPT-4 |
| `structured-data` | JSON, tables, parsing | Gemini, Claude |
| `large-context` | 100K+ token input | Gemini (1M), Claude (200K) |
| `search` | Web/knowledge search | Gemini |
| `fast` | Low latency responses | Ollama, Haiku |

---

## Phase 7: MCP Server Wiring

MCP servers extend Zora with external tools. Only wire what your workflow needs.

### 7.1 Common MCP servers

| Server | Purpose | When you need it |
|--------|---------|------------------|
| GitHub | PRs, issues, code search | Code workflows |
| Google Workspace | Gmail, Calendar, Drive | Productivity workflows |
| Filesystem | File operations | Always (usually built-in) |
| Memory (Mem0) | Persistent memory across sessions | Long-running projects |
| Nanobanana | AI image generation | Content/marketing workflows |
| Asset Intelligence | Image catalog management | Image-heavy workflows |
| Chrome DevTools | Browser automation | Testing, scraping workflows |

### 7.2 MCP config format

```toml
[mcp.servers.github]
command = "npx"
args = ["-y", "@anthropic-ai/mcp-server-github"]

[mcp.servers.filesystem]
command = "npx"
args = ["-y", "@anthropic-ai/mcp-server-filesystem", "~/Dev"]

[mcp.servers.memory]
type = "http"
url = "http://localhost:8180/mcp"
```

### 7.3 Security implications of MCP

Each MCP server you wire up expands the agent's attack surface:
- **GitHub MCP** = can create PRs, comment on issues, push code
- **Google Workspace** = can send emails, create calendar events
- **Filesystem** = can read/write files in specified paths

> Only wire MCP servers that your workflow actually needs. Each one is an additional vector.

---

## Phase 8: Skills Selection

Skills are Claude Code's modular capability system. They load on-demand based on trigger keywords.

### 8.1 Inventory your installed skills

```bash
ls ~/.claude/skills/
```

### 8.2 Skills relevant to common workflows

**Code development:**
- `code-review` — PR and code quality review
- `frontend-design` — UI component creation
- `shadcn-ui` — shadcn/ui component library

**Content creation:**
- `storybrand-content-engine` — Blog writing (StoryBrand framework)
- `circular-soundbite-generator` — Social media posts from blog content
- `sophia-image-generator` — AI character image generation
- `content-calendar-orchestrator` — Weekly content planning

**Document handling:**
- `pdf` — PDF extraction and creation
- `docx` — Word document creation
- `pptx` — PowerPoint generation
- `xlsx` — Excel spreadsheet manipulation

**DevOps / infrastructure:**
- `mcp-builder` — MCP server development
- `mac-mini-ops` — Remote Mac Mini operations

### 8.3 Skills don't need config

Skills auto-activate based on their description matching your request. You don't need to "enable" them — just install them in `~/.claude/skills/`.

---

## Phase 9: Generate Your Config

Now that you've answered all the questions above, you can generate your config.

### Option A: Use `zora init` with flags

```bash
zora init --preset balanced --dev-path ~/Dev -y
```

Then manually edit the generated files to match your answers.

### Option B: Let your AI assistant generate it

Share your answers from Phases 1-8 with your assistant and ask:
*"Based on my answers, generate my `config.toml` and `policy.toml`."*

### Option C: Use the `zora-config-advisor` skill

If you have the skill installed:
*"Help me configure Zora for [your workflow]."*

---

## Phase 10: Validate and Test

### 10.1 Validate TOML syntax

```bash
# Quick parse check
npx tsx -e "import {parse} from 'smol-toml'; import {readFileSync} from 'fs'; parse(readFileSync('$HOME/.zora/config.toml','utf-8')); console.log('config.toml OK')"
npx tsx -e "import {parse} from 'smol-toml'; import {readFileSync} from 'fs'; parse(readFileSync('$HOME/.zora/policy.toml','utf-8')); console.log('policy.toml OK')"
```

### 10.2 Test with a safe task

```bash
zora ask "List the files in my dev directory and summarize what projects I have"
```

### 10.3 Test a real workflow task

Run the actual task you're configuring for, but start with a dry-run variant:

```bash
# Instead of "refactor my auth module"
zora ask "Analyze my auth module and suggest refactoring improvements (read-only, don't modify anything)"
```

### 10.4 Review the audit log

```bash
cat ~/.zora/audit/audit.jsonl | tail -20
```

Check for policy violations — they show where your policy is too restrictive (or too loose).

---

## Quick Reference: Example Configs by Workflow

### Code refactoring

```toml
# policy.toml
[filesystem]
allowed_paths = ["~/Dev/my-project", "~/.zora/workspace", "~/.zora/memory/daily"]
denied_paths = ["~/.ssh", "~/.gnupg", "/"]

[shell]
mode = "allowlist"
allowed_commands = ["git", "node", "npm", "npx", "tsc", "vitest", "ls", "pwd", "grep", "find"]
denied_commands = ["sudo", "rm", "chmod", "curl"]
max_execution_time = "5m"

[actions]
reversible = ["write_file", "edit_file", "git_commit", "mkdir"]
irreversible = ["git_push"]
always_flag = ["git_push"]
```

### Content pipeline

```toml
# policy.toml
[filesystem]
allowed_paths = ["~/Dev/my-blog", "~/nanobanana-images", "~/.zora/workspace", "~/.zora/memory/daily"]
denied_paths = ["~/.ssh", "~/.gnupg", "~/Library", "/"]

[shell]
mode = "allowlist"
allowed_commands = ["ls", "pwd", "cat", "python3", "node", "npm", "git", "rg"]
denied_commands = ["sudo", "rm", "chmod"]
max_execution_time = "5m"

[actions]
reversible = ["write_file", "edit_file", "git_commit", "mkdir", "cp"]
irreversible = ["git_push"]
always_flag = ["git_push"]
```

### Data analysis (read-heavy)

```toml
# policy.toml
[filesystem]
allowed_paths = ["~/Data", "~/Reports", "~/.zora/workspace"]
denied_paths = ["~/.ssh", "~/.gnupg", "~/.aws", "~/Library", "/"]

[shell]
mode = "allowlist"
allowed_commands = ["python3", "pip3", "ls", "pwd", "cat", "head", "wc", "jq"]
denied_commands = ["sudo", "rm", "chmod", "curl", "wget", "git"]
max_execution_time = "10m"

[actions]
reversible = ["write_file", "mkdir"]
irreversible = []
always_flag = []
```

---

## Troubleshooting

### "Config not found" error

Run `zora init` to generate initial config files.

### Policy violations in audit log

This means Zora tried to do something your policy doesn't allow. Either:
1. **Widen the policy** if the action is legitimate
2. **Adjust the task** if the action shouldn't be needed

### Provider not available

Check `zora status` and verify:
- The CLI is installed and on PATH
- Authentication is valid
- The provider is `enabled = true` in config

### MCP server connection failures

Verify the server is running:
```bash
# For local servers
curl http://localhost:PORT/health

# For stdio servers
npx -y @anthropic-ai/mcp-server-name --help
```
