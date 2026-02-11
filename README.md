text

# Zora

**A long-running, autonomous AI agent for macOS.**

Zora gets shit done. It executes complex, multi-step tasks without constant permission prompts, using Claude as its primary brain and Gemini as a secondary/failover engine. No chatbot UI. No cloud transcripts. Just a local agent that works for you like a tireless, trusted employee.

---

## What Makes Zora Different

| Feature | Zora | OpenClaw | Nanobot |
|---------|------|----------|---------|
| **Purpose** | Local task automation | Multi-channel assistant | Lightweight agent |
| **LLM architecture** | Dual-LLM with mid-task failover | Single provider | Single provider |
| **Permission model** | Pre-authorized (no approval prompts) | Human-in-the-loop blocking | Workspace sandbox |
| **Memory** | Salience-scored 3-tier hierarchy | SQLite | Basic markdown |
| **Auth degradation** | Auto-promotes secondary provider | Fails | Fails |
| **Human interaction** | Async steering (never blocks) | Approval dialogs (blocks) | None |
| **Designed for** | Recurring workflows, content pipelines | Chat conversations | Single tasks |

## Core Features

**Dual-LLM with Automatic Failover** — Claude handles complex reasoning and creative work. Gemini handles structured tasks and large-context processing. When Claude hits quota limits or auth expires, Gemini takes over mid-task with full context handoff. Work never stops.

**Pre-Authorized Execution** — Set your capability policy once. The agent works within those boundaries freely. No "Do you want to allow this?" dialogs. Policy violations are fed back to the LLM as errors — it self-corrects without bothering you.

**Async Steering (Never Blocks)** — Observe and redirect running tasks at any time. The agent flags uncertain decisions but proceeds with its best judgment. Your input is advisory, not mandatory. Work is never stuck waiting for you.

**Salience-Scored Memory** — Three-tier memory system inspired by [memU](https://github.com/NevaMind-AI/memU). Frequently-used context (brand guidelines, project conventions) automatically surfaces higher. Source tagging prevents memory poisoning from untrusted content.

**Scheduled Routines** — Content pipelines, job searches, repo cleanup, daily standup summaries — define them once in TOML, they run on schedule with the right model for the job.

**Auth Degradation Handling** — When Claude's Mac session token expires and you're not home to re-authenticate, the agent notifies you, checkpoints active work, and continues on Gemini. When you re-auth, Claude jobs resume.

## Quick Start

```bash
# Install
git clone https://github.com/ryaker/zora.git
cd zora && pnpm install

# Configure (creates ~/.zora/ with defaults)
pnpm zora init

# Review and customize your capability policy
$EDITOR ~/.zora/policy.toml

# Start the agent daemon
pnpm zora start

# Give it work
pnpm zora ask "Research the top 5 headless CMS platforms and write a comparison doc"

# Check status
pnpm zora status

# Set up a recurring routine
pnpm zora routine create --file examples/routines/content-pipeline.toml
```

See [docs/QUICK_START.md](docs/QUICK_START.md) for the full setup guide.

## Architecture

```
┌───────────────────────────────────────────────┐
│              ORCHESTRATOR CORE                │
│  Router → Scheduler → Failover Controller     │
│              Execution Loop                   │
├───────────────────────────────────────────────┤
│           LLM PROVIDER LAYER                  │
│  Claude (Primary)  │  Gemini (Secondary)      │
│  Agent SDK + Mac   │  CLI + Workspace SSO     │
│  session token     │  auto-refresh tokens     │
├───────────────────────────────────────────────┤
│  Tools    │  Memory (memU)  │  Security       │
│  Shell    │  3-tier + sal.  │  Policy engine  │
│  Files    │  Categories     │  Integrity guard│
│  Web      │  Extraction     │  Audit (hashed) │
│  MCP      │  Salience rank  │  JIT secrets    │
└───────────────────────────────────────────────┘
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system design with diagrams.

## Documentation

| Document | Description |
|----------|-------------|
| [ZORA_AGENT_SPEC.md](ZORA_AGENT_SPEC.md) | Full technical specification (start here for deep understanding) |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | WSJF-prioritized build plan with realistic time estimates |
| [docs/QUICK_START.md](docs/QUICK_START.md) | 5-minute setup guide |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture with M