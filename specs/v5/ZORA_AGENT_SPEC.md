# Zora — Technical Specification

> **Version:** 0.5.0-draft
> **Author:** Rich Yaker (ryaker@yaker.org)
> **Date:** 2026-02-11
> **Status:** N-PROVIDER ARCHITECTURE — Generalized from dual-LLM to configurable multi-provider with capability-based routing
> **Methodology:** Spec-Driven Development (GitHub Spec Kit format)
> **Reviews:**
> - v0.2: Gemini architectural review (concurrency safety, kill switch, auth fallback, fs watchers, context pruning, CLI output hardening)
> - v0.3: GPT 5.2 analysis (risk assessment, operational hardening gaps), Claude Opus 4.6 consolidated review (attack surfaces, memory poisoning, bridge SPOF, auth lifecycle), Gemini implementation pattern extraction across 6 open-source codebases
> - v0.4: Consolidation pass — restored placeholder sections, merged dropped journeys, design decisions, open questions, and success criteria from v0.2
> - v0.5: Grok 3 analysis (auth degradation, handoff bundles, resource usage, irreversible actions). N-provider architecture refactor — user-ranked provider registry with capability-based smart routing, cost-tier awareness, provider-agnostic failover

---

## 1. Vision

Zora is a long-running, autonomous personal AI agent that runs locally on macOS. It gets shit done — executing complex, multi-step tasks without constant permission prompts, using Claude as its primary brain and Gemini as a secondary/failover engine, with a stubbed-in local model tier for future expansion. It draws architectural inspiration from six studied open-source projects (Nanobot, OpenClaw, IronClaw, Open Personal Agent, memU, ClawSec) while remaining a clean, purpose-built system designed around the Claude Code Agent SDK and Gemini CLI.

The core philosophy: **the agent works for you like a tireless, trusted employee who already has your credentials, knows your preferences, and can switch between tools and models to keep work flowing even when one provider hits quota limits or auth expires.**

---

## 2. Goals & Non-Goals

### Goals

1. **Autonomous long-running execution** — The agent persists across sessions, maintains state, and works on tasks for hours or days without human babysitting.
2. **N-provider architecture with smart routing** — Configurable ranked provider registry (Claude, Gemini, OpenAI/Codex, local models, anything with an LLM interface). Users stack-rank their preferred providers and tag capabilities. The router matches task requirements to the best available provider, respecting user preferences and cost tiers. Automatic failover walks down the ranked list.
3. **Local-first security** — All data stays on your Mac. No cloud transcripts. Encrypted secrets with JIT decryption. Capability-based tool permissions.
4. **Zero-permission-prompt operation** — Pre-authorized execution within user-defined trust boundaries. The agent uses allowlists and capability policies, not per-action approval dialogs.
5. **Claude Code Agent SDK native** — Built on the official SDK, using long-running Mac account tokens (not per-call API keys) for Claude.
6. **Gemini CLI + Workspace quotas** — Gemini invoked through its CLI, consuming Google Workspace account quotas rather than paid API billing.
7. **Proactive memory (memU-inspired)** — Three-tier hierarchical memory with salience-aware retrieval, proactive extraction, and category auto-organization.
8. **Extensible tool system** — MCP servers, shell commands, file operations, web access, and custom tools — all sandboxed and auditable.
9. **Real workflow automation** — Content pipelines, marketing campaigns, job search, recurring operational tasks — not a demo, a production tool.

### Non-Goals

- **Not a chatbot framework** — No Telegram/Discord/Slack channel integrations in v1. This is a local agent for your Mac, not a multi-channel messaging platform.
- **Not a SaaS product** — No user management, multi-tenancy, or billing.
- **Not an LLM benchmark tool** — Ships with Claude and Gemini providers. Users can add OpenAI, Codex, local models, etc. via the provider registry. But Zora is an agent, not a model evaluation harness — the goal is getting work done, not A/B testing providers.
- **Not a container orchestrator** — No Docker/Kubernetes for the agent itself. Runs as a native macOS process. Docker deployment guide provided for Linux users.

---

## 3. User Journeys

### Journey 1: First Run — Trust Establishment

Rich installs Zora and runs the onboarding command. The agent:

1. Detects the Claude Code SDK installation and authenticates using the existing Mac-level Claude session token (no API key entry required).
2. Detects the Gemini CLI installation and authenticates using the existing Google Workspace SSO session.
3. **Pre-flight auth health check** — verifies both provider tokens are valid and estimates time-to-expiry where possible.
4. Generates a default capability policy: file access within `~/Projects`, shell execution with a safe-command allowlist, web fetch allowed, no destructive system operations.
5. Creates the workspace at `~/.zora/` with encrypted secrets store, memory database, session history, and heartbeat file.
6. **Computes integrity baselines** — SHA-256 hashes of `SOUL.md`, `MEMORY.md`, `policy.toml`, `config.toml`, and the tool registry are stored in `state/integrity-baselines.json`.
7. Rich reviews the capability policy in `~/.zora/policy.toml` and tweaks it (e.g., adds `~/Documents` to allowed paths, adds `docker` to allowed commands).
8. The agent is ready. No further setup needed.

### Journey 2: Complex Task — "Research and build me a comparison doc"

Rich tells the agent:

> "Research the top 5 headless CMS platforms for our use case — we need something that integrates with Next.js, has a generous free tier, and supports content localization. Write a comparison doc with pros/cons and your recommendation. Save it to ~/Documents/cms-comparison.md."

The agent:

1. **Routes to Claude** (primary) because this is a reasoning-heavy research + writing task.
2. **Plans the work** — breaks it into subtasks: web research (5 platforms), feature comparison matrix, prose writeup, recommendation synthesis.
3. **Executes web searches** using its web_fetch tool, gathering data on each platform.
4. **Hits Claude's rate limit** mid-task after 40 minutes of intensive work.
5. **Automatically fails over to Gemini** — the orchestrator detects the quota error, creates a HandoffBundle (task plan, progress, intermediate results, natural language briefing note), and dispatches to Gemini CLI.
6. **Gemini completes the writeup**, following the same plan and incorporating the research Claude already gathered.
7. **Saves the final document** to `~/Documents/cms-comparison.md`.
8. **Notifies Rich** via macOS notification: "CMS comparison doc is ready."
9. **Extracts memory items** — "Rich prefers Next.js-compatible tools", "CMS evaluation criteria: free tier, localization support" — stored with salience scoring for future context.

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

### Journey 5: Content Pipeline — "Run my weekly marketing workflow"

Rich configures a routine:

> "Every Tuesday at 6am, generate the weekly blog post for MyMoneyCoach.ai using the StoryBrand framework and PEACE soundbites. Then generate circular soundbite social posts for Wednesday through Monday. Save everything to ~/Projects/mymoneycoach/content/."

The agent:

1. Retrieves high-salience memory items from the `mymoneycoach/brand-messaging` category — PEACE framework, Sophia's voice, brand guidelines.
2. Checks recent Facebook engagement data (via web fetch or bookmarked analytics URL).
3. **Routes to Claude** — creative content generation needs Claude's writing quality.
4. Generates the Tuesday blog post following StoryBrand methodology.
5. Generates five circular soundbite social posts, each extracting a different angle from the blog.
6. Saves all outputs with proper dating to the content directory.
7. **Extracts memory** — notes which topics/angles were used this week to avoid repetition.
8. Notifies Rich: "Week of 2026-02-17 content is ready for review."

### Journey 6: Auth Degradation — "Claude died, keep working"

Mid-task, Claude's Mac session token expires:

1. Claude Provider returns auth error.
2. **Failover Controller** detects this is an **auth failure**, not quota exhaustion.
3. **Checkpoints** the current job — saves task plan, progress, and intermediate results.
4. **Promotes Gemini to primary for all task types** — not just structured tasks, everything, with quality degradation warning.
5. **Notifies Rich** via macOS notification: "⚠️ Claude auth expired. Running on Gemini only. Re-authenticate in Claude Desktop when you're at your Mac."
6. Gemini continues all pending work.
7. **On every heartbeat**, checks if Claude auth has been restored.
8. When Rich re-authenticates, **resumes checkpointed Claude jobs** from where they left off.

### Journey 7: Job Search Automation

Rich configures a daily routine:

