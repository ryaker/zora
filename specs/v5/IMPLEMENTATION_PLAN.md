# Zora — WSJF Implementation Plan

> **Version:** 1.1
> **Date:** 2026-02-11
> **Companion to:** ZORA_AGENT_SPEC.md v0.4.0
> **Methodology:** Weighted Shortest Job First (WSJF)
> **Changes in 1.1:** Updated for v0.4 spec — added WASM prep item, model-preference routing item, expanded test scenarios for restored journeys, added v0.4 risks and success criteria

---

## WSJF Scoring

Each work item is scored on four dimensions:

| Dimension | Scale | Description |
|-----------|-------|-------------|
| **Business Value** | 1-5 | Does this enable real workflow output? (content pipeline, job search, daily ops) |
| **Time Criticality** | 1-5 | Does delaying this block other work or create risk? |
| **Risk Reduction** | 1-5 | Does this eliminate a failure mode or security gap? |
| **Job Size** | 1-5 | Estimated effort (1 = 30 min, 2 = 1-2h, 3 = 2-4h, 4 = 4-8h, 5 = 8h+) |

**WSJF Score = (Business Value + Time Criticality + Risk Reduction) / Job Size**

Higher score = do first.

---

## Priority-Ordered Work Items

### Tier 1: Do First (WSJF ≥ 3.0) — "Working agent by end of day"

| # | Work Item | BV | TC | RR | Size | WSJF | Est. Hours |
|---|-----------|----|----|-----|------|------|------------|
| 1 | **Project scaffolding** — pnpm, tsx, TypeScript config, directory structure matching §4.3 | 2 | 5 | 1 | 1 | **8.0** | 0.5 |
| 2 | **Config system** — TOML parser, defaults, validation, `config.toml` + `policy.toml` | 3 | 5 | 2 | 2 | **5.0** | 1 |
| 3 | **LLMProvider interface** — TypeScript interfaces from §4.2 (`LLMProvider`, `AuthStatus`, `QuotaStatus`, `AgentEvent`) | 3 | 5 | 1 | 1 | **9.0** | 0.5 |
| 4 | **Claude Provider** — Agent SDK integration, Mac session token auth, `execute()` with streaming events | 5 | 5 | 2 | 3 | **4.0** | 3 |
| 5 | **Core tools** — `read_file`, `write_file`, `edit_file`, `list_directory`, `shell_exec`, `web_fetch` | 5 | 5 | 1 | 2 | **5.5** | 2 |
| 6 | **Capability policy engine** — Path resolution, symlink handling, command allowlist, chained command splitting, **error feedback to LLM** | 4 | 4 | 5 | 2 | **6.5** | 2 |
| 7 | **Execution loop** — Single-provider agentic cycle (think-act-observe), max iterations, timeout | 5 | 5 | 2 | 2 | **6.0** | 2 |
| 8 | **JSONL session persistence** — Per-job conversation history, atomic writes | 4 | 4 | 1 | 1 | **9.0** | 0.5 |
| 9 | **CLI basics** — `zora start`, `zora stop`, `zora ask`, `zora task`, `zora status` | 5 | 4 | 1 | 2 | **5.0** | 1.5 |
| 10 | **Critical file protection** — SOUL.md, MEMORY.md, policy.toml, config.toml read-only to tool layer | 2 | 3 | 5 | 1 | **10.0** | 0.5 |
| 11 | **Atomic writes for shared state** — Write-then-rename for active-jobs.json, provider-health.json | 2 | 3 | 4 | 1 | **9.0** | 0.5 |

**Tier 1 Total: ~14 hours**
**Outcome:** A working single-LLM agent. You can `zora ask "write me a blog post"` and get output.

---

### Tier 2: Do Second (WSJF 2.0-2.9) — "Failover + real workflows"

