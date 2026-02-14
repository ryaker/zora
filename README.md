![Zora Header](specs/v5/assets/zora_lcars_header.png)

# Zora

**An autonomous AI agent that runs on your computer and gets work done.** Give it a task in plain English, and it uses Claude and Gemini to execute multi-step workflows while you focus on other things.

---

![Divider](specs/v5/assets/lcars_divider.svg)

## Install

```bash
npm i -g zora
zora init
zora ask "summarize files in ~/Projects"
```

That's it. Three commands from zero to productive.

---

![Divider](specs/v5/assets/lcars_divider.svg)

## What It Can Do

🚀 **Multi-Model with Automatic Failover** — Claude (Opus/Sonnet/Haiku), Gemini, and Ollama (local models). Pick the right model per task — Opus for hard problems, Haiku for cheap content, Ollama for zero-cost local work. Use `--max-cost-tier` to cap routing by cost budget. Failover is automatic.

🛡️ **Policy-Enforced Autonomy** — Work freely within boundaries you define. The security engine enforces strict allow/deny rules for filesystem, shell, and network with action budgets, dry-run preview mode, and intent verification. [OWASP LLM Top 10 and Agentic Top 10 hardened](SECURITY.md).

🧠 **Hierarchical Memory** — Zora remembers your preferences, past work, and project context across sessions. Long-term memory + daily rolling notes.

🕹️ **Web Dashboard** — A local web interface for monitoring tasks, viewing provider status and quota usage, and injecting course-corrections into running workflows. Live metrics via SSE, auto-opens on `zora start`.

⏰ **Scheduled Routines** — Define recurring tasks in TOML that run automatically — daily reports, weekly cleanups, nightly code reviews. Supports `model_preference` and `max_cost_tier` per routine. Trigger manually with `RoutineManager.runRoutine()`.

🔄 **Persistent Retry Queue** — Failed tasks are persisted to disk and retried with intelligent backoff. Resilient to transient errors.

### Real Examples

- **File organization** — `zora ask "Sort ~/Downloads by project and archive older than 30 days"`
- **Code review** — `zora ask "Check all PRs in my repos and comment on style issues"`
- **Email drafting** — `zora ask "Draft replies to unread emails about the product launch"`
- **Git management** — `zora ask "Create feature branches from all open issues labeled 'sprint-12'"`
- **Web research** — `zora ask "Find and summarize the latest React 19 migration guides"`
- **Multi-step workflows** — `zora ask "Find all TODOs in my project, create a summary, and open a GitHub issue with it."`

---

![Divider](specs/v5/assets/lcars_divider.svg)

## How Security Works

Zora operates within strict boundaries you define. A policy file (`~/.zora/policy.toml`) specifies allowed filesystem paths, shell commands, and network access. The agent self-corrects when it hits policy limits — no data leaves your machine except API calls to Claude/Gemini. Every action is logged to a tamper-proof audit trail.

**Security Hardening** — Audited against OWASP LLM Top 10 (2025) and OWASP Agentic Top 10 (ASI-2026):

| Defense | What It Does |
|---------|-------------|
| **Action Budgets** | Per-session limits on tool invocations and token spend prevent unbounded loops |
| **Dry-Run Mode** | Preview write operations without executing — test policies safely |
| **Intent Capsules** | HMAC-SHA256 signed mandates detect goal hijacking from injected instructions |
| **RAG Injection Defense** | 20+ patterns detect prompt injection in tool outputs and RAG documents |
| **Hash-Chain Audit** | SHA-256 chained append-only log with tamper detection |
| **AES-256-GCM Secrets** | Encrypted credential storage with PBKDF2 key derivation |

See **[SECURITY.md](SECURITY.md)** for the full security guide and OWASP compliance matrix.

---

![Divider](specs/v5/assets/lcars_divider.svg)

## Architecture

