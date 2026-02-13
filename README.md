![Zora LCARS Header](specs/v5/assets/zora_lcars_header.png)

# Zora
**A long-running, autonomous AI agent for macOS.**

Zora gets shit done. It executes complex, multi-step tasks without constant permission prompts, using Claude as its primary brain and Gemini as a secondary/failover engine. No chatbot UI. No cloud transcripts. Just a local agent that works for you like a tireless, trusted employee.

---

![LCARS Divider](specs/v5/assets/lcars_divider.svg)

## Core Capabilities (Now Functional)

🚀 **Dual-LLM with Automatic Failover** — Fully integrated Claude SDK (Primary) and Gemini CLI (Secondary). When Claude hits quota limits or auth expires, the **Failover Controller** handles a full context handoff to Gemini mid-task. Work never stops.

🛡️ **Policy-Enforced Autonomy** — Work freely within secure boundaries. The **Security Policy Engine** enforces strict allow/deny rules for filesystem, shell, and network access. No constant approval prompts; the agent self-corrects based on policy feedback.

🧠 **Hierarchical Memory** — A two-tier memory system provides persistent context.
- **Tier 1 (Long-term):** `MEMORY.md` stores permanent goals and brand guidelines.
- **Tier 2 (Rolling):** Daily Notes provide a moving window of recent activities and outcomes.

🕹️ **Tactical Dashboard** — A retro-futuristic (LCARS-inspired) local web interface for monitoring and async steering.
- **Real-time Health:** Live provider link status.
- **Neural Steering:** Inject course-corrections into running tasks without interrupting the flow.
- **Browser-Verified:** Tested with Playwright for reliable local operation.

⏰ **Scheduled Routines & Heartbeat** — Define recurring tasks in TOML. The **Routine Manager** executes them via cron, while the **Heartbeat System** proactively pulses every 30 minutes to check for pending maintenance tasks in `HEARTBEAT.md`.

🔄 **Persistent Retry Queue** — High resilience to 429/transient errors. Failed tasks are persisted to disk and retried with a secure quadratic backoff strategy.

## Quick Start

```bash
# 1. Install Dependencies
git clone https://github.com/ryaker/zora.git
cd zora
npm install

# 2. Build the System
npm run build

# 3. Configure (requires ~/.zora/config.toml and policy.toml)
# Templates available in tests/fixtures/ for now. 
# Automatic 'init' command coming soon.

# 4. Run the Integrated Test Suite (Unit + Browser)
npm test

# 5. Start a Task
# This loads memory, checks auth, and routes the task to the best provider.
node dist/cli/index.js ask "Summarize my recent work from daily notes into MEMORY.md"

# 6. Monitor via Tactical Dashboard
# Starts at http://localhost:7070 (in a separate terminal)
# (Integration into 'zora start' daemon coming soon)
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                ORCHESTRATOR CORE                │
│  Router → Execution Loop → Failover Controller  │
│         Retry Queue  │  Session Manager         │
├─────────────────────────────────────────────────┤
│             LLM PROVIDER REGISTRY               │
│  Claude (Primary)    │    Gemini (Secondary)    │
│  Agent SDK (Native)  │    CLI (Subprocess)      │
├─────────────────────────────────────────────────┤
│  Tools      │  Memory         │  Security       │
│  Shell      │  MEMORY.md      │  Policy Engine  │
│  Filesystem │  Daily Notes    │  Audit Log      │
│  Web        │  Context Loader │  Restrictive FS │
└─────────────────────────────────────────────────┘
```

## Project Status: v0.5.0 (Tier 2 Complete)

| Milestone | Status | Description |
|-----------|--------|-------------|
| **Tier 1: Foundation** | ✅ | Scaffolding, CLI, Basic Tools, execution loop. |
| **Tier 2: Intelligence** | ✅ | Multi-provider, Routing, Failover, Memory, Routines. |
| **Tier 3: Interfaces** | 🚧 | Web Dashboard (Done), Telegram Gateway (Next), Hardening. |

## Documentation

| Document | Description |
|----------|-------------|
| [SETUP_GUIDE.md](SETUP_GUIDE.md) | **Beginner-friendly setup guide. Start here.** |
| [specs/v5/ZORA_AGENT_SPEC.md](specs/v5/ZORA_AGENT_SPEC.md) | Full technical specification. |
| [specs/v5/IMPLEMENTATION_PLAN.md](specs/v5/IMPLEMENTATION_PLAN.md) | WSJF-prioritized build plan. |
| [specs/v5/docs/ARCHITECTURE.md](specs/v5/docs/ARCHITECTURE.md) | System architecture overview. |
| [specs/v6/WEB_DASHBOARD_SPEC.md](specs/v6/WEB_DASHBOARD_SPEC.md) | Local UI and steering specification. |

---

*Build fast. Ship real output. Local first.*