| # | Work Item | BV | TC | RR | Size | WSJF | Est. Hours |
|---|-----------|----|----|-----|------|------|------------|
| 12 | **Gemini Provider** — CLI subprocess wrapper, multi-format output parser (text, markdown-fenced JSON, XML blocks) | 4 | 4 | 3 | 3 | **3.7** | 3 |
| 13 | **Router** — Task classification heuristic (complexity × resource axes), routing matrix, user override, `model_preference` per-routine override (§5.6), **auth degradation override** (Journey 6) | 4 | 4 | 2 | 2 | **5.0** | 2 |
| 14 | **Failover Controller** — Quota detection, auth failure detection, HandoffBundle creation, Gemini promotion | 4 | 3 | 4 | 3 | **3.7** | 3 |
| 15 | **Auth health monitoring** — Heartbeat auth checks, pre-expiry warnings, checkpoint-on-auth-failure | 3 | 3 | 5 | 2 | **5.5** | 2 |
| 16 | **Routines + cron** — node-cron, TOML routine definitions, heartbeat system (HEARTBEAT.md polling) | 5 | 3 | 1 | 2 | **4.5** | 2 |
| 17 | **macOS notifications** — `node-notifier` or `osascript` for task complete, errors, auth expiry, flags | 4 | 2 | 1 | 1 | **7.0** | 0.5 |
| 18 | **Retry queue** — Exponential backoff for quota-exhausted tasks, persistence across restarts | 3 | 2 | 3 | 2 | **4.0** | 1.5 |
| 19 | **Content pipeline routine** — MyMoneyCoach weekly blog + social posts TOML routine | 5 | 3 | 0 | 2 | **4.0** | 2 |
| 20 | **Job search routine** — Daily job scan + cover letter generation TOML routine | 4 | 2 | 0 | 2 | **3.0** | 2 |

**Tier 2 Total: ~18 hours**
**Outcome:** Dual-LLM agent with failover, scheduled routines producing real MyMoneyCoach content and job search results.

---

### Tier 3: Do Third (WSJF 1.0-1.9) — "Memory + security hardening"

| # | Work Item | BV | TC | RR | Size | WSJF | Est. Hours |
|---|-----------|----|----|-----|------|------|------------|
| 21 | **Memory Tier 1+2** — MEMORY.md loading, daily notes read/write, context assembly with memory | 4 | 2 | 1 | 2 | **3.5** | 2 |
| 22 | **Memory Tier 3** — Structured items (JSON), six memory types, source tagging | 3 | 2 | 2 | 2 | **3.5** | 2 |
| 23 | **Salience scoring** — Retrieval ranking (reinforcement + recency decay + relevance + source trust) | 3 | 1 | 1 | 2 | **2.5** | 1.5 |
| 24 | **Memory extraction pipeline** — Schema-guided LLM extraction, correction loop, deduplication | 3 | 1 | 1 | 3 | **1.7** | 3 |
| 25 | **Category auto-organization** — Category assignment, summary generation, dual-mode retrieval | 3 | 1 | 1 | 3 | **1.7** | 3 |
| 26 | **Secrets management** — AES-256-GCM encryption, Keychain integration via keytar, JIT decryption | 2 | 2 | 5 | 2 | **4.5** | 2 |
| 27 | **Audit logging** — Hash-chained append-only log, serialized writer queue | 2 | 1 | 4 | 2 | **3.5** | 1.5 |
| 28 | **Integrity Guardian** — SHA-256 baselines for critical files + tool registry, heartbeat checks | 2 | 1 | 5 | 2 | **4.0** | 1.5 |
| 29 | **Prompt injection defense** — Input sanitizer, output validator | 1 | 1 | 4 | 2 | **3.0** | 2 |
| 30 | **Leak detection** — Scan LLM outputs for secret patterns | 1 | 1 | 4 | 1 | **6.0** | 1 |
| 31 | **Worker capability tokens** — Scoped permission subsets per job | 2 | 1 | 3 | 2 | **3.0** | 2 |
| 32 | **`zora memory` CLI** — search, forget, categories commands | 3 | 1 | 0 | 1 | **4.0** | 1 |
| 33 | **`zora audit` CLI** — View audit log with filters | 1 | 1 | 2 | 1 | **4.0** | 0.5 |
| 34 | **`zora config/policy/soul/memory edit` CLI** — Human-only edit commands | 2 | 1 | 2 | 1 | **5.0** | 0.5 |

**Tier 3 Total: ~23 hours**
**Outcome:** Full memory system with salience ranking, complete security stack, auditable operation.

---

### Tier 4: Do Fourth (WSJF < 1.0) — "Teams, steering, polish"

