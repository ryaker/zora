# Production Readiness Assessment

## Key Finding

Zora's individual components are genuinely well-implemented -- real cryptography, real file I/O, real algorithms -- but the orchestration layer that wires them together is missing. The system is a collection of production-quality parts that have never been assembled into a running whole.

---

## Executive Summary

| Dimension | Status |
|---|---|
| **Overall Verdict** | **NOT PRODUCTION-READY** (pre-release developer preview) |
| Version | v0.9.0 |
| Tier 1 -- Foundation | Complete |
| Tier 2 -- Intelligence | Substantially complete (components built, not wired) |
| Tier 3 -- Interfaces | In progress |

---

## What Works -- Production-Grade Components (29 modules)

### Security (all genuinely production-ready)

| Component | File | Evidence |
|---|---|---|
| PolicyEngine | `src/security/policy-engine.ts` | Real symlink detection via `fs.lstatSync`/`realpathSync`, path canonicalization, quote-aware command parsing, SDK `canUseTool` integration, **action budget enforcement** (per-session + per-type limits, token budgets), **dry-run preview mode** (smart write-tool interception with read-only command classification), **intent capsule integration** (goal drift checking) |
| AuditLogger | `src/security/audit-logger.ts` | Real SHA-256 hash chain via `crypto.createHash`, serialized Promise-based write queue, chain verification, genesis hash pattern |
| SecretsManager | `src/security/secrets-manager.ts` | Real AES-256-GCM via `crypto.createCipheriv`, PBKDF2 100k iterations, 96-bit IV per NIST SP 800-38D, 32-byte salt, `0o600` permissions, atomic `.tmp`+rename writes |
| IntegrityGuardian | `src/security/integrity-guardian.ts` | Real SHA-256 baselines, file quarantine via `fs.copyFile`, tool registry tampering detection |
| LeakDetector | `src/security/leak-detector.ts` | 9 real regex patterns (OpenAI/Anthropic keys, GitHub tokens, AWS keys, private keys, JWTs, base64 blocks) |
| PromptDefense | `src/security/prompt-defense.ts` | 20+ injection patterns (direct + RAG-specific), `sanitizeToolOutput()` for tool-output injection, output validation for shell exfiltration (pipe-to-curl/wget), critical file modification blocking |
| CapabilityTokens | `src/security/capability-tokens.ts` | Real expiration enforcement (30min default), path normalization with `path.resolve`, deny-first evaluation |
| IntentCapsuleManager | `src/security/intent-capsule.ts` | **NEW in v0.6** — HMAC-SHA256 signed mandate bundles per task, SHA-256 mandate hashing, keyword-based + category-based drift detection, timing-safe signature verification, per-session signing keys |
| PolicyLoader | `src/config/policy-loader.ts` | **NEW in v0.6** — Centralized TOML→ZoraPolicy parsing, backward-compatible defaults for missing `[budget]`/`[dry_run]` sections |

### Memory (all genuinely production-ready)

| Component | File | Evidence |
|---|---|---|
| MemoryManager | `src/memory/memory-manager.ts` | Real 3-tier loading: Tier 1 MEMORY.md, Tier 2 daily notes with date regex filtering, Tier 3 structured items. Tilde expansion, atomic `wx` flag creation |
| SalienceScorer | `src/memory/salience-scorer.ts` | Real exponential decay (`e^(-ln2 * days/halflife)`), Jaccard similarity word overlap, source trust bonuses by type |
| StructuredMemory | `src/memory/structured-memory.ts` | Real CRUD with atomic writes, `mem_{timestamp}_{hex}` IDs, path traversal protection via ID format validation |
| ExtractionPipeline | `src/memory/extraction-pipeline.ts` | Real schema validation, retry logic (2 retries), deduplication via 0.8 Jaccard threshold |
| CategoryOrganizer | `src/memory/category-organizer.ts` | Real auto-categorization (type->prefix, first tag->suffix), relevance scoring, directory walking |

### Orchestration (individual pieces work)

