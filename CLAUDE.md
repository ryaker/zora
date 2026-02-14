# Zora Agent Framework - Project Instructions

## What Is Zora

Zora is an AI agent framework. People install it, run it, chat with it in a browser, use it on CLI, setup Telegram, and get stuff done. It's not a toolkit for building agents - it's a tool people USE.

Competitors: OpenClaw, memU. We're more secure, security-first approach.

## Current State

**Health Score: 4/10.** Strong foundational components but critical orchestration gaps prevent production use. Core providers, storage, and utilities are robust. The orchestration layer that wires them together is incomplete.

**46 gaps identified.** 12 must close before release. 34 improve quality post-release.

## The Tracker

Every implementation agent MUST use the tracker before and after work:

```bash
# See what needs doing
./gaps/tracker.sh release        # Release gate progress
./gaps/tracker.sh next           # Next actionable by WSJF score
./gaps/tracker.sh stream         # All streams with progress bars

# Before starting work
AGENT_NAME=my-name ./gaps/tracker.sh claim ORCH-10

# After completing work
./gaps/tracker.sh done ORCH-10   # Shows what you just unblocked

# Deep dive
./gaps/tracker.sh detail ORCH-10 # WSJF scores, deps, files
./gaps/tracker.sh deps ORCH-10   # Full dependency tree
./gaps/tracker.sh category orchestration  # All gaps in category
```

**Tracker data**: `gaps/wsjf-scores.json` (WSJF scores, status, claims, dependencies)

## Gap Documentation

Each gap has detailed remediation in modular files:

| Category | File | Gaps |
|----------|------|------|
| Orchestration | `gaps/ORCHESTRATION.md` | ORCH-01 to ORCH-11 |
| Type Safety | `gaps/TYPE_SAFETY.md` | TYPE-01 to TYPE-08 |
| Error Handling | `gaps/ERROR_HANDLING.md` | ERR-01 to ERR-06 |
| Testing | `gaps/TESTING.md` | TEST-01 to TEST-07 |
| Operations | `gaps/OPERATIONAL.md` | OPS-01 to OPS-05 |
| Logging + Docs | `gaps/LOGGING_DOCUMENTATION.md` | LOG-01-04, DOC-01-05 |

**Appendices**: `gaps/APPENDIX_A.md` through `gaps/APPENDIX_E.md` (file impact index, dependency DAG, severity defs, type patterns, test roadmap)

## Release Gate (12 gaps)

These must ALL be completed before Zora is usable:

| Gap | Why |
|-----|-----|
| ORCH-10 | System won't boot |
| ORCH-01 | First provider error = dead |
| ORCH-02 | No retry = fragile |
| ORCH-03 | Tasks don't route |
| ORCH-04 | Auth tokens expire silently |
| ORCH-06 | Events lost on restart |
| ORCH-07 | No context injection |
| ORCH-09 | No heartbeat/liveness |
| OPS-01 | `zora daemon start` is a stub |
| ERR-01 | Audit logger silently fails |
| ERR-02 | Gemini JSON parse silently fails |
| ERR-05 | Event streams hang forever |

Run `./gaps/tracker.sh release` to see current progress.

## Implementation Workflow

1. Run `./gaps/tracker.sh next` to find highest-WSJF unblocked gap
2. Run `./gaps/tracker.sh detail [ID]` to see scores and dependencies
3. Read the detail file (e.g., `gaps/ORCHESTRATION.md`) for remediation approach
4. Claim: `AGENT_NAME=you ./gaps/tracker.sh claim [ID]`
5. Implement the fix
6. Run tests: `npm test`
7. Complete: `./gaps/tracker.sh done [ID]`
8. Check what unblocked: `./gaps/tracker.sh release`

## Agent Specialists

See `.claude/agents/` for specialist definitions:
- `orchestration-agent.md` - Wiring and bootstrap (ORCH gaps)
- `error-hardening-agent.md` - Error handling and resilience (ERR gaps)
- `ops-agent.md` - CLI, dashboard, logging (OPS + LOG gaps)
- `quality-agent.md` - Type safety, tests, docs (TYPE + TEST + DOC gaps)

## Key Architecture

```
src/
  cli/           # CLI entry point (daemon.ts is the stub - OPS-01)
  core/          # Orchestrator, SessionManager, PolicyEngine
  providers/     # Gemini, Claude, Local (working but unwired)
  dashboard/     # Express server + React frontend
  integrations/  # Telegram gateway
  storage/       # File-based persistence
  utils/         # Shared utilities
```

## Parallel Work: Git Worktrees

Each implementation agent works in its own git worktree. One worktree per agent, one branch per stream, merge when done. This prevents agents from stepping on each other's files during development - conflicts only happen once at merge time.

### Worktree Layout

```
~/Dev/AgentDev/                    # main repo (coordinator)
~/Dev/zora-worktrees/
  ├── orchestration/               # orchestration-agent → branch: fix/orchestration-gaps
  ├── error-hardening/             # error-hardening-agent → branch: fix/error-handling-gaps
  ├── ops/                         # ops-agent → branch: fix/ops-gaps
  └── quality/                     # quality-agent → branch: fix/quality-gaps
```

### Setup

```bash
./gaps/setup-worktrees.sh          # Creates all 4 worktrees + branches
```

### Rules for Agents in Worktrees

- **Work in your worktree.** Don't edit files in the main repo or other worktrees.
- **The tracker (`gaps/wsjf-scores.json`) is shared** across all worktrees (same repo). Claim/complete gaps from any worktree.
- **Merge via PR.** When your stream is done, push your branch and create a PR to main.
- **Don't delete worktree directories manually.** Use `git worktree remove`.
- **If two agents touch the same file** (e.g., Orchestrator.ts), resolve at merge time.

### Teardown

```bash
./gaps/teardown-worktrees.sh       # Removes all worktrees cleanly
```

## Rules

- **Don't read the full gap analysis monolith.** Use the modular files in `gaps/`.
- **Check the tracker** before starting work. Someone else may already be on it.
- **Update the tracker** when you finish. Other agents depend on seeing what unblocked.
- **Release gate first.** Don't work on TYPE/LOG/DOC gaps until the 12 release gate gaps are closed (unless you're a parallel stream with no overlap).
- **Context management**: No file in `gaps/` exceeds 1000 lines. Read structure-first, then targeted sections.
- **One worktree per agent.** Don't work in the main repo directory during parallel implementation.