| # | Work Item | BV | TC | RR | Size | WSJF | Est. Hours |
|---|-----------|----|----|-----|------|------|------------|
| 35 | **Cross-agent mailbox infrastructure** — Team dirs, inbox JSON files, message types | 3 | 1 | 1 | 3 | **1.7** | 3 |
| 36 | **Gemini Bridge** — Background process polling mailbox → invoking CLI → writing results | 3 | 1 | 1 | 3 | **1.7** | 3 |
| 37 | **Bridge Watchdog** — Daemon monitors bridge health, restart with backoff | 1 | 1 | 3 | 1 | **5.0** | 1 |
| 38 | **Team lifecycle** — Create/assign/synthesize/teardown commands | 2 | 1 | 0 | 2 | **1.5** | 2 |
| 39 | **Steer message injection** — CLI + direct inbox edit | 3 | 1 | 0 | 2 | **2.0** | 1.5 |
| 40 | **Flag-without-blocking** — Flag mechanism, macOS notification, timeout to default | 3 | 1 | 1 | 2 | **2.5** | 2 |
| 41 | **Dashboard (basic web UI)** — localhost:7070, job status, steering input, flagged decisions | 3 | 1 | 0 | 4 | **1.0** | 6 |
| 42 | **Dashboard auth** — Bearer token from Keychain | 1 | 1 | 3 | 1 | **5.0** | 0.5 |
| 43 | **Event-triggered routines** — File watcher (polling, NOT fs.watch on macOS) | 2 | 1 | 0 | 2 | **1.5** | 2 |
| 44 | **MCP server support** — Client integration via `@modelcontextprotocol/sdk` | 3 | 1 | 0 | 3 | **1.3** | 3 |
| 45 | **`zora team` CLI** — create, list, status, teardown | 2 | 1 | 0 | 2 | **1.5** | 1.5 |
| 46 | **`zora steer/flags/approve/reject` CLI** | 2 | 1 | 0 | 2 | **1.5** | 1.5 |
| 47 | **Repo cleanup routine** — Example routine for Journey 3 (stale branches, uncommitted changes, behind-remote detection) | 3 | 1 | 0 | 1 | **4.0** | 1 |
| 48 | **WASM sandbox spike** — Evaluate Wasmtime Node.js bindings (`@aspect-build/wasmtime`), prototype wrapping `shell_exec` in WASM sandbox, document findings for v2 (§5.5 Roadmap) | 2 | 1 | 3 | 3 | **2.0** | 4 |
| 49 | **Model-aware routing tests** — End-to-end test for Journey 4 (complex task routes to Claude, routine routes to Gemini, mid-task failover preserves routing preference) | 2 | 1 | 1 | 2 | **2.0** | 2 |
| 50 | **Cross-agent parallel benchmark** — Test for Success Criterion 11 (two agents complete parallelizable task in <60% of single-agent time) | 2 | 1 | 1 | 2 | **2.0** | 2 |

**Tier 4 Total: ~36 hours**
**Outcome:** Full multi-agent teams, async steering, dashboard, complete CLI, WASM v2 spike, all 7 journey test coverage.

---

## Build Sessions — Realistic Calendar

Based on Claude Max quota resets and actual agent coding speed:

### Session 1: Wednesday Feb 12, 5AM — "Foundation Day"
**Quota:** Fresh Claude Max reset
**Target:** Tier 1 complete (items 1-11)
**Estimated time:** 6-8 hours (some items faster than estimated, SDK auth is the wildcard)
**Deliverable:** Working single-LLM agent. `zora ask` produces output.

### Session 2: Thursday Feb 13 — "Failover + Workflows"
**Quota:** Depends on Session 1 consumption
**Target:** Tier 2 items 12-18 (Gemini provider, router, failover, routines, notifications)
**Estimated time:** 6-8 hours
**Deliverable:** Dual-LLM agent with failover and scheduled routines.

### Session 3: Friday Feb 14 — "Real Output"
**Target:** Tier 2 items 19-20 (content pipeline + job search routines) + Tier 3 items 21-22 (memory basics)
**Estimated time:** 4-6 hours
**Deliverable:** Agent producing actual MyMoneyCoach content and job search results on schedule.

### Session 4: Weekend Feb 15-16 — "Hardening + Memory"
**Target:** Remaining Tier 3 (security stack, full memory system, salience scoring)
**Estimated time:** 8-10 hours across both days
**Deliverable:** Production-hardened agent with full memory system.