| Component | File | Evidence |
|---|---|---|
| SessionManager | `src/orchestrator/session-manager.ts` | Real JSONL append via `fs.promises.appendFile`, corruption-tolerant parsing (skips bad lines), path traversal protection via jobId sanitization |
| ExecutionLoop | `src/orchestrator/execution-loop.ts` | Real SDK `query()` wrapper, proper async generator iteration, session ID capture |
| ClaudeProvider | `src/providers/claude-provider.ts` | Real SDK integration via lazy dynamic import, dependency injection for testing, exhaustive message mapping, abort controller, cost tracking, memory context injection into prompts. Multiple entries supported for Opus/Sonnet/Haiku tier selection. |
| OllamaProvider | `src/providers/ollama-provider.ts` | HTTP REST client for Ollama `/api/chat` with NDJSON streaming, abort controller, 50MB buffer limit, tool call parsing. `cost_tier = "free"` for local models. |

### Teams and Coordination

| Component | File | Evidence |
|---|---|---|
| TeamManager | `src/teams/team-manager.ts` | Real directory management, JSON config persistence, member tracking |
| Mailbox | `src/teams/mailbox.ts` | Real filesystem-based message queue with atomic write-then-rename |
| GeminiBridge | `src/teams/gemini-bridge.ts` | Real subprocess spawn via `child_process`, stdio capture, inbox polling |
| BridgeWatchdog | `src/teams/bridge-watchdog.ts` | Real heartbeat monitoring, exponential backoff restart, max retry limits, state persistence to `bridge-health.json` |
| AgentLoader | `src/teams/agent-loader.ts` | Real YAML frontmatter parsing, SDK `AgentDefinition` conversion |

### Steering

| Component | File | Evidence |
|---|---|---|
| SteeringManager | `src/steering/steering-manager.ts` | Real message persistence, job-specific directories, archiving |
| FlagManager | `src/steering/flag-manager.ts` | Real timeout logic with auto-resolve, state transitions, filesystem storage |
| TelegramGateway | `src/steering/telegram-gateway.ts` | Real `node-telegram-bot-api` integration, long polling, user allowlist, `/steer` and `/help` commands |

### Routines

| Component | File | Evidence |
|---|---|---|
| RoutineManager | `src/routines/routine-manager.ts` | Real TOML parsing, `node-cron` scheduling, routes through `Orchestrator.submitTask()` with `model_preference` and `max_cost_tier` flow-through |
| HeartbeatSystem | `src/routines/heartbeat.ts` | Real markdown task parsing (`- [ ]` checkboxes), completion marking (`- [x]`) |
| EventTriggerManager | `src/routines/event-triggers.ts` | Real `fs.stat` polling, glob pattern matching with debouncing |

### Other

| Component | File | Evidence |
|---|---|---|
| AuthMiddleware | `src/dashboard/auth-middleware.ts` | Real timing-safe Bearer token comparison via `crypto.timingSafeEqual` |

---

## What's NOT Ready -- Critical Gaps (7 components)

| Component | File | Issue |
|---|---|---|
| Router | `src/orchestrator/router.ts` | Task classification uses naive keyword regex (`text.includes('code')` -> `"coding"`). Round-robin mode picks randomly instead of rotating. No fallback when all candidates are unavailable -- throws immediately. |
| FailoverController | `src/orchestrator/failover-controller.ts` | **NEVER INVOKED** -- `handleFailure()` exists but no code calls it. Line 55 comment admits _"In a real system, the provider state would be globally updated"_ -- it is not. Error detection via string pattern matching is fragile across providers. |
| RetryQueue | `src/orchestrator/retry-queue.ts` | Persists failed tasks to disk but **NO SCHEDULER CONSUMES IT** -- `getReadyTasks()` returns ready tasks but nothing re-executes them. Comment says "exponential backoff" but code uses quadratic. |
| AuthMonitor | `src/orchestrator/auth-monitor.ts` | **NEVER INVOKED** -- `checkAll()` exists but nothing schedules it. No token refresh, only macOS notifications. Comment says _"we would call checkpointActiveJobs"_ -- not done. |
| GeminiProvider | `src/providers/gemini-provider.ts` | `checkAuth()` only verifies CLI binary exists, not authentication. Tool call parsing uses guessed regex patterns (XML and markdown JSON) never tested against real output. Silent empty catch blocks swallow malformed JSON. Unbounded stdout buffer accumulation. |
| CLI daemon commands | `src/cli/index.ts` | `start` logs hardcoded `"Daemon started (PID: 12345)"`. `stop` is a `console.log` no-op. `status` outputs `"running (simulated)"`. |
| Dashboard data endpoints | `src/dashboard/server.ts` | `GET /api/jobs` returns `{ jobs: [] }` with comment _"return a placeholder"_. No frontend `dist` directory exists in the repository. |