```
┌─────────────────────────────────────────────────┐
│                ORCHESTRATOR CORE                │
│  Router → Execution Loop → Failover Controller  │
│         Retry Queue  │  Session Manager         │
├─────────────────────────────────────────────────┤
│             LLM PROVIDER REGISTRY               │
│  Claude Opus/Sonnet/Haiku  │  Gemini  │  Ollama │
│  Agent SDK (Native)   CLI (Sub)   REST (Local)  │
├─────────────────────────────────────────────────┤
│  Tools      │  Memory         │  Security       │
│  Shell      │  MEMORY.md      │  Policy Engine  │
│  Filesystem │  Daily Notes    │  Audit Log      │
│  Web        │  Context Loader │  Restrictive FS │
└─────────────────────────────────────────────────┘
```

---

![Divider](specs/v5/assets/lcars_divider.svg)

## Project Status

Zora is in active development (v0.9.0). This table reflects what actually works today.

| Component | Status |
|-----------|--------|
| Multi-model orchestration (Claude Opus/Sonnet/Haiku + Gemini + Ollama) | ✅ Working |
| Automatic failover on quota/auth errors | ✅ Working |
| Policy-based security engine (path + command enforcement) | ✅ Working |
| Action budgets (per-session + per-type limits) | ✅ Working |
| Dry-run preview mode (test without executing) | ✅ Working |
| Intent capsules (HMAC-SHA256 goal drift detection) | ✅ Working |
| RAG/tool-output injection defense (20+ patterns) | ✅ Working |
| Policy-aware agent (checks permissions before acting) | ✅ Working |
| SOUL.md personality loading | ✅ Working |
| Hierarchical memory (long-term + daily notes) | ✅ Working |
| Scheduled routines via cron | ✅ Working |
| Web dashboard with live SSE feed, task submission, and onboarding | ✅ Working |
| Provider quota/usage tracking in dashboard | ✅ Working |
| Cost-aware routing via `--max-cost-tier` | ✅ Working |
| Manual routine execution (`runRoutine()`) | ✅ Working |
| Persistent retry queue with backoff | ✅ Working |
| Docker containerization for integration testing | ✅ Working |
| Interactive approval for flagged actions (`always_flag`) | 🚧 Config parsed, enforcement in progress |
| Runtime permission expansion (grant access mid-task) | 🚧 Planned |
| Cross-platform support (macOS, Linux, Windows) | 🚧 macOS tested, others in progress |

---

![Divider](specs/v5/assets/lcars_divider.svg)

## Dashboard

After starting Zora, the dashboard auto-opens at `http://localhost:7070`. Submit tasks, monitor live progress via SSE, view provider quota/usage, and send course-corrections to running jobs. First-time users see a guided onboarding screen with quick-start examples.

New to Zora? Use our **[AI Setup Assistant](docs/AI_SETUP_ASSISTANT.md)** — paste the prompt into any AI chatbot (ChatGPT, Claude, Gemini) for a guided walkthrough of installation and configuration.

---

![Divider](specs/v5/assets/lcars_divider.svg)

## Documentation

| Document | Description |
|----------|-------------|
| **[QUICKSTART.md](QUICKSTART.md)** | Get up and running in 5 minutes |
| **[USE_CASES.md](USE_CASES.md)** | Real-world examples and workflow patterns |
| **[SECURITY.md](SECURITY.md)** | Policy configuration and audit logging |
| **[ROUTINES_COOKBOOK.md](ROUTINES_COOKBOOK.md)** | Recipes for scheduled tasks |
| **[SETUP_GUIDE.md](SETUP_GUIDE.md)** | Detailed installation and configuration |
| **[docs/BEGINNERS_GUIDE.md](docs/BEGINNERS_GUIDE.md)** | In-depth usage guide |
| **[docs/AI_SETUP_ASSISTANT.md](docs/AI_SETUP_ASSISTANT.md)** | Interactive AI-guided setup |

## Contributing

Contributions are welcome. Open an issue to discuss features or bugs before submitting a PR.

## License

MIT License - see [LICENSE](LICENSE) for details.

---

*Local first. Works for you.*