### Session 5: Following Week (Mon-Wed) — "Teams + Steering"
**Target:** Tier 4 items 35-46 (teams, steering, dashboard, event routines, MCP)
**Estimated time:** 10-12 hours across 3 days
**Deliverable:** Multi-agent teams, async steering, dashboard UI.

### Session 6: Following Week (Thu-Fri) — "Polish + WASM Spike + OSS Release"
**Target:** Tier 4 items 47-50 (repo cleanup routine, WASM spike, model-aware routing tests, parallel benchmark) + documentation + Docker deployment guide
**Estimated time:** 8-10 hours across 2 days
**Deliverable:** Public GitHub release. WASM v2 feasibility documented.

---

## OSS Release Checklist

### Repository Structure

```
zora/
├── README.md                     # Overview, quick start, badges
├── LICENSE                       # MIT
├── ZORA_AGENT_SPEC.md           # Full technical specification
├── IMPLEMENTATION_PLAN.md        # This document
├── CONTRIBUTING.md               # How to contribute
├── CHANGELOG.md                  # Release notes
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                  # Entry point
│   ├── cli/                      # CLI commands
│   ├── orchestrator/             # Router, Scheduler, Failover Controller
│   ├── providers/                # Claude, Gemini, Local provider implementations
│   ├── tools/                    # Built-in tools
│   ├── memory/                   # Three-tier memory system
│   ├── security/                 # Policy engine, audit, integrity, secrets
│   ├── routines/                 # Cron, heartbeat, event triggers
│   ├── teams/                    # Cross-agent communication
│   ├── steering/                 # Async HITL mechanisms
│   ├── dashboard/                # Web UI
│   └── wasm/                     # WASM sandbox spike (v2 prep)
├── docs/
│   ├── QUICK_START.md            # 5-minute setup
│   ├── ARCHITECTURE.md           # Visual system overview
│   ├── SECURITY_HARDENING.md     # Security configuration guide
│   ├── DOCKER_DEPLOYMENT.md      # Docker setup for Linux users
│   ├── WRITING_ROUTINES.md       # How to create custom routines
│   ├── MEMORY_SYSTEM.md          # Deep dive into memU-inspired memory
│   ├── DESIGN_INFLUENCES.md      # Pattern extraction from studied projects
│   ├── diagrams/                 # Architecture diagrams (Mermaid + PNG)
│   └── reviews/                  # GPT 5.2 + Claude architectural reviews
├── examples/
│   ├── routines/                 # Example routine TOMLs
│   │   ├── daily-standup.toml
│   │   ├── repo-cleanup.toml
│   │   └── content-pipeline.toml
│   ├── policies/                 # Example policy configurations
│   │   ├── conservative.toml     # Minimal permissions
│   │   ├── developer.toml        # Full dev tool access
│   │   └── content-creator.toml  # Web + file access, no shell
│   └── memory/                   # Example MEMORY.md and SOUL.md templates
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── README.md                 # Docker-specific instructions
└── tests/
    ├── unit/
    ├── integration/
    └── security/                 # Prompt injection test suite
```

### Documentation Deliverables

| Document | Priority | Description |
|----------|----------|-------------|
| `README.md` | P0 | Hero section, quick start, architecture diagram, feature list, comparison to OpenClaw/Nanobot |
| `docs/QUICK_START.md` | P0 | Prerequisites, install, first task, first routine — 5 minutes to working agent |
| `docs/ARCHITECTURE.md` | P0 | System overview with Mermaid diagrams, component descriptions, data flow |
| `docs/WRITING_ROUTINES.md` | P1 | TOML format, cron syntax, model preference, examples for common use cases |
| `docs/SECURITY_HARDENING.md` | P1 | Policy configuration, allowlist best practices, audit log verification, Keychain setup |
| `docs/DOCKER_DEPLOYMENT.md` | P1 | Docker setup, volume mounts, API key auth (no Keychain in Docker), network config |
| `docs/MEMORY_SYSTEM.md` | P2 | memU-inspired architecture, salience scoring, category organization, extraction pipeline |
| `docs/DESIGN_INFLUENCES.md` | P2 | Pattern extraction from 6 projects, what was adopted and why |
| `docs/reviews/` | P3 | GPT 5.2 analysis, Claude consolidated review — transparency artifacts |
| `docs/WASM_SPIKE.md` | P2 | Wasmtime evaluation results, benchmarks, v2 migration plan (output of item 48) |
| `CONTRIBUTING.md` | P2 | How to add tools, providers, routines; coding standards; PR process |

