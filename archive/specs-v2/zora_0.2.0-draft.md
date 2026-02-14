# Zora — Technical Specification

> **Version:** 0.2.0-draft
> **Author:** Rich Yaker (ryaker@yaker.org)
> **Date:** 2026-02-11
> **Status:** REVIEWED — Incorporating Architectural Feedback
> **Methodology:** Spec-Driven Development (GitHub Spec Kit format)
> **Review:** v0.2 incorporates Gemini architectural review (concurrency safety, kill switch, auth fallback, fs watchers, context pruning, CLI output hardening)

---

## 1. Vision

Zora is a long-running, autonomous personal AI agent that runs locally on macOS. It gets shit done — executing complex, multi-step tasks without constant permission prompts, using Claude as its primary brain and Gemini as a secondary/failover engine. It draws architectural inspiration from six studied open-source projects (Nanobot, OpenClaw, IronClaw, Open Personal Agent, memU, ClawSec) while remaining a clean, purpose-built system designed around the Claude Code Agent SDK and Gemini CLI.

The core philosophy: **the agent works for you like a tireless, trusted employee who already has your credentials, knows your preferences, and can switch between tools and models to keep work flowing even when one provider hits quota limits.**

---

## 2. Goals & Non-Goals

### Goals

1. **Autonomous long-running execution** — The agent persists across sessions, maintains state, and works on tasks for hours or days without human babysitting.
2. **Dual-LLM architecture** — Claude (primary) and Gemini (secondary) with intelligent routing and automatic failover on quota exhaustion.
3. **Local-first security** — All data stays on your Mac. No cloud transcripts. Encrypted secrets. Capability-based tool permissions.
4. **Zero-permission-prompt operation** — Pre-authorized execution within user-defined trust boundaries. The agent uses allowlists and capability policies, not per-action approval dialogs.
5. **Claude Code Agent SDK native** — Built on the official SDK, using long-running Mac account tokens (not per-call API keys) for Claude.
6. **Gemini CLI + Workspace quotas** — Gemini invoked through its CLI, consuming Google Workspace account quotas rather than paid API billing.
7. **Proactive memory** — The agent remembers context across sessions, learns preferences, and anticipates needs (inspired by memU's three-layer memory hierarchy).
8. **Extensible tool system** — MCP servers, shell commands, file operations, web access, and custom tools — all sandboxed and auditable.

### Non-Goals

- **Not a chatbot framework** — No Telegram/Discord/Slack channel integrations in v1. This is a local agent for your Mac, not a multi-channel messaging platform.
- **Not a SaaS product** — No user management, multi-tenancy, or billing.
- **Not model-agnostic** — Deeply integrated with Claude and Gemini specifically. Other models are out of scope for v1.
- **Not a container orchestrator** — No Docker/Kubernetes. Runs as a native macOS process with optional sandboxing.

---

## 3. User Journeys

### Journey 1: First Run — Trust Establishment

Rich installs Zora and runs the onboarding command. The agent:

1. Detects the Claude Code SDK installation and authenticates using the existing Mac-level Claude session token (no API key entry required).
2. Detects the Gemini CLI installation and authenticates using the existing Google Workspace SSO session.
3. Generates a default capability policy: file access within `~/Projects`, shell execution with a safe-command allowlist, web fetch allowed, no destructive system operations.
4. Creates the workspace at `~/.zora/` with encrypted secrets store, memory database, session history, and heartbeat file.
5. Rich reviews the capability policy in `~/.zora/policy.toml` and tweaks it (e.g., adds `~/Documents` to allowed paths, adds `docker` to allowed commands).
6. The agent is ready. No further setup needed.

### Journey 2: Complex Task — "Research and build me a comparison doc"

Rich tells the agent:

> "Research the top 5 headless CMS platforms for our use case — we need something that integrates with Next.js, has a generous free tier, and supports content localization. Write a comparison doc with pros/cons and your recommendation. Save it to ~/Documents/cms-comparison.md."

The agent:

1. **Routes to Claude** (primary) because this is a reasoning-heavy research + writing task.
2. **Plans the work** — breaks it into subtasks: web research (5 platforms), feature comparison matrix, prose writeup, recommendation synthesis.
3. **Executes web searches** using its web_fetch tool, gathering data on each platform.
4. **Hits Claude's rate limit** mid-task after 40 minutes of intensive work.
5. **Automatically fails over to Gemini** — the orchestrator detects the quota error, packages the current context (research gathered so far, task plan, progress state), and hands the remaining work to Gemini CLI.
6. **Gemini completes the writeup**, following the same plan and incorporating the research Claude already gathered.
7. **Saves the final document** to `~/Documents/cms-comparison.md`.
8. **Notifies Rich** via macOS notification: "CMS comparison doc is ready."

Total elapsed time: ~50 minutes. Zero human intervention.

### Journey 3: Recurring Background Task — "Keep my repos clean"

Rich sets up a routine:

> "Every weekday at 9am, check all git repos in ~/Projects for: stale branches older than 30 days, uncommitted changes, and repos that are behind their remote. Give me a summary."

The agent:

1. Creates a cron-style routine stored in `~/.zora/routines/`.
2. Every weekday at 9am, the heartbeat system triggers the routine.
3. The agent iterates through `~/Projects/*/`, runs git commands, collects results.
4. **Routes to Gemini** (secondary) because this is a structured data-gathering task that doesn't need Claude's deep reasoning — saves Claude quota for harder work.
5. Gemini summarizes findings.
6. Result is written to `~/.zora/workspace/daily/YYYY-MM-DD-repo-status.md` and a macOS notification is sent.

### Journey 4: Model-Aware Routing — "Different models for different jobs"

Rich asks:

> "Refactor the authentication module in ~/Projects/my-web-app to use OAuth 2.0 with PKCE flow instead of session cookies. Update all tests."

The agent:

1. **Routes to Claude** — this is a complex code refactoring task requiring deep understanding of security patterns. Claude excels here.
2. Claude reads the existing auth module, plans the refactor, writes new code, updates tests.
3. Mid-way, the agent needs to **run the test suite** to verify changes. It shells out to `npm test`.
4. Tests fail. Claude analyzes failures and fixes them. This loop continues.
5. If Claude's quota is exhausted during the fix cycle, the agent **packages the current diff + test output + error context** and hands off to Gemini to complete the remaining test fixes.
6. Final result: all tests passing, clean diff committed to a new branch.

---

## 4. Architecture

### 4.1 System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ZORA                                │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    ORCHESTRATOR CORE                          │  │
│  │                                                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐  │  │
│  │  │   Router     │  │  Scheduler  │  │  Failover Controller │  │  │
│  │  │ (task→model) │  │ (jobs/cron) │  │  (quota/error mgmt)  │  │  │
│  │  └──────┬──────┘  └──────┬──────┘  └──────────┬───────────┘  │  │
│  │         │                │                     │              │  │
│  │         └────────────────┼─────────────────────┘              │  │
│  │                          │                                    │  │
│  │                 ┌────────▼────────┐                           │  │
│  │                 │  EXECUTION LOOP │                           │  │
│  │                 │  (agentic cycle │                           │  │
│  │                 │   w/ tools)     │                           │  │
│  │                 └────────┬────────┘                           │  │
│  │                          │                                    │  │
│  └──────────────────────────┼────────────────────────────────────┘  │
│                             │                                       │
│  ┌──────────────────────────▼────────────────────────────────────┐  │
│  │                    LLM PROVIDER LAYER                         │  │
│  │                                                               │  │
│  │  ┌───────────────────┐       ┌───────────────────┐           │  │
│  │  │  Claude Provider  │       │  Gemini Provider  │           │  │
│  │  │                   │       │                   │           │  │
│  │  │ • Agent SDK       │       │ • CLI invocation  │           │  │
│  │  │ • Mac session tok │       │ • Workspace quota │           │  │
│  │  │ • Primary brain   │       │ • Secondary brain │           │  │
│  │  │ • Tool calling    │       │ • Tool calling    │           │  │
│  │  │ • Extended think  │       │ • Code execution  │           │  │
│  │  └───────────────────┘       └───────────────────┘           │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                       TOOL LAYER                              │  │
│  │                                                               │  │
│  │  ┌────────┐ ┌────────┐ ┌──────┐ ┌─────┐ ┌──────┐ ┌───────┐ │  │
│  │  │ Shell  │ │ Files  │ │ Web  │ │ MCP │ │Memory│ │Notify │ │  │
│  │  │ Exec   │ │ R/W/E  │ │Fetch │ │Srvrs│ │Search│ │macOS  │ │  │
│  │  └────────┘ └────────┘ └──────┘ └─────┘ └──────┘ └───────┘ │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                     PERSISTENCE LAYER                         │  │
│  │                                                               │  │
│  │  ┌──────────┐ ┌───────────┐ ┌─────────┐ ┌────────────────┐  │  │
│  │  │ Memory   │ │ Sessions  │ │ Secrets │ │ Routines/Cron  │  │  │
│  │  │ (3-tier) │ │ (JSONL)   │ │ (enc.)  │ │ (persistent)   │  │  │
│  │  └──────────┘ └───────────┘ └─────────┘ └────────────────┘  │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                     SECURITY LAYER                            │  │
│  │                                                               │  │
│  │  ┌──────────────┐ ┌────────────┐ ┌───────────┐ ┌──────────┐ │  │
│  │  │ Capability   │ │ Prompt     │ │ Integrity │ │ Audit    │ │  │
│  │  │ Policy       │ │ Injection  │ │ Guardian  │ │ Logger   │ │  │
│  │  │ Engine       │ │ Defense    │ │ (files)   │ │ (append) │ │  │
│  │  └──────────────┘ └────────────┘ └───────────┘ └──────────┘ │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Component Breakdown

#### Orchestrator Core

The heart of Zora. Responsible for receiving tasks, routing them to the right model, managing execution, and handling failures.

**Router** — Decides which LLM handles each task or subtask. Routing is based on:

| Signal | Claude (Primary) | Gemini (Secondary) |
|--------|------------------|--------------------|
| Complex reasoning / code refactoring | ✅ Preferred | Fallback |
| Creative writing / nuanced analysis | ✅ Preferred | Fallback |
| Structured data gathering / summarization | Can do | ✅ Preferred (saves Claude quota) |
| Large-context document processing | Can do | ✅ Preferred (1M token window) |
| Code generation with test iteration | ✅ Preferred | Fallback |
| Simple shell task orchestration | Either | ✅ Preferred |
| Quota exhausted on primary | N/A | ✅ Automatic failover |
| Quota exhausted on both | Queue task for retry | Queue task for retry |

The router uses a **task classification prompt** (run against a lightweight model or heuristic) to categorize incoming work before dispatching. For explicit user routing (e.g., "use Gemini for this"), the router respects the override.

**Scheduler** — Manages the execution queue:

- **Immediate jobs**: User-initiated tasks executed now.
- **Background jobs**: Spawned subtasks running in parallel.
- **Routines**: Cron-scheduled recurring tasks.
- **Heartbeat tasks**: Periodic proactive checks (inspired by Nanobot's `HEARTBEAT.md` pattern).
- **Retry queue**: Tasks that failed due to quota/transient errors, scheduled for retry with exponential backoff.

Max parallel jobs: configurable (default 3), preventing resource exhaustion.

**Failover Controller** — Monitors LLM provider health and manages transitions:

- Tracks quota usage, error rates, and cooldown timers per provider.
- On quota error from Claude: packages current execution context (task plan, progress, intermediate results) into a **handoff bundle** and dispatches to Gemini.
- On quota error from Gemini: queues for retry or notifies user.
- Cooldown tracking with exponential backoff (inspired by OpenClaw's auth profile rotation).
- Provider health dashboard available via `zora status`.

#### LLM Provider Layer

**Claude Provider**

- **SDK**: Claude Code Agent SDK (`@anthropic-ai/claude-code`)
- **Authentication**: Long-running Mac account session token. The agent reads the existing Claude session from the local credential store (same token used by Claude Desktop / Claude Code CLI). No API key required.
- **Execution mode**: Embedded — runs Claude as an in-process agent with full tool-calling support.
- **Max turns**: 200 per job (configurable). Prevents infinite loops.
- **Extended thinking**: Enabled for complex tasks (budget configurable).
- **Context**: System prompt + memory context + task history + tool definitions.

**Gemini Provider**

- **CLI**: Gemini CLI (`gemini`) invoked as a subprocess.
- **Authentication**: Google Workspace SSO session. Uses the existing gcloud/Workspace credentials on the Mac. Consumes Workspace quota, not paid API quota.
- **Execution mode**: Subprocess — spawns `gemini` CLI with structured prompts, captures output.
- **Context passing**: For failover handoffs, context is serialized to a markdown document passed as input to the Gemini CLI.
- **Tool support**: Gemini's built-in code execution + function calling, translated through an adapter layer.

**Unified Interface**

Both providers implement a common `LLMProvider` trait:

```typescript
interface LLMProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  getQuotaStatus(): Promise<QuotaStatus>;
  execute(task: TaskContext): AsyncGenerator<AgentEvent>;
  abort(jobId: string): Promise<void>;
}

interface QuotaStatus {
  isExhausted: boolean;
  remainingRequests: number | null;  // null if unknown
  cooldownUntil: Date | null;
  healthScore: number;  // 0-1, based on recent success rate
}
```

### 4.3 Filesystem Layout

```
~/.zora/
├── config.toml                    # Main configuration
├── policy.toml                    # Capability/permission policy
├── secrets.enc                    # AES-256-GCM encrypted secrets store
├── sessions/
│   └── {job-id}.jsonl             # Per-job conversation history
├── memory/
│   ├── MEMORY.md                  # Long-term knowledge base
│   ├── daily/
│   │   └── YYYY-MM-DD.md         # Daily observations/notes
│   ├── items/                     # Extracted memory facts (memU-style)
│   │   └── {item-id}.json        # Individual memory items
│   └── categories/                # Auto-organized topic summaries
│       └── {category}.json
├── routines/
│   └── {routine-name}.toml       # Scheduled task definitions
├── workspace/                     # Agent's scratchpad
│   ├── HEARTBEAT.md              # Proactive task checklist
│   ├── SOUL.md                   # Agent identity/personality
│   └── context/                  # Working files for active jobs
├── audit/
│   └── audit.jsonl               # Append-only security audit log
├── tools/
│   └── mcp/                      # MCP server configurations
│       └── {server-name}.json
└── state/
    ├── provider-health.json      # LLM provider health tracking
    ├── active-jobs.json          # Currently running jobs
    └── retry-queue.json          # Tasks awaiting retry
```

---

## 5. Detailed Design

### 5.1 Dual-LLM Orchestration & Failover

This is Zora's most distinctive feature. The system treats Claude and Gemini not as interchangeable backends but as **complementary specialists with automatic failover**.

#### Task Classification

When a new task arrives, the Router classifies it along two axes:

**Complexity axis:**
- `deep-reasoning` — Multi-step logic, code architecture, security analysis
- `structured-execution` — Following clear instructions, data transformation, summarization
- `creative` — Writing, brainstorming, nuanced communication

**Resource axis:**
- `token-light` — Short context, simple response expected
- `token-heavy` — Large documents, extensive code, long-form output
- `iterative` — Requires multiple tool-call loops (test-fix cycles, research loops)

**Default routing matrix:**

| Classification | Primary | Reasoning |
|---------------|---------|-----------|
| deep-reasoning + any | Claude | Claude excels at multi-step reasoning |
| creative + any | Claude | Better nuance and writing quality |
| structured-execution + token-light | Gemini | Saves Claude quota for harder work |
| structured-execution + token-heavy | Gemini | Gemini's 1M context window advantage |
| iterative + deep-reasoning | Claude | Code refactoring, debugging loops |
| iterative + structured | Gemini | Repetitive data processing |

User overrides always take precedence. The routing matrix is configurable in `config.toml`.

#### Handoff Protocol

When a failover occurs mid-task, the Failover Controller creates a **Handoff Bundle**:

```typescript
interface HandoffBundle {
  originalTask: string;            // The user's original request
  taskPlan: TaskStep[];            // Decomposed subtask plan
  completedSteps: TaskStep[];      // What's been done so far
  currentStep: TaskStep;           // Where we are now
  intermediateResults: Result[];   // Outputs from completed steps
  conversationHistory: Message[];  // Last N messages (trimmed)
  workingFiles: FileRef[];         // Files created/modified so far
  failureReason: string;           // Why we're failing over
  resumeInstructions: string;      // Natural language handoff note
}
```

The receiving provider gets a synthesized prompt:

```
You are continuing a task that was started by another AI assistant.
Here is the context of what has been accomplished so far and what
remains to be done.

[Handoff Bundle serialized as structured markdown]

Please continue from where the previous assistant left off.
Do not redo completed work. Focus on the remaining steps.
```

This approach was inspired by OpenClaw's session management but simplified for two-provider use. The key insight from studying these repos: **context packaging for handoff is more important than protocol standardization.**

#### Quota Management

```toml
# config.toml — provider section
[providers.claude]
priority = 1                          # Primary
max_concurrent_jobs = 3
quota_check_interval = "30s"
cooldown_base = "5s"
cooldown_max = "30m"
cooldown_multiplier = 2.0

[providers.gemini]
priority = 2                          # Secondary
max_concurrent_jobs = 2
quota_check_interval = "30s"
cooldown_base = "10s"
cooldown_max = "1h"
cooldown_multiplier = 2.0

[failover]
enabled = true
auto_handoff = true                   # Automatic failover on quota
preserve_context = true               # Package context for handoff
retry_after_cooldown = true           # Retry failed provider when cooldown expires
max_handoff_context_tokens = 50000    # Max tokens in handoff bundle
```

### 5.2 Execution Loop

The core agentic loop, inspired by Nanobot's clean design but extended for dual-LLM support:

```
1. Receive task (from user CLI, routine trigger, or heartbeat)
2. Router classifies task → selects provider
3. Scheduler enqueues job, respects max_concurrent_jobs
4. Worker starts:
   a. Build context: system prompt + memory + task + tool definitions
   b. Call LLM provider
   c. If LLM returns tool calls:
      - Validate against capability policy
      - Execute tools (parallel where independent)
      - Wrap results, feed back to LLM
      - Go to (b) — max iterations enforced
   d. If LLM returns final response:
      - Save to session history
      - Update memory (if significant interaction)
      - Notify user (if configured)
      - Mark job complete
   e. If LLM returns error (quota/rate limit/timeout):
      - Failover Controller evaluates:
        - If other provider available → create HandoffBundle → dispatch
        - If no provider available → queue for retry
        - If max retries exceeded → notify user of failure
5. Post-execution: update provider health metrics, audit log
```

**Max iterations per job:** 200 (Claude), 100 (Gemini). Configurable. Prevents infinite tool-call loops.

**Timeout per job:** 2 hours default. Long-running tasks that exceed this get checkpointed and can be resumed.

### 5.3 Tool System

#### Built-in Tools

| Tool | Description | Approval Required |
|------|-------------|-------------------|
| `read_file` | Read file contents | No (within allowed paths) |
| `write_file` | Create/overwrite files | No (within allowed paths) |
| `edit_file` | Surgical text replacement | No (within allowed paths) |
| `list_directory` | List directory contents | No (within allowed paths) |
| `shell_exec` | Execute shell commands | No (if command in allowlist) |
| `web_fetch` | Fetch URL content as markdown | No |
| `web_search` | Search the web | No |
| `memory_search` | Query long-term memory | No |
| `memory_write` | Store fact in memory | No |
| `spawn_subtask` | Create background subtask | No |
| `schedule_routine` | Create recurring task | No |
| `notify_user` | Send macOS notification | No |
| `git_operations` | Git commands (commit, branch, push) | Push requires notification |

#### Capability Policy Engine

Inspired by IronClaw's capability-based security (the strongest security model studied) but simplified for single-user macOS use:

```toml
# policy.toml

[filesystem]
allowed_paths = [
  "~/Projects",
  "~/Documents",
  "~/Downloads",
  "~/.zora"
]
denied_paths = [
  "~/.ssh",
  "~/.gnupg",
  "~/Library/Keychains"
]

[shell]
mode = "allowlist"               # "allowlist" | "denylist" | "unrestricted"
allowed_commands = [
  "git", "npm", "node", "python3", "pip",
  "cargo", "rustc", "go",
  "docker", "docker-compose",
  "brew", "curl", "wget",
  "jq", "yq", "grep", "find", "sed", "awk",
  "cat", "head", "tail", "wc", "sort", "uniq",
  "ls", "mkdir", "cp", "mv", "rm",
  "make", "cmake",
  "psql", "sqlite3"
]
denied_commands = [
  "rm -rf /",
  "shutdown", "reboot",
  "format", "diskutil",
  "sudo"                          # Agent never runs as root
]
max_execution_time = "5m"         # Per-command timeout

[network]
allowed_domains = ["*"]           # All domains for web_fetch
denied_domains = []
max_request_size = "10MB"

[mcp]
allowed_servers = ["*"]           # All registered MCP servers
auto_approve_tools = true         # Trust registered MCP server tools

[notifications]
enabled = true
on_task_complete = true
on_error = true
on_long_running = "30m"           # Notify if task runs > 30 min
```

The key design decision: **no per-action permission prompts**. The agent operates within the declared policy boundaries freely. If a tool call falls outside policy, it's **blocked silently with an error returned to the LLM** — the LLM can then try an alternative approach. The user is notified of policy violations in the audit log, not via blocking dialogs.

This is the single biggest difference from most agent frameworks studied: OpenClaw and IronClaw both have approval mechanisms, but they interrupt flow. Zora trades interactive safety for **pre-declared trust boundaries** — you set the policy once, and the agent respects it autonomously.

### 5.4 Memory System

Three-tier memory architecture, directly inspired by memU's hierarchy but simplified for single-user operation:

#### Tier 1: Long-Term Knowledge (`MEMORY.md`)

A markdown file the agent reads on every invocation. Contains:
- User preferences (coding style, preferred tools, project conventions)
- Important facts (company name, team structure, API endpoints)
- Learned behaviors (how Rich likes commit messages formatted, preferred file organization)

Updated by the agent via `memory_write` tool when it learns something significant.

#### Tier 2: Daily Notes (`daily/YYYY-MM-DD.md`)

Per-day markdown files. The agent writes observations during work sessions:
- Tasks completed and their outcomes
- Errors encountered and resolutions
- New tools or approaches discovered
- Project state summaries

The agent reads the last 7 days of notes for context. Older notes are available via memory search.

#### Tier 3: Structured Memory Items (`items/`)

Individual JSON files representing extracted facts (memU's six memory types):

```json
{
  "id": "mem_abc123",
  "type": "knowledge",         // profile | event | knowledge | behavior | skill | tool
  "summary": "The my-web-app project uses Next.js 14 with App Router and Tailwind CSS",
  "source": "session_xyz789",
  "created_at": "2026-02-11T10:30:00Z",
  "last_accessed": "2026-02-11T14:00:00Z",
  "access_count": 3,
  "tags": ["my-web-app", "nextjs", "frontend"]
}
```

Memory items are extracted from conversations periodically (every 10+ messages, inspired by Open Personal Agent's `summaryPoller` pattern). Search uses keyword matching + tag filtering. V2 will add vector embeddings for semantic search.

#### Context Assembly Order

When building the system prompt for any LLM call:

```
1. Agent identity (SOUL.md)
2. Current date/time, OS info, working directory
3. Long-term memory (MEMORY.md) — always included
4. Last 7 days of daily notes — always included
5. Relevant memory items — retrieved via search based on current task
6. Active job context (plan, progress, intermediate results)
7. Conversation history (last 50 messages or 30K tokens, whichever is less)
8. Tool definitions
```

### 5.5 Security Architecture

Drawing from ClawSec's defense-in-depth and IronClaw's capability model:

#### Prompt Injection Defense

Three layers (inspired by IronClaw's safety module):

1. **Input Sanitizer** — Pattern-based detection on all external content (web fetch results, file contents, MCP tool outputs). Uses keyword matching for known injection patterns ("ignore previous instructions", "system override", etc.). Detected content is wrapped in `<untrusted_content>` tags so the LLM treats it as data, not instructions.

2. **Output Validator** — Scans LLM-generated tool calls for suspicious patterns:
   - Shell commands containing pipes to `curl`/`wget` (potential exfiltration)
   - File writes to sensitive paths
   - Requests to read `.env`, credentials, or SSH keys

3. **Audit Logger** — Every tool invocation is logged to `audit.jsonl` with timestamp, tool name, parameters, result, and the LLM that requested it. Uses append-only writes. Logs are hash-chained (inspired by ClawSec's tamper-evident audit) so retroactive log modification is detectable.

#### Secrets Management

- All secrets (API keys, tokens, credentials) stored in `secrets.enc`.
- Encrypted at rest with AES-256-GCM.
- Encryption key derived from macOS Keychain (using the user's login keychain).
- Secrets are **never passed directly to the LLM**. When a tool needs a secret (e.g., a GitHub token for API calls), the tool reads it from the secrets store at execution time. The LLM only sees `[SECRET:github_token]` placeholders.
- Leak detection: all LLM outputs are scanned for strings matching known secret patterns before being logged or displayed.

#### Integrity Guardian

Inspired by ClawSec's Soul Guardian:

- Critical files (`SOUL.md`, `MEMORY.md`, `policy.toml`, `config.toml`) have SHA-256 baselines stored in `state/integrity-baselines.json`.
- On agent startup and every heartbeat, integrity is checked.
- If a critical file has been modified outside the agent's control (e.g., by a malicious tool output that somehow wrote to it), the agent:
  1. Quarantines the modified version
  2. Restores from baseline
  3. Logs the incident
  4. Notifies the user

### 5.6 Routines & Scheduling

Inspired by Nanobot's three-layer task system:

#### Heartbeat (Proactive)

The agent checks `HEARTBEAT.md` every 30 minutes (configurable). This file contains a checklist of proactive tasks:

```markdown
# Zora Heartbeat Tasks

- [ ] Check for stale git branches in ~/Projects
- [ ] Summarize today's work if > 5 tasks completed
- [ ] Run `npm audit` on active projects if last run > 7 days ago
```

The agent processes unchecked items, marks them done, and adds new items as needed.

#### Cron Routines (Scheduled)

```toml
# routines/repo-cleanup.toml
[routine]
name = "repo-cleanup"
schedule = "0 9 * * 1-5"          # Weekday 9am
model_preference = "gemini"        # Prefer Gemini for this task
timeout = "15m"

[routine.task]
prompt = """
Check all git repos in ~/Projects for stale branches (>30 days),
uncommitted changes, and repos behind their remote.
Write summary to ~/.zora/workspace/daily/{date}-repo-status.md
and send a macOS notification with the highlight.
"""
```

#### Event-Triggered Routines (Reactive)

```toml
# routines/on-push.toml
[routine]
name = "post-push-checks"
trigger = "file_change"
watch_path = "~/Projects/*/.git/refs/heads/*"
debounce = "5m"

[routine.task]
prompt = "A git push just happened in {trigger_path}. Run the test suite and lint checks. If anything fails, create a TODO item in HEARTBEAT.md."
```

### 5.7 Cross-Agent Communication

Directly based on the filesystem mailbox pattern from Claude Code Agent Teams, extended to support Gemini as a first-class team member via the bridge pattern from the Gemini Team Integration guide.

#### Why Not Just Failover?

The V1 failover model (§5.1) treats Gemini as a backup brain. That's useful for quota resilience, but it misses a bigger opportunity: Claude and Gemini working **simultaneously** on different parts of a problem, communicating results to each other through a shared mailbox. Cross-agent communication enables this.

Real-world example: Rich asks Zora to "audit my project for security issues and performance bottlenecks, then write a report." With cross-agent comms, Zora can:

1. Spawn a **Claude agent** for security analysis (Claude excels at reasoning about attack vectors).
2. Spawn a **Gemini agent** for performance profiling (Gemini's large context window can ingest entire codebases).
3. Both work in parallel, writing findings to their own output files.
4. A **coordinator** (Claude or a lightweight orchestrator) reads both sets of findings and synthesizes the final report.

Total wall-clock time: ~half of serial execution.

#### Mailbox Architecture

Adapted from `AGENT_TEAMS_DEV_GUIDE.md`:

```
~/.zora/teams/
├── {team-name}/
│   ├── config.json              # Team definition and membership
│   └── inboxes/                 # File-based communication hub
│       ├── coordinator.json     # Orchestrator/lead mailbox
│       ├── claude-agent.json    # Claude specialist mailbox
│       └── gemini-agent.json    # Gemini specialist mailbox
```

Each mailbox is a JSON array of message objects:

```json
[
  {
    "from": "claude-agent",
    "text": "Security analysis complete. Found 3 critical issues. Results in /workspace/context/security-findings.md",
    "timestamp": "2026-02-11T14:30:00Z",
    "read": false,
    "type": "result"
  }
]
```

**Message types:**

| Type | Purpose |
|------|---------|
| `task` | Assign work to an agent |
| `result` | Agent reports completed work |
| `status` | Progress update (% complete, current step) |
| `steer` | Human direction change (see §5.8) |
| `handoff` | Mid-task transfer to another agent (includes HandoffBundle) |
| `shutdown` | Request agent to stop gracefully |
| `idle` | Agent signals it has finished and is available for more work |

#### Gemini Bridge

Adapted from `GEMINI_TEAM_INTEGRATION.md`. A background process that:

1. **Polls** `gemini-agent.json` for unread messages.
2. **Extracts** the task from incoming messages.
3. **Invokes** Gemini CLI with the task + any referenced context files.
4. **Writes** results back to the coordinator's inbox.

The bridge runs as a child process of the Zora daemon, started/stopped with the main process. It translates between the mailbox protocol and Gemini CLI's stdin/stdout interface.

```typescript
interface AgentMember {
  agentId: string;              // e.g., "claude-security@audit-team"
  name: string;                 // Friendly name
  provider: "claude" | "gemini";
  model: string;                // Specific model version
  cwd: string;                  // Working directory
  isActive: boolean;
  capabilities: string[];       // What this agent is good at
}
```

#### Team Lifecycle

1. **Spawn**: `zora team create "security-audit"` — creates team config + mailboxes.
2. **Assign**: Coordinator posts `task` messages to specialist inboxes.
3. **Execute**: Each agent polls its inbox, works independently, posts `status` updates and `result` messages.
4. **Synthesize**: Coordinator collects results, produces final output.
5. **Teardown**: Coordinator posts `shutdown` to all agents, cleans up.

Teams are ephemeral by default (created per-task, torn down on completion) but can be made persistent for recurring collaborative workflows.

### 5.8 Async Human-in-the-Loop Steering

The critical design principle: **Rich can observe and redirect work at any time, but his input is never a blocking gate.** The agent keeps working with its best judgment until told otherwise. Human steering is advisory, not mandatory.

#### How It Works

```
                ┌──────────────────┐
                │   Rich (Human)   │
                │                  │
                │  • Observes via  │
                │    dashboard/CLI │
                │  • Steers via    │
                │    inbox inject  │
                └────────┬─────────┘
                         │ writes steer message
                         │ (non-blocking)
                         ▼
              ┌─────────────────────┐
              │  Coordinator Inbox  │
              │  coordinator.json   │
              └────────┬────────────┘
                       │ picked up on
                       │ next poll cycle
                       ▼
              ┌─────────────────────┐
              │    Coordinator      │
              │                     │
              │ Incorporates steer  │
              │ into current plan.  │
              │ Redirects agents    │
              │ if needed.          │
              │                     │
              │ NEVER blocks        │
              │ waiting for human   │
              │ input.              │
              └─────────────────────┘
```

#### Steering Mechanisms

**1. CLI Injection (Quick)**

```bash
# Redirect a running task
zora steer job_abc123 "Actually, focus on the Next.js integration more than the API layer"

# Redirect a team member specifically
zora steer --agent claude-security "Also check for SQL injection in the legacy endpoints"

# Approve/reject a proposed action (if agent flagged it for optional review)
zora approve job_abc123 action_7
zora reject job_abc123 action_7 "Don't delete that file, we still need it"
```

**2. Dashboard (Visual)**

`zora dashboard` opens a terminal UI (or local web UI at `localhost:7070`) showing:

- Active jobs with real-time progress
- Agent communication log (mailbox messages scrolling)
- Current step for each agent
- Steering input field — type a message, it gets injected into the coordinator's inbox
- Flagged actions (things the agent is uncertain about — not blocked on, just flagged)

**3. Inbox File (Direct)**

Power-user mode: directly edit `~/.zora/teams/{team}/inboxes/coordinator.json` to inject a message. Any process with filesystem access can steer the agent — scripts, cron jobs, other tools.

#### Steering vs. Blocking: The Key Distinction

| Aspect | Traditional HITL (Blocking) | Zora Steering (Async) |
|--------|---------------------------|----------------------|
| Agent behavior | Pauses and waits for approval | Continues working with best judgment |
| Human response time | Must respond promptly or work stalls | Respond whenever convenient |
| Steer message arrives mid-task | N/A (agent is paused) | Agent adjusts plan on next iteration |
| No human response | Work is stuck | Work completes autonomously |
| Undo/redirect | Before action only | Before or after — agent can course-correct |

#### Flagging Without Blocking

When the agent encounters something it's uncertain about (e.g., "should I delete the old migration files or archive them?"), it:

1. **Flags the decision** — writes a `flag` entry to the job's status file with the question and its default choice.
2. **Proceeds with its default choice** — doesn't wait.
3. **Notifies Rich** — macOS notification: "Zora flagged a decision in job_abc123. Proceeding with: archive."
4. **If Rich steers** — "Actually delete them" — the agent adjusts. If the action was already taken, it undoes and redoes (if possible) or notes the discrepancy.
5. **If Rich says nothing** — the agent's default stands. Work is never blocked.

```json
{
  "type": "flag",
  "job_id": "job_abc123",
  "question": "Found 12 migration files from 2023. Archive to ~/Projects/archive/ or delete?",
  "default_action": "archive",
  "chosen_action": "archive",
  "status": "pending_review",
  "timestamp": "2026-02-11T15:45:00Z"
}
```

#### Steering Configuration

```toml
# config.toml additions

[steering]
enabled = true
poll_interval = "5s"               # How often agents check for steer messages
dashboard_port = 7070              # Local web dashboard
notify_on_flag = true              # macOS notification on flagged decisions
flag_timeout = "10m"               # After this, default action is finalized (no undo)
auto_approve_low_risk = true       # Don't flag reversible, low-impact decisions
```

### 5.9 CLI Interface

```bash
# Start the agent daemon
zora start

# Stop the agent daemon
zora stop

# Send a task (blocks until complete)
zora ask "Refactor the auth module to use OAuth 2.0"

# Send a task (returns immediately, runs in background)
zora task "Research and write the CMS comparison doc"

# Check status
zora status
# Output:
#   Agent: running (pid 12345)
#   Claude: healthy (quota: ~2000 requests remaining)
#   Gemini: healthy (workspace quota: 1425/1500 used)
#   Active jobs: 2
#   Pending retries: 0
#   Routines: 3 active, next trigger in 2h15m

# List active and recent jobs
zora jobs
# Output:
#   [running]  job_abc123  "CMS comparison doc"         Claude → 45% complete
#   [running]  job_def456  "Refactor auth module"       Claude → 12% complete
#   [done]     job_ghi789  "Daily repo cleanup"         Gemini    2m ago

# View audit log
zora audit --last 24h

# Manage routines
zora routine list
zora routine create --file routines/my-routine.toml
zora routine disable repo-cleanup

# Manage memory
zora memory search "nextjs project configuration"
zora memory forget "mem_abc123"

# Team management (cross-agent)
zora team create "security-audit" --agents claude-security,gemini-perf
zora team list
zora team status security-audit
zora team teardown security-audit

# Async steering (non-blocking human input)
zora steer job_abc123 "Focus more on the API layer"
zora steer --agent gemini-perf "Skip the CSS analysis, not relevant"
zora flags                       # List all flagged decisions awaiting optional review
zora approve job_abc123 flag_7
zora reject job_abc123 flag_7 "Don't delete that, archive it instead"

# Dashboard (visual monitoring + steering)
zora dashboard                   # Opens TUI or web UI at localhost:7070

# Interactive REPL
zora repl
# Opens a conversational interface with the agent
```

---

## 6. Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Language** | TypeScript (Node.js 22+) | Claude Code Agent SDK is JS/TS native; fastest path to integration |
| **Claude integration** | `@anthropic-ai/claude-code` SDK | Official SDK with embedded agent support, Mac token auth |
| **Gemini integration** | Gemini CLI subprocess | Uses existing Workspace SSO; no separate API key needed |
| **Process management** | Node.js with `tsx` | Direct TS execution, no build step for dev |
| **CLI framework** | `commander` or `citty` | Lightweight, well-maintained |
| **Configuration** | TOML (`@iarna/toml`) | Human-readable, supports comments (unlike JSON) |
| **Session storage** | JSONL files | Simple, appendable, human-readable (from Nanobot) |
| **Memory search** | In-process keyword/tag index | V1 simplicity; V2 adds vector search with SQLite + embeddings |
| **Secrets encryption** | `node:crypto` (AES-256-GCM) | Native Node.js, no external dependencies |
| **Keychain access** | `keytar` or native macOS `security` CLI | Reads/writes macOS Keychain for master key |
| **Notifications** | `node-notifier` or `osascript` | macOS native notifications |
| **Scheduling** | `node-cron` + custom heartbeat | Lightweight, in-process |
| **MCP client** | `@modelcontextprotocol/sdk` | Official MCP SDK for tool extension |
| **Process runner** | `execa` | Reliable subprocess management for Gemini CLI |

### Why TypeScript, Not Rust?

IronClaw demonstrated Rust's advantages (performance, safety, single binary), but for this project:

1. **Claude Code Agent SDK is TypeScript-native.** Using Rust would require FFI bridging or reimplementing the SDK.
2. **Gemini CLI integration is subprocess-based** — language doesn't matter for this.
3. **Development velocity** — TypeScript with the existing SDK gets to a working agent in days, not weeks.
4. **Rich's existing ecosystem** — Node.js tooling, npm packages, and JS/TS familiarity.

Rust rewrite is a V2 consideration after the architecture is proven.

---

## 7. Configuration Reference

```toml
# ~/.zora/config.toml

[agent]
name = "zora"
workspace = "~/.zora/workspace"
max_parallel_jobs = 3
default_timeout = "2h"
heartbeat_interval = "30m"
log_level = "info"                    # debug | info | warn | error

[agent.identity]
soul_file = "~/.zora/workspace/SOUL.md"
# If SOUL.md doesn't exist, agent creates a default one on first run

[providers.claude]
enabled = true
priority = 1
auth_method = "mac_session"           # Uses existing Claude session token
max_turns = 200
extended_thinking = true
thinking_budget = 10000               # Max thinking tokens
model = "claude-sonnet-4-5"           # Default model; can override per-task

[providers.gemini]
enabled = true
priority = 2
auth_method = "workspace_sso"         # Uses existing gcloud/Workspace session
cli_path = "gemini"                   # Path to Gemini CLI binary
max_turns = 100
model = "gemini-2.5-pro"

[routing]
strategy = "smart"                    # "smart" | "claude_only" | "gemini_only" | "round_robin"
# Smart routing uses task classification (see §5.1)

[failover]
enabled = true
auto_handoff = true
max_handoff_context_tokens = 50000
retry_after_cooldown = true
max_retries = 3
notify_on_failover = true

[memory]
long_term_file = "~/.zora/memory/MEMORY.md"
daily_notes_dir = "~/.zora/memory/daily"
items_dir = "~/.zora/memory/items"
context_days = 7                      # Include this many days of notes
max_context_items = 20                # Max memory items per query
auto_extract_interval = 10            # Extract memories every N messages

[security]
policy_file = "~/.zora/policy.toml"
audit_log = "~/.zora/audit/audit.jsonl"
audit_hash_chain = true
integrity_check = true
integrity_interval = "30m"
leak_detection = true
sanitize_untrusted_content = true

[notifications]
enabled = true
on_task_complete = true
on_error = true
on_failover = true
on_long_running_threshold = "30m"
sound = true
```

---

## 8. Design Decisions & Trade-offs

### Decision 1: Pre-authorized execution vs. per-action approval

**Chosen:** Pre-authorized via capability policy.
**Alternative:** Per-action approval (OpenClaw/IronClaw style).
**Rationale:** The entire point of this agent is to get shit done without interrupting you. Per-action approval defeats the purpose. The capability policy provides the safety boundary — if you don't trust the agent to `rm` files, don't put `rm` in the allowlist. If you do trust it, let it work.
**Risk mitigation:** Comprehensive audit logging, integrity guardian, and the ability to review the audit trail after the fact.

### Decision 2: Claude Code Agent SDK (embedded) vs. Claude API (direct)

**Chosen:** Agent SDK with Mac session token.
**Alternative:** Direct Anthropic API with API key.
**Rationale:** The Agent SDK provides the full agentic loop (tool calling, multi-turn, streaming) as a native capability. Using the Mac session token means no API billing — the agent uses the same quota as your Claude subscription. This is a massive cost advantage for long-running tasks.
**Trade-off:** Tied to Claude's Mac app/CLI authentication. If the session expires, the agent needs to re-authenticate (but this is handled gracefully with user notification).

### Decision 3: Gemini via CLI subprocess vs. Gemini API

**Chosen:** CLI subprocess.
**Alternative:** Google AI Gemini API with API key.
**Rationale:** The Gemini CLI uses Workspace SSO authentication, meaning Gemini invocations consume your Google Workspace quota (typically generous, especially for Workspace Business/Enterprise customers) rather than paid API credits. This makes Gemini essentially free for secondary/failover use.
**Trade-off:** Slightly higher latency (subprocess spawn) and less fine-grained control vs. direct API. Acceptable for a secondary provider.

### Decision 4: Filesystem-based persistence vs. SQLite/PostgreSQL

**Chosen:** Filesystem (JSONL + JSON + Markdown + TOML).
**Alternative:** SQLite (like IronClaw uses PostgreSQL).
**Rationale:** For a single-user local agent, filesystem storage is simpler, more debuggable (you can `cat` any file), and requires no database process. JSONL is appendable and human-readable. The filesystem approach was validated by Nanobot (which runs successfully with pure filesystem storage) and memU (which supports both but defaults to simple storage).
**Trade-off:** No ACID transactions, no complex queries. V2 may add SQLite for memory search (vector embeddings need indexed storage).

### Decision 5: TypeScript vs. Rust vs. Python

**Chosen:** TypeScript.
**Alternatives:** Rust (IronClaw), Python (Nanobot, memU).
**Rationale:** Claude Code Agent SDK is TypeScript-native. Fighting the SDK's language would waste time. TypeScript also gives access to the MCP SDK, the broader npm ecosystem, and Rich's existing toolchain.
**Trade-off:** Slower than Rust, less scientific-computing support than Python. Both acceptable for an agent that spends 95% of its time waiting on LLM API responses.

---

## 9. Implementation Plan

### Phase 1: Foundation (Week 1-2)

- [ ] Project scaffolding (TypeScript, tsx, pnpm)
- [ ] Configuration system (TOML parsing, defaults, validation)
- [ ] Claude Provider — Agent SDK integration with Mac session token
- [ ] Basic execution loop (single-model, no failover)
- [ ] Core tools: `read_file`, `write_file`, `edit_file`, `list_directory`, `shell_exec`
- [ ] CLI: `zora start`, `zora stop`, `zora ask`
- [ ] Session persistence (JSONL)
- [ ] Basic capability policy engine

### Phase 2: Dual-LLM & Failover (Week 3-4)

- [ ] Gemini Provider — CLI subprocess integration with Workspace SSO
- [ ] Router — task classification and model selection
- [ ] Failover Controller — quota detection, handoff bundle creation
- [ ] Handoff protocol implementation
- [ ] Provider health tracking and cooldown management
- [ ] CLI: `zora status`, `zora jobs`

### Phase 3: Memory & Persistence (Week 5-6)

- [ ] Three-tier memory system implementation
- [ ] Memory extraction from conversations
- [ ] Context assembly with memory injection
- [ ] Daily notes auto-generation
- [ ] Memory search (keyword + tag-based)
- [ ] CLI: `zora memory search`, `zora memory forget`

### Phase 4: Cross-Agent Communication (Week 7-8)

- [ ] Filesystem mailbox infrastructure (team dirs, inbox JSON files)
- [ ] Team config format and lifecycle (create/assign/teardown)
- [ ] Gemini bridge process (poll inbox → invoke CLI → write result)
- [ ] Coordinator agent logic (task decomposition, result synthesis)
- [ ] Parallel agent execution (Claude + Gemini working simultaneously)
- [ ] CLI: `zora team create/list/status/teardown`

### Phase 5: Async Steering & Scheduling (Week 9-10)

- [ ] Steer message injection (CLI + direct inbox edit)
- [ ] Flag-without-blocking mechanism
- [ ] Dashboard (TUI and/or web UI at localhost:7070)
- [ ] Heartbeat system (HEARTBEAT.md polling)
- [ ] Cron routines (node-cron)
- [ ] Retry queue for quota-exhausted tasks
- [ ] macOS notifications for flags, completions, errors
- [ ] CLI: `zora steer`, `zora flags`, `zora approve/reject`, `zora dashboard`

### Phase 6: Security & Polish (Week 11-12)

- [ ] Prompt injection defense (sanitizer + validator)
- [ ] Secrets management (AES-256-GCM + Keychain)
- [ ] Audit logging with hash chain
- [ ] Integrity guardian
- [ ] Leak detection
- [ ] Web fetch + web search tools
- [ ] MCP server support
- [ ] CLI: `zora audit`

### Phase 7: Testing & Hardening (Week 13-14)

- [ ] Integration tests for dual-LLM failover
- [ ] Cross-agent collaboration smoke tests
- [ ] Steering mid-task test (inject steer, verify course correction)
- [ ] Stress test: 24-hour continuous operation
- [ ] Quota exhaustion simulation
- [ ] Security audit (prompt injection, path traversal, secret leakage)
- [ ] Documentation
- [ ] First production deployment on Rich's Mac

---

## 10. Open Questions

1. **Claude session token lifecycle** — How long do Mac session tokens last? Do they auto-renew? Need to test and implement refresh logic if needed.

2. **Gemini CLI structured output** — Does Gemini CLI support JSON-mode or function-calling output? If not, we need a response parser that handles natural language tool invocations.

3. **Gemini CLI Workspace quota details** — What are the actual rate limits for Workspace-authenticated Gemini CLI usage? Need to benchmark.

4. **Memory vector search** — V1 uses keyword search. When should we upgrade to vector embeddings? After how much accumulated memory does keyword search become insufficient?

5. **Team coordination overhead** — The filesystem mailbox pattern (from Agent Teams Dev Guide) adds polling latency. Is 5-second poll interval fast enough for tight collaboration, or do we need filesystem watchers (`fs.watch`) for near-instant message delivery?

6. **Gemini bridge reliability** — The Gemini bridge (from Gemini Team Integration guide) translates between mailbox protocol and CLI stdin/stdout. What happens when Gemini CLI hangs or produces malformed output? Need robust timeout + retry logic in the bridge process.

7. **Steering conflict resolution** — If Rich steers mid-task and the agent has already taken an irreversible action (e.g., pushed a git commit), what's the undo/reconciliation strategy? Need to define "reversible" vs. "irreversible" action categories.

8. **Dashboard technology** — TUI (blessed/ink) vs. local web UI (localhost:7070) vs. both? Web UI is more flexible but adds a dependency. TUI is immediate but limited.

---

## 11. Success Criteria

The spec is implemented successfully when:

1. **Autonomous execution** — Agent completes a 10-step task (research → code → test → document) without human intervention.
2. **Failover works** — When Claude quota is artificially exhausted, the agent seamlessly continues on Gemini and produces equivalent-quality output.
3. **24-hour uptime** — Agent runs for 24 hours handling heartbeat tasks and user requests without crashes or memory leaks.
4. **No permission dialogs** — Zero permission prompts during a full workday of typical use (within declared policy).
5. **Memory persistence** — Agent remembers a preference stated 3 days ago and applies it without being reminded.
6. **Security baseline** — Prompt injection test suite (10 common patterns) blocked successfully. Secrets never appear in logs or LLM output.
7. **Sub-60-second failover** — Time from quota error to Gemini taking over is under 60 seconds, including context packaging.
8. **Cross-agent collaboration** — Two agents (Claude + Gemini) complete a parallelizable task in less than 60% of the time a single agent would take.
9. **Async steering works** — Rich injects a steer message mid-task, agent adjusts course within 10 seconds, no work is lost or blocked.
10. **Flags don't block** — Agent flags 3+ uncertain decisions during a complex task, proceeds with defaults for all of them, Rich reviews after completion.

---

## Appendix A: Inspirations & Attributions

| Project | Key Ideas Adopted |
|---------|-------------------|
| **Nanobot** (HKUDS) | Event-driven message bus, provider registry pattern, heartbeat system, JSONL sessions, ultra-lightweight philosophy, workspace sandboxing, skills system |
| **OpenClaw** | Auth profile rotation with cooldown, hooks system, multi-channel architecture (adapted as multi-model), execution approval patterns (adapted as capability policy), session write locking |
| **IronClaw** (NEAR AI) | Capability-based WASM security model (adapted as capability policy), prompt injection defense (sanitizer + validator + policy), hybrid memory search (RRF), secrets management with leak detection, self-repair for stuck jobs |
| **Open Personal Agent** (NevaMind) | Claude Code Agent SDK integration patterns, task pool management, SSE streaming, memory summarization polling, agentic tool loop with max iterations |
| **memU** (NevaMind) | Three-tier memory hierarchy (resource → item → category), six memory types taxonomy, proactive memory extraction, salience-aware retrieval (reinforcement + recency decay), workflow pipeline architecture, dual-mode retrieval (fast vs. deep) |
| **ClawSec** (Prompt Security) | Hash-chained audit logs, integrity guardian (soul guardian), advisory feed concept, approval-gated installation, SHA-256 baseline integrity checking, quarantine-and-restore pattern |
| **Claude Code Agent Teams** (Anthropic) | Filesystem mailbox pattern for inter-agent communication (§5.7), team configuration structure, control message protocol, message injection for human steering (§5.8) |
| **Gemini Team Integration** | Bridge pattern for Gemini as team member (§5.7), inbox polling workflow, async cross-model collaboration via filesystem mailboxes |

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Handoff Bundle** | Serialized execution context passed from one LLM provider to another during failover |
| **Capability Policy** | Declarative TOML file defining what the agent is allowed to do (filesystem paths, shell commands, network access) |
| **Heartbeat** | Periodic agent wake-up to check for and execute proactive tasks |
| **Routine** | A scheduled or event-triggered task definition |
| **Memory Item** | A single extracted fact stored as a JSON file in the memory system |
| **Provider Health Score** | 0-1 metric based on recent success rate, used for routing decisions |
| **Integrity Baseline** | SHA-256 hashes of critical configuration files, checked periodically for tampering |
| **Leak Detection** | Scanning LLM outputs for strings matching known secret patterns |
| **Task Classification** | Categorizing a task by complexity and resource needs to determine optimal model routing |
| **Smart Routing** | Automatic selection of the best LLM provider for a given task based on classification and provider health |
| **Mailbox** | A JSON file in `~/.zora/teams/{team}/inboxes/` that acts as an async message queue for one agent |
| **Steer Message** | A human-injected directive that redirects a running agent without blocking it |
| **Flag** | A decision point the agent is uncertain about — it proceeds with a default but notifies the human for optional override |
| **Gemini Bridge** | Background process that translates between filesystem mailbox protocol and Gemini CLI stdin/stdout |
| **Team** | A group of Claude and/or Gemini agents collaborating on a task via filesystem mailboxes |
| **Coordinator** | The lead agent in a team, responsible for task decomposition, agent assignment, and result synthesis |

---

*End of Specification*