> "Every weekday at 8am, search for CTO, VP Engineering, and senior technical leadership roles. Compare against previously seen listings. For new matches, draft a tailored cover letter variant. Save to ~/Documents/job-search/."

The agent:

1. **Routes to Gemini** — structured web search and data comparison, saves Claude quota.
2. Searches configured job boards via web_fetch.
3. Compares results against memory items tagged `job-search/seen-listings`.
4. For new matches, **routes the cover letter to Claude** — creative personalized writing.
5. Saves daily report and cover letters.
6. **Memory extraction** — stores new listings as memory items for deduplication tomorrow.

---

## 4. Architecture

### 4.1 System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           ZORA                                      │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    ORCHESTRATOR CORE                          │  │
│  │                                                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐  │  │
│  │  │   Router     │  │  Scheduler  │  │  Failover Controller │  │  │
│  │  │ (task→model) │  │ (jobs/cron) │  │  (quota/auth mgmt)   │  │  │
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
│  │                LLM PROVIDER REGISTRY (N-provider)             │  │
│  │          User-ranked • Capability-tagged • Cost-aware         │  │
│  │                                                               │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │  │
│  │  │   Claude      │  │   Gemini     │  │   OpenAI     │       │  │
│  │  │   Provider    │  │   Provider   │  │   Provider   │       │  │
│  │  │ • Agent SDK  │  │ • CLI invoke │  │ • API direct │       │  │
│  │  │ • Mac token  │  │ • Workspace  │  │ • API key    │       │  │
│  │  │ • rank: 1    │  │ • rank: 2    │  │ • rank: 3    │       │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘       │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │  │
│  │  │   Codex      │  │   Local      │  │   Custom     │       │  │
│  │  │   Provider   │  │   Provider   │  │   Provider   │       │  │
│  │  │ • API direct │  │ • Ollama API │  │ • LLMProvider│       │  │
│  │  │ • API key    │  │ • Always on  │  │   interface  │       │  │
│  │  │ • rank: 4    │  │ • rank: 5    │  │ • rank: N    │       │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘       │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                       TOOL LAYER                              │  │
│  │  ┌────────┐ ┌────────┐ ┌──────┐ ┌─────┐ ┌──────┐ ┌───────┐ │  │
│  │  │ Shell  │ │ Files  │ │ Web  │ │ MCP │ │Memory│ │Notify │ │  │
│  │  │ Exec   │ │ R/W/E  │ │Fetch │ │Srvrs│ │Search│ │macOS  │ │  │
│  │  └────────┘ └────────┘ └──────┘ └─────┘ └──────┘ └───────┘ │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              MEMORY LAYER (memU-inspired)                     │  │
│  │                                                               │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │  │
│  │  │ Tier 1:      │ │ Tier 2:      │ │ Tier 3:              │ │  │
│  │  │ Long-term    │ │ Daily Notes  │ │ Structured Items     │ │  │
│  │  │ (MEMORY.md)  │ │ (daily/*.md) │ │ (items/*.json)       │ │  │
│  │  └──────────────┘ └──────────────┘ └──────────────────────┘ │  │
│  │  ┌──────────────────────────────────────────────────────────┐│  │
│  │  │ Salience Engine: reinforcement + recency decay + relevance││  │
│  │  │ Category Summaries: auto-organized, token-efficient       ││  │
│  │  │ Extraction Pipeline: schema-guided with correction loop   ││  │
│  │  └──────────────────────────────────────────────────────────┘│  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              PERSISTENCE LAYER                                │  │
│  │  ┌──────────┐ ┌───────────┐ ┌─────────┐ ┌────────────────┐  │  │
│  │  │Sessions  │ │ Secrets   │ │Routines │ │ State          │  │  │
│  │  │(JSONL)   │ │ (enc/JIT) │ │(TOML)   │ │ (atomic writes)│  │  │
│  │  └──────────┘ └───────────┘ └─────────┘ └────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              SECURITY LAYER                                   │  │
│  │  ┌──────────────┐ ┌────────────┐ ┌───────────┐ ┌──────────┐ │  │
│  │  │ Capability   │ │ Prompt     │ │ Integrity │ │ Audit    │ │  │
│  │  │ Policy +     │ │ Injection  │ │ Guardian  │ │ Logger   │ │  │
│  │  │ Worker Scope │ │ Defense    │ │(+tool reg)│ │(hash-chn)│ │  │
│  │  └──────────────┘ └────────────┘ └───────────┘ └──────────┘ │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Component Breakdown

#### Orchestrator Core

The heart of Zora. Responsible for receiving tasks, routing them to the right model, managing execution, and handling failures.

**Router** — Decides which LLM provider handles each task or subtask. The router is **provider-agnostic** — it doesn't contain hard-coded knowledge about "Claude" or "Gemini." Instead, it matches task requirements to **provider capabilities** and **user-defined rankings**.

Each provider declares capabilities (tags) and a cost tier. The router classifies the incoming task, then selects the highest-ranked healthy provider that has the required capabilities.

**Routing modes** (configurable in `config.toml`):

| Mode | Behavior |
|------|----------|
| `respect_ranking` | Always try user's #1 ranked capable provider first. Fall down the list on failure. (Default) |
| `optimize_cost` | Use the cheapest capable provider. Save premium providers for tasks that specifically need them. |
| `provider_only` | Lock all tasks to a single named provider (e.g., `"claude_only"` for debugging). |
| `round_robin` | Distribute work evenly across healthy providers (useful for load balancing or benchmarking). |

**Capability matching** — The router matches task classification tags to provider capability tags:

| Task Classification | Required Capability | Example Providers |
|--------------------|--------------------|--------------------|
| deep-reasoning + any | `reasoning` | Claude, GPT |
| creative + any | `creative`, `writing` | Claude, GPT |
| structured-execution + token-light | `structured-data` | Gemini, Local, any |
| structured-execution + token-heavy | `large-context` | Gemini (1M window) |
| iterative + code | `coding` | Claude, Codex, GPT |
| simple shell / data processing | `structured-data` | Cheapest available |
| memory extraction | `structured-data` | Cheapest available |
| heartbeat / routine checks | (any) | Cheapest available |

**Failover** is just "walk down the ranked list." If provider #1 is unavailable (quota, auth, error), try #2, then #3, etc. No special-case "promote Gemini" logic — failover is the same algorithm regardless of which provider fails.

**Per-routine overrides** — Routines can specify `model_preference` in TOML (§5.6) to pin specific tasks to specific providers. User overrides always take precedence over smart routing.

**Scheduler** — Manages the execution queue:

- **Immediate jobs**: User-initiated tasks executed now.
- **Background jobs**: Spawned subtasks running in parallel.
- **Routines**: Cron-scheduled recurring tasks.
- **Heartbeat tasks**: Periodic proactive checks (inspired by Nanobot's `HEARTBEAT.md` pattern).
- **Retry queue**: Tasks that failed due to quota/transient errors, scheduled for retry with exponential backoff.

Max parallel jobs: configurable (default 3), preventing resource exhaustion.

**Failover Controller** — Monitors all registered provider health and manages transitions:

- Tracks quota usage, error rates, **auth status**, and cooldown timers **per provider**.
- Distinguishes between **quota exhaustion** (temporary, retry later) and **auth failure** (requires human intervention).
- On any provider failure: packages current execution context into a **HandoffBundle** and dispatches to the **next-ranked healthy provider** that has the required capabilities.
- On **auth failure**: checkpoints all active jobs on the failed provider, notifies user to re-authenticate, and redistributes work down the ranked list.
- On auth restoration: resumes checkpointed jobs on the restored provider.
- If ALL providers are down: queues work for retry, with exponential backoff per provider.
- Cooldown tracking with exponential backoff (inspired by OpenClaw's auth profile rotation).
- Provider health dashboard available via `zora status`.

#### LLM Provider Layer — N-Provider Registry

**Unified Interface**

All providers implement a common `LLMProvider` interface. The provider registry is **config-driven** — adding a new provider means adding a `[[providers]]` entry in `config.toml` and (if it's a new integration type) a provider adapter class.

```typescript
interface LLMProvider {
  name: string;
  rank: number;                    // User-defined priority (1 = highest)
  capabilities: ProviderCapability[];
  costTier: CostTier;
  isAvailable(): Promise<boolean>;
  checkAuth(): Promise<AuthStatus>;
  getQuotaStatus(): Promise<QuotaStatus>;
  execute(task: TaskContext): AsyncGenerator<AgentEvent>;
  abort(jobId: string): Promise<void>;
}

type ProviderCapability =
  | "reasoning"          // Multi-step logic, planning, analysis
  | "coding"             // Code generation, refactoring, debugging
  | "creative"           // Writing, brainstorming, nuanced communication
  | "structured-data"    // Data gathering, summarization, extraction
  | "large-context"      // 500K+ token context windows
  | "search"             // Web grounding, real-time information
  | "fast"               // Low-latency responses
  | string;              // Custom capabilities for user-defined tags

type CostTier =
  | "free"               // Local models, free tiers
  | "included"           // Covered by existing subscription (Workspace, Max)
  | "metered"            // Per-token API billing
  | "premium";           // Expensive models (Opus, o3-pro)

interface AuthStatus {
  valid: boolean;
  expiresAt: Date | null;       // null if unknown
  canAutoRefresh: boolean;       // Gemini: yes (refresh token), Claude Mac: no
  requiresInteraction: boolean;  // needs browser/GUI to re-auth
}

interface QuotaStatus {
  isExhausted: boolean;
  remainingRequests: number | null;
  cooldownUntil: Date | null;
  healthScore: number;  // 0-1, based on recent success rate
}
```

**Provider Selection Algorithm**

```
1. Classify incoming task → required capabilities
2. Filter: providers with required capabilities AND healthy auth AND not quota-exhausted
3. If routing_mode == "respect_ranking":
     Sort by user rank (ascending)
4. If routing_mode == "optimize_cost":
     Sort by cost_tier (free → included → metered → premium), then by rank within tier
5. If per-routine model_preference is set:
     Move named provider to front (if healthy)
6. Return first provider in sorted list
7. On failure: remove failed provider, repeat from step 2
```

#### Shipped Providers

Zora ships with four provider adapters. Users can add more by implementing the `LLMProvider` interface.

**Claude Provider** (`type: "claude-sdk"`)

- **SDK**: Claude Code Agent SDK (`@anthropic-ai/claude-code`)
- **Authentication**: Long-running Mac account session token. No API key required.
- **Default capabilities**: `reasoning`, `coding`, `creative`
- **Default cost tier**: `included` (Max subscription)
- **Auth lifecycle**: Pre-flight validation on startup and every heartbeat. On auth failure: checkpoint + notify + failover to next-ranked. On restoration: resume checkpointed jobs.
- **Execution mode**: Embedded — runs Claude as an in-process agent with full tool-calling support.
- **Max turns**: 200 per job (configurable). Prevents infinite loops.
- **Extended thinking**: Enabled for complex tasks (budget configurable).
- **Context**: System prompt + memory context (salience-ranked) + task history + tool definitions.

**Gemini Provider** (`type: "gemini-cli"`)

- **CLI**: Gemini CLI (`gemini`) invoked as a subprocess.
- **Authentication**: Google Workspace SSO session. Refresh tokens are long-lived (~6 months) and auto-renew silently.
- **Default capabilities**: `search`, `structured-data`, `large-context`, `coding`
- **Default cost tier**: `included` (Workspace quota)
- **Auth lifecycle**: Better than most — auto-refresh works without user interaction. Only fails on token revocation.
- **Execution mode**: Subprocess — spawns `gemini` CLI with structured prompts, captures output.
- **Output parsing**: Multi-format response parser handles raw text, markdown-fenced JSON, XML-tagged blocks.
- **Context passing**: For failover handoffs, context is serialized to a markdown document passed as input.

**OpenAI Provider** (`type: "openai-api"`)

- **SDK**: OpenAI API via `openai` npm package.
- **Authentication**: API key (`OPENAI_API_KEY`), or ChatGPT Plus/Pro subscription token if supported.
- **Default capabilities**: `reasoning`, `coding`, `creative` (varies by model — Codex adds `coding` + `fast`)
- **Default cost tier**: `metered` (API) or `included` (subscription)
- **Execution mode**: API calls with function-calling, streamed responses.
- **Models**: User configures which model (gpt-4.1, o3, codex, etc.) — the provider doesn't assume.
- **Note**: Users with ChatGPT Plus/Pro who also have API credits can run two OpenAI providers: one `included` (subscription) and one `metered` (API) with different models.

**Local Provider** (`type: "ollama"`)

- **Endpoint**: Ollama API at `http://localhost:11434` (configurable).
- **Authentication**: None. Always available when the Ollama process is running.
- **Default capabilities**: `structured-data`, `coding` (model-dependent)
- **Default cost tier**: `free`
- **Use cases**: Heartbeat tasks, memory extraction, structured summarization — tasks that don't need frontier reasoning.
- **Status**: `enabled = false` in default config. Flip when hardware is ready.

#### Adding Custom Providers

Any LLM service with a REST API or CLI can become a Zora provider:

1. Implement the `LLMProvider` interface (auth check, quota check, execute, abort).
2. Register a `type` string (e.g., `"mistral-api"`, `"together-api"`, `"anthropic-api"`).
3. Add a `[[providers]]` entry in `config.toml` with the new type.

The provider doesn't need to support tool calling natively — Zora can run in "prompt-and-parse" mode where tool calls are encoded in the prompt and parsed from the response. This is slower but enables any chat-completions-compatible API.

### 4.3 Filesystem Layout

```
~/.zora/
├── config.toml                    # Main configuration
├── policy.toml                    # Capability/permission policy (READ-ONLY to agent tools)
├── secrets.enc                    # AES-256-GCM encrypted secrets store
├── sessions/
│   └── {job-id}.jsonl             # Per-job conversation history
├── memory/
│   ├── MEMORY.md                  # Long-term knowledge base (READ-ONLY to agent tools)
│   ├── daily/
│   │   └── YYYY-MM-DD.md         # Daily observations/notes
│   ├── items/                     # Extracted memory facts (memU-style)
│   │   └── {item-id}.json        # Individual memory items with salience scores
│   └── categories/                # Auto-organized topic summaries
│       └── {category}.json        # Category summary + member item IDs
├── routines/
│   └── {routine-name}.toml       # Scheduled task definitions
├── workspace/                     # Agent's scratchpad
│   ├── HEARTBEAT.md              # Proactive task checklist
│   ├── SOUL.md                   # Agent identity/personality (READ-ONLY to agent tools)
│   └── context/                  # Working files for active jobs
├── audit/
│   └── audit.jsonl               # Append-only hash-chained security audit log
├── tools/
│   └── mcp/                      # MCP server configurations
│       └── {server-name}.json
├── teams/                         # Cross-agent communication (Phase 4)
│   └── {team-name}/
│       ├── config.json
│       └── inboxes/
│           └── {agent-id}.json
└── state/
    ├── provider-health.json      # LLM provider health + auth status
    ├── active-jobs.json          # Currently running jobs (atomic writes)
    ├── retry-queue.json          # Tasks awaiting retry
    ├── integrity-baselines.json  # SHA-256 hashes of critical files + tool registry
    └── bridge-health.json        # Gemini bridge watchdog status
```

**Critical file protection:** `SOUL.md`, `MEMORY.md`, `policy.toml`, and `config.toml` are **read-only to the agent's tool layer**. The agent can read these files to build context but cannot modify them via `write_file` or `edit_file` tools. Modifications require human action via CLI commands (`zora config edit`, `zora memory edit`). This prevents prompt injection attacks from modifying the agent's identity, permissions, or long-term knowledge through tool output poisoning.

**Atomic writes for shared state:** `active-jobs.json`, `provider-health.json`, and `retry-queue.json` use atomic write-then-rename to prevent corruption under concurrent access. Write to `{file}.tmp`, then `rename()` over the original.

**Audit log serialization:** `audit.jsonl` uses a dedicated single-writer queue to serialize appends from concurrent workers. No direct file access from workers.

---

## 5. Detailed Design

### 5.1 N-Provider Orchestration & Failover

This is Zora's most distinctive feature. The system treats LLM providers not as interchangeable backends but as **complementary specialists with different strengths, costs, and availability profiles**. Users stack-rank their providers, tag capabilities, and Zora's router handles the rest — including automatic failover when any provider goes down.

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

**Default capability-to-task mapping:**

| Task Classification | Required Capabilities | Selection Strategy |
|--------------------|----------------------|-------------------|
| deep-reasoning + any | `reasoning` | Highest-ranked with `reasoning` tag |
| creative + any | `creative` or `writing` | Highest-ranked with `creative` tag |
| structured-execution + token-light | `structured-data` | Cheapest available (if `optimize_cost`) or highest-ranked |
| structured-execution + token-heavy | `large-context` | Provider with largest context window |
| iterative + code | `coding` | Highest-ranked with `coding` tag |
| simple data processing | `structured-data` | Cheapest available |
| memory extraction / heartbeat | (any) | Cheapest available |

**Auth/quota degradation:** When any provider's auth expires or quota is exhausted, the router simply skips it and tries the next-ranked capable provider. No special-case promotion logic — the algorithm is the same regardless of which provider fails.

User overrides and per-routine `model_preference` always take precedence over smart routing. The routing mode and capability mappings are configurable in `config.toml`.

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
  workingFiles: FileRef[];         // Files created/modified (by reference, not inline)
  failureReason: string;           // Why we're failing over (quota vs auth)
  resumeInstructions: string;      // Natural language handoff briefing note
}
```

The `resumeInstructions` field is critical — the outgoing provider writes a natural language briefing note for the incoming provider. This is more robust than rigid schemas for cross-model handoffs. **Always populated, even for simple failovers.**

Maximum handoff bundle size: configurable (default 50,000 tokens). Trimming priority: conversation history first, then intermediate results, never the task plan or resume instructions.

The receiving provider gets a synthesized prompt:

```
You are continuing a task that was started by another AI assistant.
Here is the context of what has been accomplished so far and what
remains to be done.

[Handoff Bundle serialized as structured markdown]

Please continue from where the previous assistant left off.
Do not redo completed work. Focus on the remaining steps.
```

This approach was inspired by OpenClaw's session management. The key insight from studying these repos: **context packaging for handoff is more important than protocol standardization.** Because the HandoffBundle uses natural language briefing notes (not rigid schemas), it works across any pair of providers — Claude to Gemini, Gemini to OpenAI, OpenAI to local model, etc.

#### Auth Health Monitoring

```typescript
// Runs on every heartbeat (30-minute interval)
async function checkProviderHealth() {
  for (const provider of registry.getAll()) {
    const auth = await provider.checkAuth();

    if (!auth.valid && auth.requiresInteraction) {
      // Auth expired, needs human intervention
      await notify(`⚠️ ${provider.name} auth expired. Re-authenticate when at your Mac.`);

      // Checkpoint all active jobs on this provider
      await checkpointActiveJobs(provider.name);
      // No special-case promotion — the router's selection algorithm
      // automatically skips unhealthy providers and uses the next-ranked one
    }

    if (auth.valid && auth.expiresAt) {
      const hoursRemaining = (auth.expiresAt.getTime() - Date.now()) / 3600000;
      if (hoursRemaining < provider.config.preExpiryWarningHours) {
        await notify(`${provider.name} token expires in ~${Math.round(hoursRemaining)}h. Re-authenticate when convenient.`);
      }
    }
  }

  // Check if ALL providers are down — critical alert
  const healthy = registry.getHealthy();
  if (healthy.length === 0) {
    await notify("🔴 All LLM providers are down. Queuing work for retry. Re-authenticate at least one provider.");
  }
}
```

#### Quota Management & Provider Registry Config

Providers are defined as an **ordered array** in `config.toml`. Users add, remove, reorder, and tag providers freely. The `rank` field determines failover priority. See §7 for the full config reference.

```toml
# config.toml — provider registry (abbreviated, see §7 for full reference)
[[providers]]
name = "claude"
type = "claude-sdk"
rank = 1
capabilities = ["reasoning", "coding", "creative"]
cost_tier = "included"
auth_method = "mac_session"
model = "claude-sonnet-4-5"
max_concurrent_jobs = 3
cooldown_base = "5s"
cooldown_max = "30m"
pre_expiry_warning = "2h"

[[providers]]
name = "gemini"
type = "gemini-cli"
rank = 2
capabilities = ["search", "structured-data", "large-context", "coding"]
cost_tier = "included"
auth_method = "workspace_sso"
model = "gemini-2.5-pro"
max_concurrent_jobs = 2

[[providers]]
name = "codex"
type = "openai-api"
rank = 3
capabilities = ["coding", "fast"]
cost_tier = "metered"
auth_method = "api_key"
model = "codex-mini-latest"
max_concurrent_jobs = 2
enabled = false                    # Enable when API key is configured

[[providers]]
name = "local"
type = "ollama"
rank = 99                          # Last resort
capabilities = ["structured-data"]
cost_tier = "free"
auth_method = "none"
endpoint = "http://localhost:11434"
model = "qwen2.5-coder:32b"
enabled = false                    # Enable when hardware is ready

[failover]
enabled = true
auto_handoff = true
max_handoff_context_tokens = 50000
retry_after_cooldown = true
max_retries = 3
checkpoint_on_auth_failure = true
notify_on_failover = true
```

### 5.2 Execution Loop

The core agentic loop, inspired by Nanobot's clean design but extended for dual-LLM support and error feedback:

```
1. Receive task (from user CLI, routine trigger, or heartbeat)
2. Router classifies task → selects provider (respecting auth overrides)
3. Scheduler enqueues job, respects max_concurrent_jobs
4. Worker starts (with SCOPED capability token — see §5.3):
   a. Build context: system prompt + memory (salience-ranked) + task + tool definitions
   b. Call LLM provider
   c. If LLM returns tool calls:
      - Validate against capability policy (worker's scoped token, not global)
      - If policy violation: return structured error to LLM (Nanobot pattern)
        → LLM self-corrects, no blocking, no human escalation
        → Violation logged to audit with hash chain
      - Execute tools (parallel where independent)
      - Wrap results, feed back to LLM
      - Go to (b) — max iterations enforced
   d. If LLM returns final response:
      - Save to session history
      - Trigger memory extraction (if significant interaction, see §5.4)
      - Notify user (if configured)
      - Mark job complete
   e. If LLM returns error (quota/rate limit/timeout):
      - Failover Controller evaluates:
        - If quota error + other provider available → HandoffBundle → dispatch
        - If auth error → checkpoint + promote secondary + notify user
        - If no provider available → queue for retry
        - If max retries exceeded → notify user of failure
5. Post-execution: update provider health metrics, audit log (hash-chained)
```

**Max iterations per job:** 200 (Claude), 100 (Gemini). Configurable. Prevents infinite tool-call loops.

**Timeout per job:** 2 hours default. Long-running tasks that exceed this get checkpointed and can be resumed.

### 5.3 Tool System & Worker Scoping

#### Built-in Tools

| Tool | Description | Approval Required |
|------|-------------|-------------------|
| `read_file` | Read file contents | No (within worker's allowed paths) |
| `write_file` | Create/overwrite files | No (within worker's allowed paths, NOT critical files) |
| `edit_file` | Surgical text replacement | No (within worker's allowed paths, NOT critical files) |
| `list_directory` | List directory contents | No (within worker's allowed paths) |
| `shell_exec` | Execute shell commands | No (if command in worker's allowlist) |
| `web_fetch` | Fetch URL content as markdown | No |
| `web_search` | Search the web | No |
| `memory_search` | Query long-term memory | No (within worker's allowed categories) |
| `memory_write` | Store fact in memory items/daily | No (NOT to MEMORY.md — human only) |
| `spawn_subtask` | Create background subtask | No |
| `schedule_routine` | Create recurring task | No |
| `notify_user` | Send macOS notification | No |
| `git_operations` | Git commands (commit, branch, push) | Push: always flagged (irreversible) |

#### Capability Policy Engine

Inspired by IronClaw's capability-based security (the strongest security model studied across all six codebases), with memU's category-level scoping for memory access. IronClaw uses WebAssembly (WASM) sandboxes for true memory-isolated tool execution; Zora adapts this as a policy-based capability model for v1, with WASM sandboxing as a v2 hardening path (see §5.5 and Decision 11):

```toml
# policy.toml

[filesystem]
allowed_paths = [
  "~/Projects",
  "~/Documents",
  "~/Downloads",
  "~/.zora/workspace",
  "~/.zora/memory/daily",       # Agent can write daily notes
  "~/.zora/memory/items"        # Agent can write memory items
]
denied_paths = [
  "~/.ssh",
  "~/.gnupg",
  "~/Library/Keychains",
  "~/.zora/config.toml",       # Human-only
  "~/.zora/policy.toml",       # Human-only
  "~/.zora/workspace/SOUL.md", # Human-only
  "~/.zora/memory/MEMORY.md"   # Human-only
]
resolve_symlinks = true           # Canonicalize paths before policy check
follow_symlinks = false           # Don't follow symlinks outside allowed boundaries

[shell]
mode = "allowlist"
allowed_commands = [
  "git", "npm", "node", "python3", "pip",
  "cargo", "rustc", "go",
  "docker", "docker-compose",
  "brew", "curl", "wget",
  "jq", "yq", "grep", "find", "sed", "awk",
  "cat", "head", "tail", "wc", "sort", "uniq",
  "ls", "mkdir", "cp", "mv",
  "make", "cmake",
  "psql", "sqlite3"
]
denied_commands = [
  "shutdown", "reboot",
  "format", "diskutil",
  "sudo"
]
# NOTE: 'rm' intentionally excluded from allowlist.
# Agent uses write_file/edit_file for file management.
# If rm is needed, add it explicitly and accept the risk.
split_chained_commands = true     # Split on &&, ||, ;, | and validate each
max_execution_time = "5m"

[actions]
# Action classification for steering (§5.8)
reversible = ["write_file", "edit_file", "git_commit", "mkdir", "cp", "mv"]
irreversible = ["git_push", "shell_exec_destructive"]
always_flag = ["git_push"]        # Always flag regardless of auto_approve_low_risk

[network]
allowed_domains = ["*"]
denied_domains = []
max_request_size = "10MB"

[memory]
# memU-inspired category-level scoping for workers
default_categories = ["*"]        # Full access by default
# Workers can be scoped to specific categories:
# worker_categories = ["mymoneycoach/*", "coding/*"]

[mcp]
allowed_servers = ["*"]
auto_approve_tools = true

[notifications]
enabled = true
on_task_complete = true
on_error = true
on_auth_expiry = true             # Critical: notify on auth degradation
on_long_running = "30m"
```

**Policy enforcement order:**
1. Resolve path to absolute canonical form (resolve `~`, follow/reject symlinks per config)
2. Check denied paths (deny takes precedence)
3. Check allowed paths
4. For shell commands: split on chain operators, validate each component
5. Check action classification (irreversible actions always flagged)

**Worker scoping (memU-inspired):** When the orchestrator spawns a worker for a specific task, it issues a **scoped capability token** that restricts the worker's access below the global policy:

```typescript
interface WorkerCapabilityToken {
  jobId: string;
  allowedPaths: string[];         // Subset of global policy
  allowedCommands: string[];      // Subset of global policy
  allowedMemoryCategories: string[]; // memU-style category scoping
  maxDuration: number;            // Timeout in seconds
  canSpawnSubtasks: boolean;
}
```

Workers can only narrow permissions, never widen them. The orchestrator holds the global policy; workers see their scoped view.

**Policy violation response (Nanobot pattern):** When a tool call falls outside the worker's scoped policy, it is **not blocked silently and not escalated to the human**. Instead, a structured error is returned to the LLM as a tool result:

```json
{
  "tool_call_id": "call_abc123",
  "status": "error",
  "error_type": "policy_violation",
  "message": "Access denied: /Users/rich/.ssh/id_rsa is outside allowed paths for this task. Try an alternative approach.",
  "allowed_paths": ["~/Projects/my-web-app"]
}
```

The LLM receives this as normal tool output and self-corrects. The violation is logged to the audit trail. No human intervention required, no execution blocked.

### 5.4 Memory System (memU-Inspired)

Three-tier memory architecture drawing directly from memU's hierarchical storage model, with salience-aware retrieval and proactive extraction.

#### Tier 1: Long-Term Knowledge (`MEMORY.md`)

A markdown file the agent reads on every invocation. Contains:
- User preferences (coding style, preferred tools, project conventions)
- Important facts (company name, team structure, API endpoints)
- Learned behaviors (how Rich likes commit messages formatted, preferred file organization)
- Brand context (PEACE framework, StoryBrand methodology, Sophia's voice for MyMoneyCoach)

**Read-only to agent tools.** Updated only by human via `zora memory edit`. This prevents prompt injection from poisoning long-term identity.

#### Tier 2: Daily Notes (`daily/YYYY-MM-DD.md`)

Per-day markdown files. The agent writes observations during work sessions:
- Tasks completed and their outcomes
- Errors encountered and resolutions
- New tools or approaches discovered
- Project state summaries

The agent reads the last 7 days of notes for context. Older notes are available via memory search.

#### Tier 3: Structured Memory Items (`items/`)

Individual JSON files representing extracted facts with **salience scoring**:

```json
{
  "id": "mem_abc123",
  "type": "knowledge",
  "summary": "The my-web-app project uses Next.js 14 with App Router and Tailwind CSS",
  "source": "session_xyz789",
  "source_type": "agent_analysis",
  "created_at": "2026-02-11T10:30:00Z",
  "last_accessed": "2026-02-11T14:00:00Z",
  "access_count": 3,
  "reinforcement_score": 0.85,
  "tags": ["my-web-app", "nextjs", "frontend"],
  "category": "coding/my-web-app"
}
```

**Memory item types** (from memU's six-type taxonomy):
- `profile` — Facts about the user (preferences, identity, contacts)
- `event` — Things that happened (task completions, errors, decisions)
- `knowledge` — Facts about the world or projects (tech stacks, APIs, conventions)
- `behavior` — Learned patterns (how the user likes things done)
- `skill` — Procedures the agent has learned (workflow steps, tool combinations)
- `tool` — Tool-specific metadata (success rates, common parameters, performance notes)

**Source tagging:** Every memory item records `source_type`:
- `user_instruction` — Directly from something the user said (highest trust)
- `agent_analysis` — Inferred by the agent from its own work (medium trust)
- `tool_output` — Extracted from web fetch, file contents, or other tool results (lowest trust)

Items sourced from `tool_output` are weighted lower in retrieval to prevent memory poisoning from adversarial web content.

#### Salience-Aware Retrieval

When building context for an LLM call, memory items are ranked by salience score:

```
salience = (access_count × reinforcement_weight)
         + recency_decay(last_accessed)
         + relevance_score(query, item)
         + source_trust_bonus(source_type)
```

Where:
- `reinforcement_weight` = 0.3 (items used more often are more salient)
- `recency_decay` = exponential decay with half-life of 7 days
- `relevance_score` = keyword/tag match score against current task (0-1)
- `source_trust_bonus` = user_instruction: 0.2, agent_analysis: 0.1, tool_output: 0.0

This means: frequently-referenced items (like PEACE soundbites) automatically rank higher than rarely-used items. Recent items rank higher than stale ones. User-provided facts outrank tool-extracted facts.

#### Category Auto-Organization

Memory items are automatically grouped into categories (e.g., `mymoneycoach/brand-messaging`, `coding/my-web-app`, `job-search/criteria`). Categories maintain a **summary document** that is regenerated periodically:

```json
{
  "category": "mymoneycoach/brand-messaging",
  "summary": "MyMoneyCoach.ai uses the StoryBrand framework with Sophia as the guide character. Core messaging follows the PEACE framework (Plan, Educate, Act, Coach, Empower). Content voice is warm, encouraging, abundance-focused. Text posts dramatically outperform photo content on Facebook.",
  "item_count": 23,
  "last_updated": "2026-02-11T10:00:00Z",
  "member_item_ids": ["mem_abc123", "mem_def456", ...]
}
```

#### Context Assembly Order

When building the system prompt for any LLM call:

```
1. Agent identity (SOUL.md)
2. Current date/time, OS info, working directory
3. Long-term memory (MEMORY.md) — always included
4. Last 7 days of daily notes — always included
5. CATEGORY SUMMARIES for relevant topics — token-efficient overview (memU dual-mode)
6. Top-N individual memory items by SALIENCE SCORE — deep detail for current task
7. Active job context (plan, progress, intermediate results)
8. Conversation history (last 50 messages or 30K tokens, whichever is less)
9. Tool definitions
```

Steps 5-6 implement memU's **dual-mode retrieval**: fast category-level overview (summaries) plus deep item-level detail (salience-ranked items). This is significantly more token-efficient than loading raw items, and ensures the most relevant context surfaces first.

#### Proactive Memory Extraction Pipeline

Inspired by memU's summaryPoller and Open Personal Agent's extraction pattern:

```
1. Trigger: Every 10+ messages in a conversation, or on job completion
2. Extraction call: Dedicated LLM call with schema-guided prompt
   - Input: last N messages + current memory categories
   - Output: structured memory items matching the six-type taxonomy
3. Schema validation: Extracted items must match the JSON schema
   - If invalid: re-prompt with validation error (memU correction loop)
   - Max 2 retries, then skip
4. Source tagging: Each item tagged with source_type based on origin
5. Category assignment: LLM assigns category or creates new one
6. Deduplication: Check for near-duplicate items (same summary, same tags)
7. Storage: Write validated items to items/{item-id}.json
8. Category update: If category summary is stale (>24h), regenerate
```

### 5.5 Security Architecture

Drawing from ClawSec's defense-in-depth, IronClaw's capability model, and the consolidated review findings.

#### Prompt Injection Defense

Three layers (inspired by IronClaw's safety module):

1. **Input Sanitizer** — Pattern-based detection on all external content (web fetch results, file contents, MCP tool outputs). Detected content is wrapped in `<untrusted_content>` tags so the LLM treats it as data, not instructions.

2. **Output Validator** — Scans LLM-generated tool calls for suspicious patterns:
   - Shell commands containing pipes to `curl`/`wget` (potential exfiltration)
   - File writes to critical paths (even if tool layer would block them)
   - Requests to read `.env`, credentials, or SSH keys
   - Commands that would modify SOUL.md, MEMORY.md, policy.toml, or config.toml

3. **Audit Logger** — Every tool invocation is logged to `audit.jsonl` with timestamp, tool name, parameters, result, and the LLM that requested it. Uses append-only writes through a serialized writer queue. **Logs are hash-chained** (inspired by ClawSec/IronClaw) — each entry includes the SHA-256 hash of the previous entry, making retroactive log modification detectable.

#### Secrets Management (IronClaw JIT Pattern)

- All secrets (API keys, tokens, credentials) stored in `secrets.enc`.
- Encrypted at rest with AES-256-GCM.
- Encryption key stored in macOS Keychain (via `keytar`).
- **Just-in-Time decryption** (IronClaw pattern): secrets are decrypted only for the duration of a single tool call, held in a local variable scoped to that call, then dereferenced. Never stored on class instances or global state.
- Secrets are **never passed directly to the LLM**. Tools read secrets at execution time. The LLM only sees `[SECRET:github_token]` placeholders.
- Leak detection: all LLM outputs are scanned for strings matching known secret patterns before being logged or displayed.

#### Integrity Guardian (Enhanced with ClawSec Pattern)

Critical files AND the tool registry have SHA-256 baselines stored in `state/integrity-baselines.json`:

**Protected files:**
- `SOUL.md` — Agent identity
- `MEMORY.md` — Long-term knowledge
- `policy.toml` — Capability policy
- `config.toml` — Configuration
- **Tool registry** — Hash of all registered tool definitions (ClawSec addition)

On agent startup and every heartbeat:
1. Compute current hashes
2. Compare against baselines
3. If mismatch detected:
   - Quarantine the modified version
   - Restore from baseline
   - Log the incident to audit trail
   - Notify the user
   - If tool registry was modified: **halt all tool execution** until human reviews

#### WASM Sandboxing Roadmap (IronClaw Pattern)

IronClaw (NEAR AI) demonstrates the gold standard for agent tool security: each tool executes inside a **WebAssembly sandbox** with explicit capability grants. This provides true memory isolation — a compromised tool cannot read another tool's memory, modify global state, or access resources beyond its declared capabilities. The WASM capability model enforces these boundaries at the VM level, not just the application level.

Zora v1 uses a **policy-file-based approximation** of this model:
- The capability policy (§5.3) restricts what tools can access
- Worker scoping narrows permissions per job
- Critical file protection prevents identity/policy modification

For v2, the hardening path includes:
- **WASM-sandboxed tool execution** for high-risk tools (shell_exec, web_fetch) using Wasmtime or Wasmer
- **Capability tokens as WASM imports** — the sandbox only receives the resources declared in the worker's capability token
- **Tool output validation in WASM** — output sanitization runs inside the sandbox boundary, before results reach the LLM
- This would eliminate entire classes of attacks where tool outputs contain instructions that manipulate subsequent tool calls

The v1 → v2 migration path is clean: the `WorkerCapabilityToken` interface (§5.3) already models the capability grants that WASM sandboxes would enforce. Swapping the policy-check implementation for actual WASM isolation requires no interface changes.

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

#### Bridge Watchdog

The Gemini Bridge is a critical child process. The main Zora daemon monitors it with a watchdog:
- Bridge writes heartbeat to `state/bridge-health.json` every 30 seconds
- If heartbeat is stale by >90 seconds, daemon restarts the bridge with backoff
- macOS notification sent on bridge crash/restart
- Bridge crash does not affect Claude-only operations

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

#### Dashboard Authentication

The dashboard at `localhost:7070` requires a bearer token for API access:
- Token stored in macOS Keychain
- CLI passes it automatically
- Web UI requires it on first access (one-time entry, stored in browser session)
- Prevents local subprocesses (npm scripts, docker containers) from steering the agent

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

# Check status (includes auth health)
zora status
# Output:
#   Agent: running (pid 12345)
#   Claude: healthy (auth: valid, expires ~14h, quota: ~2000 remaining)
#   Gemini: healthy (auth: valid, auto-refresh active)
#   Local: disabled
#   Active jobs: 2
#   Pending retries: 0
#   Routines: 3 active, next trigger in 2h15m

# Manage config (human-only protected files)
zora config edit              # Opens config.toml in $EDITOR
zora policy edit              # Opens policy.toml in $EDITOR
zora memory edit              # Opens MEMORY.md in $EDITOR
zora soul edit                # Opens SOUL.md in $EDITOR

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
zora memory categories          # List all categories with item counts

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
| **Local LLM (future)** | Ollama HTTP API | Standard interface, runs any GGUF model |
| **Process management** | Node.js with `tsx` | Direct TS execution, no build step for dev |
| **CLI framework** | `commander` or `citty` | Lightweight, well-maintained |
| **Configuration** | TOML (`@iarna/toml`) | Human-readable, supports comments (unlike JSON) |
| **Session storage** | JSONL files | Simple, appendable, human-readable (from Nanobot) |
| **Memory search** | In-process salience-scored index | V1 simplicity; V2 adds vector search with SQLite + embeddings |
| **Secrets encryption** | `node:crypto` (AES-256-GCM) | Native Node.js, no external dependencies |
| **Keychain access** | `keytar` | macOS Keychain integration for master key + dashboard token |
| **Notifications** | `node-notifier` or `osascript` | macOS native notifications |
| **Scheduling** | `node-cron` + custom heartbeat | Lightweight, in-process |
| **MCP client** | `@modelcontextprotocol/sdk` | Official MCP SDK for tool extension |
| **Process runner** | `execa` | Reliable subprocess management for Gemini CLI |
| **WASM sandbox (v2)** | Wasmtime via `@aspect-build/wasmtime` | IronClaw-style tool isolation for high-risk tools |

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

[agent.resources]
cpu_throttle_percent = 80             # Pause workers if sustained CPU > this (Grok review)
memory_limit_mb = 4096                # Soft memory limit for agent process
throttle_check_interval = "10s"

# ─── Provider Registry ───────────────────────────────────────────
# Providers are an ordered array. Add as many as you want.
# The router uses rank + capabilities + cost_tier to select providers.
# Remove or set enabled=false for providers you don't use.

[[providers]]
name = "claude"
type = "claude-sdk"                   # Integration type: claude-sdk | gemini-cli | openai-api | ollama
rank = 1                              # Your preference order (1 = top choice)
capabilities = ["reasoning", "coding", "creative"]
cost_tier = "included"                # free | included | metered | premium
enabled = true
auth_method = "mac_session"           # Uses existing Claude Desktop/CLI session token
model = "claude-sonnet-4-5"           # Default model; can override per-task
max_turns = 200
max_concurrent_jobs = 3
extended_thinking = true
thinking_budget = 10000               # Max thinking tokens per turn
auth_check_interval = "30m"
pre_expiry_warning = "2h"
cooldown_base = "5s"
cooldown_max = "30m"
cooldown_multiplier = 2.0

[[providers]]
name = "gemini"
type = "gemini-cli"
rank = 2
capabilities = ["search", "structured-data", "large-context", "coding"]
cost_tier = "included"                # Workspace quota, no API billing
enabled = true
auth_method = "workspace_sso"         # Uses existing gcloud/Workspace session
cli_path = "gemini"                   # Path to Gemini CLI binary
model = "gemini-2.5-pro"
max_turns = 100
max_concurrent_jobs = 2
auth_check_interval = "30m"
cooldown_base = "10s"
cooldown_max = "1h"
cooldown_multiplier = 2.0

[[providers]]
name = "openai"
type = "openai-api"
rank = 3
capabilities = ["reasoning", "coding", "creative"]
cost_tier = "metered"                 # Per-token API billing
enabled = false                       # Enable when API key is set
auth_method = "api_key"               # Reads OPENAI_API_KEY from secrets.enc
model = "gpt-4.1"
max_turns = 150
max_concurrent_jobs = 2
auth_check_interval = "1h"

[[providers]]
name = "codex"
type = "openai-api"
rank = 4
capabilities = ["coding", "fast"]
cost_tier = "metered"
enabled = false
auth_method = "api_key"               # Shares OPENAI_API_KEY with openai provider
model = "codex-mini-latest"
max_turns = 50
max_concurrent_jobs = 3

[[providers]]
name = "local"
type = "ollama"
rank = 99                             # Last resort
capabilities = ["structured-data"]
cost_tier = "free"
enabled = false                       # Flip when hardware is ready
auth_method = "none"
endpoint = "http://localhost:11434"
model = "qwen2.5-coder:32b"
max_concurrent_jobs = 2

# ─── Routing ─────────────────────────────────────────────────────

[routing]
mode = "respect_ranking"              # respect_ranking | optimize_cost | provider_only | round_robin
# provider_only_name = "claude"       # Only used with mode = "provider_only"

# Capability-to-task overrides (optional — sane defaults built in)
# [routing.task_overrides]
# "deep-reasoning" = "reasoning"      # Task classification → required capability
# "creative" = "creative"
# "structured-execution" = "structured-data"

# ─── Failover ────────────────────────────────────────────────────

[failover]
enabled = true
auto_handoff = true
max_handoff_context_tokens = 50000
retry_after_cooldown = true
max_retries = 3
checkpoint_on_auth_failure = true
notify_on_failover = true

# ─── Memory ──────────────────────────────────────────────────────

[memory]
long_term_file = "~/.zora/memory/MEMORY.md"
daily_notes_dir = "~/.zora/memory/daily"
items_dir = "~/.zora/memory/items"
categories_dir = "~/.zora/memory/categories"
context_days = 7                      # Include this many days of notes
max_context_items = 20                # Max memory items per query
max_category_summaries = 5            # Max category summaries in context
auto_extract_interval = 10            # Extract memories every N messages
extraction_max_retries = 2
salience_reinforcement_weight = 0.3
salience_recency_halflife_days = 7
source_trust_bonus_user = 0.2
source_trust_bonus_agent = 0.1
source_trust_bonus_tool = 0.0

# ─── Security ────────────────────────────────────────────────────

[security]
policy_file = "~/.zora/policy.toml"
audit_log = "~/.zora/audit/audit.jsonl"
audit_hash_chain = true
audit_single_writer = true
integrity_check = true
integrity_interval = "30m"
integrity_includes_tool_registry = true
leak_detection = true
sanitize_untrusted_content = true
jit_secret_decryption = true
dashboard_auth = true

# ─── Steering ────────────────────────────────────────────────────

[steering]
enabled = true
poll_interval = "5s"                  # How often agents check for steer messages
dashboard_port = 7070                 # Local web dashboard
notify_on_flag = true                 # macOS notification on flagged decisions
flag_timeout = "10m"                  # After this, default action is finalized
auto_approve_low_risk = true          # Don't flag reversible, low-impact decisions
always_flag_irreversible = true       # Git pushes, file deletes, external API calls (Grok review)

# ─── Notifications ───────────────────────────────────────────────

[notifications]
enabled = true
on_task_complete = true
on_error = true
on_failover = true
on_auth_expiry = true
on_all_providers_down = true          # Critical alert when no providers are healthy
on_long_running_threshold = "30m"
sound = true
```

---

## 8. Design Decisions & Trade-offs

### Decision 1: Pre-authorized execution vs. per-action approval

**Chosen:** Pre-authorized via capability policy with error feedback to LLM.
**Alternative:** Per-action approval (OpenClaw/IronClaw style).
**Rationale:** The entire point of this agent is to get shit done without interrupting you. Per-action approval defeats the purpose. The capability policy provides the safety boundary. Policy violations are fed back to the LLM as structured errors (Nanobot pattern) — the LLM self-corrects without human intervention.
**Risk mitigation:** Comprehensive hash-chained audit logging, integrity guardian covering tool registry, and the ability to review the audit trail after the fact.

### Decision 2: Claude Code Agent SDK (embedded) vs. Claude API (direct)

**Chosen:** Agent SDK with Mac session token.
**Alternative:** Direct Anthropic API with API key.
**Rationale:** The Agent SDK provides the full agentic loop (tool calling, multi-turn, streaming) as a native capability. Using the Mac session token means no API billing — the agent uses the same quota as your Claude subscription. This is a massive cost advantage for long-running tasks.
**Trade-off:** Tied to Claude's Mac app/CLI authentication. If the session expires, the agent needs to re-authenticate (but this is handled gracefully with auth degradation — see Decision 9).

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

### Decision 6: memU-inspired memory vs. simple flat storage

**Chosen:** Three-tier hierarchical memory with salience-aware retrieval.
**Alternative:** Simple key-value store or flat markdown files.
**Rationale:** For a long-running agent doing recurring workflows (content pipeline, job search), memory quality directly impacts output quality. The salience scoring ensures frequently-used context (brand guidelines, PEACE soundbites) surfaces automatically without manual curation. Category summaries provide token-efficient context loading. Source tagging prevents memory poisoning.
**Trade-off:** More complex than flat files. But memU proved this hierarchy works in production, and the Zora implementation is simplified (filesystem, not PostgreSQL).

### Decision 7: Critical files read-only to agent tools

**Chosen:** SOUL.md, MEMORY.md, policy.toml, config.toml are read-only to the tool layer.
**Alternative:** Agent can modify all files (with audit logging).
**Rationale:** The consolidated review identified a prompt injection attack vector: adversarial web content could instruct the agent to modify its own identity or permissions via tool calls. Making these files read-only at the tool layer eliminates this vector entirely. Memory updates go to daily notes and items (which are lower-trust); identity and policy changes require human action via CLI.
**Trade-off:** The agent can't update MEMORY.md directly. But MEMORY.md should reflect human-curated long-term knowledge, not transient agent observations — that's what daily notes and memory items are for.

### Decision 8: Error feedback to LLM vs. human escalation for policy violations

**Chosen:** Structured error returned to LLM (Nanobot pattern).
**Alternative:** Block and ask human (OpenClaw HITL pattern).
**Rationale:** Blocking defeats autonomous operation. The Nanobot codebase proved that LLMs self-correct effectively when given clear error messages about what went wrong and what's allowed. The human sees violations in the audit log, not as blocking dialogs.

### Decision 9: Auth degradation with Gemini promotion

**Chosen:** When Claude auth expires, Gemini is promoted to primary for all task types.
**Alternative:** Queue all tasks until Claude is restored.
**Rationale:** Queueing defeats the "works while you sleep" promise. Gemini is capable enough for most tasks, even if not optimal for deep reasoning. Quality degradation warning + continued operation is better than full stop. This also de-risks the "I'm remote and can't re-auth" scenario.

### Decision 10: Three-tier provider architecture (future-ready)

**Chosen:** Claude (primary) + Gemini (secondary) + Local (stubbed).
**Alternative:** Two providers only.
**Rationale:** Local models on Mac hardware are good enough for heartbeat tasks, memory extraction, and structured summarization. Adding a local tier eliminates the "both cloud providers are down/expired" failure mode entirely. Stubbing it now means the architecture supports it without refactoring when the M1 Mini is set up.

### Decision 11: Policy-based tool isolation (v1) vs. WASM sandboxing (v2)

**Chosen (v1):** TOML capability policy with enforcement at the application layer.
**Alternative:** IronClaw-style WASM sandboxing with per-tool memory isolation.
**Rationale:** WASM sandboxing is the objectively superior security model — IronClaw's use of WebAssembly provides true memory isolation, capability-based resource access, and hardware-enforced boundaries that application-layer policy checks cannot match. However, the WASM toolchain for Node.js is still maturing, and the integration cost for v1 would delay shipping by weeks. The capability policy provides "good enough" isolation for a single-user, single-machine agent where the threat model is primarily prompt injection, not adversarial tool code.
**Trade-off:** v1 tool isolation is enforced by the orchestrator process, not by the OS/runtime. A bug in the tool execution layer could bypass policy checks. WASM would eliminate this class of bugs.
**Migration path:** The `WorkerCapabilityToken` interface already models WASM-style capability grants. v2 wraps high-risk tools (shell_exec, web_fetch) in Wasmtime sandboxes, mapping token fields to WASM imports. No interface changes required.

---

## 9. Implementation Plan

See `IMPLEMENTATION_PLAN.md` for the WSJF-prioritized build plan with 46 work items across 4 tiers, realistic calendar, and risk register.

---

## 10. Open Questions

1. **Claude session token lifecycle** — How long do Mac session tokens last? Do they auto-renew? Need empirical testing during Phase 1.

2. **Gemini CLI structured output** — Which CLI versions support `--output-format json`? Need version detection and fallback parsing strategy.

3. **Gemini CLI Workspace quota details** — What are the actual rate limits for Workspace-authenticated Gemini CLI usage? Need to benchmark during Phase 2.

4. **Memory vector search** — V1 uses salience-scored keyword search. When should we upgrade to vector embeddings? After how much accumulated memory does keyword search become insufficient?

5. **Team coordination latency** — Is 5-second poll interval fast enough for tight collaboration? Don't use `fs.watch` on macOS (unreliable under load). Consider Unix domain sockets for v2 if sub-second delivery is needed.

6. **Gemini bridge reliability** — The Gemini bridge translates between mailbox protocol and CLI stdin/stdout. What happens when Gemini CLI hangs or produces malformed output? The bridge watchdog (§5.7) handles restart, but need robust timeout + retry logic within the bridge process itself.

7. **Steering conflict resolution** — If Rich steers mid-task and the agent has already taken an irreversible action (e.g., pushed a git commit), what's the reconciliation strategy? Defined as "always flag irreversible actions" in policy but edge cases remain.

8. **Dashboard technology** — TUI (`blessed`/`ink`) vs. local web UI (`localhost:7070`) vs. both? Web UI is more flexible but adds a dependency. TUI is immediate but limited. Current plan: both, with web UI as primary.

9. **WASM sandbox maturity** — When is the Wasmtime Node.js binding stable enough for production tool sandboxing? Need to track `@aspect-build/wasmtime` or `@aspect-build/rules_js` for v2 planning.

---

## 11. Success Criteria

The spec is implemented successfully when:

1. **Autonomous execution** — Agent completes a 10-step task (research → code → test → document) without human intervention.
2. **Failover works** — When Claude quota is artificially exhausted, the agent seamlessly continues on Gemini and produces equivalent-quality output.
3. **Auth degradation works** — When Claude auth is revoked, agent promotes Gemini, continues working, and resumes Claude jobs when auth is restored.
4. **24-hour uptime** — Agent runs for 24 hours handling heartbeat tasks and user requests without crashes or memory leaks.
5. **No permission dialogs** — Zero permission prompts during a full workday of typical use.
6. **Memory persistence with salience** — Agent remembers a preference stated 3 days ago and applies it without being reminded. High-salience items surface before low-salience ones.
7. **Security baseline** — Prompt injection test suite (10 common patterns) blocked. Secrets never appear in logs or LLM output. Critical files cannot be modified by agent tools.
8. **Sub-60-second failover** — Time from quota error to Gemini taking over is under 60 seconds.
9. **Real workflow output** — Agent produces a complete MyMoneyCoach weekly content package (blog + 5 social posts) without human intervention.
10. **Job search produces matches** — Daily routine identifies new job listings and generates tailored cover letters.
11. **Cross-agent parallel performance** — Two agents (Claude + Gemini) complete a parallelizable task in less than 60% of the time a single agent would take.
12. **Async steering responsiveness** — Rich injects a steer message mid-task, agent adjusts course within 10 seconds, no work is lost or blocked.
13. **Flags don't block** — Agent flags 3+ uncertain decisions during a complex task, proceeds with defaults for all of them, Rich reviews after completion.

---

## Appendix A: Inspirations & Attributions

| Project | Key Ideas Adopted |
|---------|-------------------|
| **Nanobot** (HKUDS) | Event-driven message bus, provider registry pattern, heartbeat system, JSONL sessions, **error-feedback-to-LLM pattern for policy violations** |
| **OpenClaw** | Auth profile rotation with cooldown, hooks system, multi-channel architecture (adapted as multi-model), Keychain credential storage via keytar |
| **IronClaw** (NEAR AI) | **WASM capability-based security model** (adapted as capability policy in v1, WASM sandboxing planned for v2), prompt injection defense (sanitizer + validator + policy), **JIT secret decryption pattern**, hash-chained audit logs, hybrid memory search (RRF), self-repair for stuck jobs |
| **Open Personal Agent** (NevaMind) | Claude Code Agent SDK integration patterns, task pool management, SSE streaming, agentic tool loop with max iterations, memory summarization polling |
| **memU** (NevaMind) | **Three-tier memory hierarchy**, six memory types taxonomy, **proactive memory extraction with correction loop**, **salience-aware retrieval (reinforcement + recency decay)**, **category auto-organization with summaries**, dual-mode retrieval (category summaries + individual items) |
| **ClawSec** (Prompt Security) | Hash-chained audit logs, **integrity guardian covering tool registry** (Soul Guardian pattern), advisory feed concept, SHA-256 baseline integrity checking, quarantine-and-restore pattern |
| **Claude Code Agent Teams** (Anthropic) | Filesystem mailbox pattern for inter-agent communication, team configuration structure, control message protocol, message injection for human steering |
| **Gemini Team Integration** | Bridge pattern for Gemini as team member, inbox polling workflow, async cross-model collaboration via filesystem mailboxes |

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Handoff Bundle** | Serialized execution context passed from one LLM provider to another during failover, including natural language briefing note |
| **Capability Policy** | Declarative TOML file defining what the agent is allowed to do |
| **Worker Capability Token** | Scoped subset of the global policy issued to a specific worker/job |
| **WASM Sandbox** | WebAssembly-based tool isolation providing memory-safe, capability-controlled execution (v2) |
| **Salience Score** | Composite ranking used to prioritize memory items in context assembly |
| **Category Summary** | Token-efficient overview of a memory category, regenerated periodically |
| **Source Tagging** | Recording whether a memory item came from user instruction, agent analysis, or tool output |
| **JIT Secret Decryption** | Decrypting secrets only for the duration of a single tool call, then dereferencing |
| **Error Feedback** | Returning policy violation details to the LLM as a tool result so it self-corrects |
| **Auth Degradation** | Promoting a secondary provider to handle all task types when the primary's auth expires |
| **Heartbeat** | Periodic agent wake-up to check provider health, file integrity, and proactive tasks |
| **Routine** | A scheduled or event-triggered task definition |
| **Memory Item** | A single extracted fact with salience scoring, stored as a JSON file |
| **Provider Health Score** | 0-1 metric based on recent success rate + auth status |
| **Integrity Baseline** | SHA-256 hashes of critical files + tool registry, checked periodically |
| **Mailbox** | A JSON file in `~/.zora/teams/{team}/inboxes/` that acts as an async message queue for one agent |
| **Gemini Bridge** | Background process that translates between filesystem mailbox protocol and Gemini CLI stdin/stdout |
| **Bridge Watchdog** | Daemon monitor that restarts the Gemini Bridge process on crash |
| **Coordinator** | The lead agent in a team, responsible for task decomposition, agent assignment, and result synthesis |
| **Team** | A group of Claude and/or Gemini agents collaborating on a task via filesystem mailboxes |
| **Flag** | A decision the agent is uncertain about — proceeds with default, notifies human |
| **Steer Message** | Human-injected directive that redirects a running agent without blocking |

---

*End of Specification*