### Diagrams (Mermaid + rendered PNG for README)

1. **System architecture** — The full component diagram from §4.1 as Mermaid
2. **Execution loop** — Flowchart of the agentic cycle with failover branches
3. **Memory hierarchy** — Three tiers with salience scoring flow
4. **Auth degradation** — State machine showing healthy → warning → degraded → restored
5. **Failover flow** — Decision tree: quota error vs auth error vs both down
6. **Team communication** — Filesystem mailbox architecture with Gemini Bridge, bridge watchdog, and coordinator flow (§5.7)
7. **Async steering** — Non-blocking HITL flow showing CLI/dashboard/inbox injection paths (§5.8)

### Docker Deployment Notes

For users who want to run Zora in Docker (Linux, or macOS users who want isolation):

**Key differences from native macOS:**
- No macOS Keychain → secrets via environment variables or Docker secrets
- No macOS notifications → webhook or stdout logging
- No Mac session token for Claude → must use API key (`ANTHROPIC_API_KEY`)
- Gemini CLI needs gcloud auth configured in the container

```yaml
# docker-compose.yml (example)
version: '3.8'
services:
  zora:
    build: ./docker
    volumes:
      - ./config:/home/zora/.zora/config:ro
      - ./workspace:/home/zora/.zora/workspace
      - ./memory:/home/zora/.zora/memory
      - ./projects:/home/zora/Projects
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - GEMINI_API_KEY=${GEMINI_API_KEY}  # Or gcloud credentials mount
    ports:
      - "7070:7070"  # Dashboard
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation | Tier |
|------|-----------|--------|------------|------|
| Claude SDK auth doesn't expose token TTL | High | Medium | Empirical testing in Session 1; fall back to "check on every heartbeat" | 1 |
| Gemini CLI output format varies by version | High | Medium | Multi-format parser, version detection, fallback to prompt-enforced structure | 2 |
| JSONL corruption under concurrent writes | Medium | High | Per-job files (already planned), atomic writes for shared state | 1 |
| Memory poisoning via web content | Medium | High | Source tagging, trust weighting, MEMORY.md read-only | 3 |
| Claude Max quota insufficient for full day | High | Low | Gemini failover handles this by design | 2 |
| Gemini Workspace quota limits unknown | Medium | Medium | Benchmark during Session 2; adjust routing thresholds | 2 |
| Long-running routines exceed job timeout | Low | Medium | Checkpoint + resume mechanism; increase default timeout | 2 |
| Wasmtime Node.js bindings immature | Medium | Low | Spike in Tier 4 item 48 determines v2 timeline; v1 policy-based isolation is sufficient | 4 |
| `model_preference` routing conflicts with failover | Low | Medium | Failover always overrides preference — documented in Decision 9; test in item 49 | 2 |
| Bridge watchdog + Gemini bridge adds process complexity | Medium | Medium | Keep bridge as optional — Claude-only mode works without it; monitor in 24h stability test | 4 |

---

## Definition of Done — V1 OSS Release

- [ ] All Tier 1-3 work items complete and tested (items 1-34)
- [ ] At least 5 Tier 4 items complete (routines, basic steering, bridge watchdog, dashboard, repo cleanup)
- [ ] README with architecture diagram and quick start
- [ ] QUICK_START.md tested on clean macOS install
- [ ] DOCKER_DEPLOYMENT.md tested on Linux
- [ ] 3+ example routines in `examples/` (including repo-cleanup from Journey 3)
- [ ] 3+ example policies in `examples/`
- [ ] Prompt injection test suite passes (10 patterns)
- [ ] 24-hour stability test completed
- [ ] Agent has produced real MyMoneyCoach content output (Success Criterion 9)
- [ ] Agent has produced real job search results (Success Criterion 10)
- [ ] Cross-agent parallel task completes in <60% of single-agent time (Success Criterion 11)
- [ ] Async steering redirects agent within 10 seconds, no work lost (Success Criterion 12)
- [ ] Flag-without-blocking: agent proceeds with defaults, human reviews post-completion (Success Criterion 13)
- [ ] WASM sandbox spike completed with v2 feasibility documented (item 48)
- [ ] CHANGELOG.md written
- [ ] MIT license applied
- [ ] GitHub repo is public

---

*Build fast. Ship real output. Open source when it works.*
