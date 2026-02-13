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

🚀 **Dual-LLM with Automatic Failover** — Claude as primary brain, Gemini as secondary. When one hits quota limits, work seamlessly continues on the other. Work never stops.

🛡️ **Policy-Enforced Autonomy** — Work freely within boundaries you define. The security engine enforces strict allow/deny rules for filesystem, shell, and network. No constant approval prompts.

🧠 **Hierarchical Memory** — Zora remembers your preferences, past work, and project context across sessions. Long-term memory + daily rolling notes.

🕹️ **Web Dashboard** — A local web interface for monitoring tasks, viewing provider status, and injecting course-corrections into running workflows.

⏰ **Scheduled Routines** — Define recurring tasks in TOML that run automatically — daily reports, weekly cleanups, nightly code reviews.

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
│  Claude (Primary)    │    Gemini (Secondary)    │
│  Agent SDK (Native)  │    CLI (Subprocess)      │
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

Zora is in active development (v0.6.0). This table reflects what actually works today.

| Component | Status |
|-----------|--------|
| Dual-LLM orchestration (Claude + Gemini) | ✅ Working |
| Automatic failover on quota/auth errors | ✅ Working |
| Policy-based security engine (path + command enforcement) | ✅ Working |
| Policy-aware agent (checks permissions before acting) | ✅ Working |
| SOUL.md personality loading | ✅ Working |
| Hierarchical memory (long-term + daily notes) | ✅ Working |
| Scheduled routines via cron | ✅ Working |
| Web dashboard for monitoring and task injection | ✅ Working |
| Persistent retry queue with backoff | ✅ Working |
| Interactive approval for flagged actions (`always_flag`) | 🚧 Config parsed, enforcement in progress |
| Runtime permission expansion (grant access mid-task) | 🚧 Planned |
| Cross-platform support (macOS, Linux, Windows) | 🚧 macOS tested, others in progress |

---

![Divider](specs/v5/assets/lcars_divider.svg)

## Documentation

| Document | Description |
|----------|-------------|
| **[QUICKSTART.md](QUICKSTART.md)** | Get up and running in 5 minutes |
| **[USE_CASES.md](USE_CASES.md)** | Real-world examples for developers, writers, and business owners |
| **[SECURITY.md](SECURITY.md)** | Plain-English security guide and policy configuration |
| **[ROUTINES_COOKBOOK.md](ROUTINES_COOKBOOK.md)** | Copy-paste recipes for scheduled tasks |
| **[SETUP_GUIDE.md](SETUP_GUIDE.md)** | Detailed installation and configuration |
| **[docs/BEGINNERS_GUIDE.md](docs/BEGINNERS_GUIDE.md)** | In-depth usage guide |

## Contributing

Contributions are welcome. Open an issue to discuss features or bugs before submitting a PR.

## License

MIT License - see [LICENSE](LICENSE) for details.

---

*Local first. Works for you.*
