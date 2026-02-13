# Zora

An autonomous AI agent that runs on your computer and gets work done. Give it a task in plain English, and it uses Claude and Gemini to execute multi-step workflows while you focus on other things.

## Install

```bash
npm i -g zora
zora init
zora ask "summarize files in ~/Projects"
```

## What It Can Do

- **File organization** — "Sort ~/Downloads by project and archive older than 30 days"
- **Code review** — "Check all PRs in my repos and comment on style issues"
- **Email drafting** — "Draft replies to unread emails about the product launch"
- **Git management** — "Create feature branches from all open issues labeled 'sprint-12'"
- **Scheduled routines** — Define recurring tasks that run automatically (daily reports, backups, cleanup)
- **Web research** — "Find and summarize the latest React 19 migration guides"
- **Multi-step workflows** — Chain together file operations, API calls, and decision-making without manual intervention

## How Security Works

Zora operates within strict boundaries you define. A policy file (`~/.zora/policy.toml`) specifies allowed filesystem paths, shell commands, and network access. The agent self-corrects when it hits policy limits—no data leaves your machine except API calls to Claude/Gemini. Every action is logged to an audit trail for transparency.

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

## Project Status

Zora is in active development (v0.6.0). Core functionality is stable and tested—dual-LLM orchestration, failover, memory systems, policy enforcement, and the web dashboard all work. The project is being refined for broader use cases and smoother onboarding.

| Component | Status |
|-----------|--------|
| Dual-LLM orchestration (Claude + Gemini) | ✅ Working |
| Automatic failover on quota/auth errors | ✅ Working |
| Policy-based security engine | ✅ Working |
| Hierarchical memory (long-term + daily notes) | ✅ Working |
| Scheduled routines via cron | ✅ Working |
| Web dashboard for monitoring and task injection | ✅ Working |
| Persistent retry queue with backoff | ✅ Working |
| Cross-platform support (macOS, Linux, Windows) | 🚧 macOS tested, others in progress |

## Documentation

- **[QUICKSTART.md](QUICKSTART.md)** — Get up and running in 5 minutes
- **[USE_CASES.md](USE_CASES.md)** — Real-world examples and workflow patterns
- **[SECURITY.md](SECURITY.md)** — Policy configuration and audit logging
- **[ROUTINES_COOKBOOK.md](ROUTINES_COOKBOOK.md)** — Recipes for scheduled tasks
- **[SETUP_GUIDE.md](SETUP_GUIDE.md)** — Detailed installation and configuration
- **[docs/BEGINNERS_GUIDE.md](docs/BEGINNERS_GUIDE.md)** — In-depth usage guide

## Contributing

Contributions are welcome. Open an issue to discuss features or bugs before submitting a PR.

## License

MIT License - see [LICENSE](LICENSE) for details.

---

*Local first. Works for you.*