---

## The Critical Missing Piece -- No Main Orchestrator

There is no `bootstrap()`, `main()`, or startup sequence anywhere in the codebase that instantiates the components and wires them together. The following disconnections exist:

- **ExecutionLoop does NOT call Router** for provider selection
- **ExecutionLoop does NOT poll SteeringManager** during execution
- **ExecutionLoop does NOT persist events to SessionManager**
- **ExecutionLoop does NOT inject MemoryManager context** (the `ask` CLI command does this manually, but the loop itself does not)
- **FailoverController is never called** on SDK errors
- **HeartbeatSystem is never started**
- **AuthMonitor is never scheduled**
- **RetryQueue is never polled** by any background loop
- **RoutineManager is never instantiated** in any startup path

The `ask` command in `src/cli/index.ts` is the **ONLY** end-to-end path that works: it manually loads config, creates a `PolicyEngine`, creates a `MemoryManager`, builds a system prompt, and calls `ExecutionLoop.run()`. But this is a one-shot execution with no routing, no failover, no retry, no steering, and no session persistence.

---

## What Works End-to-End Today

- `zora-agent ask "prompt"` -> `setupContext()` -> `ExecutionLoop` -> Claude SDK `query()` -> response (single-shot, Claude-only)
- Individual security modules can be used standalone (real crypto, real file I/O)
- Individual memory modules can be used standalone (real storage and retrieval)
- Team mailbox system works in isolation (real filesystem IPC)
- Steering messages can be injected (but never consumed during execution)

---

## What Does NOT Work End-to-End

- **Multi-provider routing** -- Router exists but is not called by ExecutionLoop
- **Automatic failover** -- FailoverController exists but is orphaned
- **Retry on transient errors** -- RetryQueue stores but no scheduler retries
- **Auth health monitoring** -- AuthMonitor never runs
- **Daemon mode** -- CLI `start`/`stop` are stubs
- **Dashboard job listing** -- returns empty array
- **Mid-task steering** -- messages accepted but never polled during execution
- **Scheduled routines** -- RoutineManager never instantiated
- **Gemini as fallback provider** -- provider exists but is never selected

---

## Remediation Roadmap

### P0 -- Wire the Orchestrator

- Create a main `Orchestrator` class that instantiates and connects all components
- Wire `Router` into `ExecutionLoop` for provider selection
- Connect `FailoverController` to the error handling path
- Start `AuthMonitor` on a schedule
- Poll `RetryQueue` from a background loop
- Inject `MemoryManager` context systematically (not only in the CLI `ask` command)
- Poll `SteeringManager` during execution for mid-task corrections

### P1 -- Complete CLI and Dashboard

- Implement real `zora-agent start` (daemonize the orchestrator)
- Implement real `zora-agent stop` (signal the daemon)
- Implement real `zora-agent status` (query running state)
- Wire dashboard `GET /api/jobs` to `SessionManager`
- Build or stub the frontend `dist`

### P2 -- Hardening (partially complete)

- ~~Action budget enforcement (per-session + per-type)~~ **DONE in v0.6**
- ~~Dry-run preview mode for write operations~~ **DONE in v0.6**
- ~~Intent capsule / mandate signing for goal drift detection~~ **DONE in v0.6**
- ~~RAG/tool-output injection defense~~ **DONE in v0.6**
- ~~Centralized policy loader (DRY refactor)~~ **DONE in v0.6**
- Add HTTP rate limiting to the dashboard Express server
- Structured logging (JSON format) with rotation
- Integration tests for the full orchestration flow
- Fix `GeminiProvider` tool parsing (test against real CLI output)
- Request body size limits on Express
- Performance benchmarks

---

## Usage Classification

| Use Case | Status | Notes |
|---|---|---|
| Local development and experimentation | **SAFE** | Encouraged |
| Personal automation (single-shot tasks via `zora-agent ask`) | **ACCEPTABLE** | Only Claude provider works; no failover |
| Team/org deployment | **NOT READY** | Requires P0 + P1 completion |
| Mission-critical production | **NOT READY** | Requires P0 + P1 + P2 completion and v1.0 release |

---

**Assessment date:** 2026-02-13

**Methodology:** Based on line-by-line source code review of all 34 source files in `src/`, not documentation claims.

**Version assessed:** v0.9.0
