# Remediation Roadmap

> **Version:** 1.0
> **Date:** 2026-02-13
> **Companion to:** PRODUCTION_READINESS.md
> **Methodology:** WSJF (Weighted Shortest Job First) — same scoring model as IMPLEMENTATION_PLAN.md
> **Baseline:** v0.9.0 source audit (66 source files, 41 test files)

---

## Problem Statement

Zora's 27 production-grade components have never been assembled into a running whole. There is no `bootstrap()` or `main()` that instantiates and wires the system together. The `ask` CLI command is the **only** end-to-end path, and it bypasses routing, failover, retry, steering, session persistence, and scheduled routines entirely.

This roadmap defines the concrete work items, ordered by WSJF priority, to take Zora from "collection of parts" to "running system."

---

## WSJF Scoring (same as IMPLEMENTATION_PLAN.md)

| Dimension | Scale | Description |
|-----------|-------|-------------|
| **Business Value (BV)** | 1-5 | Does this enable real workflow output? |
| **Time Criticality (TC)** | 1-5 | Does delaying this block other work? |
| **Risk Reduction (RR)** | 1-5 | Does this eliminate a failure mode or security gap? |
| **Job Size** | 1-5 | Estimated effort (1 = 30 min, 2 = 1-2h, 3 = 2-4h, 4 = 4-8h, 5 = 8h+) |

**WSJF = (BV + TC + RR) / Size**

---

## P0 — Wire the Orchestrator

**Goal:** Create a central `Orchestrator` class that boots, owns, and connects every component. After P0, `zora-agent ask` uses routing, failover, retry, steering, and session persistence.

**Exit criteria:** A single integration test boots the Orchestrator, submits a task via mock provider, observes router selection, simulates a failure triggering failover, and verifies session JSONL was written.

| # | Work Item | BV | TC | RR | Size | WSJF | Files Touched | Details |
|---|-----------|----|----|-----|------|------|---------------|---------|
| R1 | **Create `Orchestrator` class** | 5 | 5 | 4 | 3 | **4.7** | `src/orchestrator/orchestrator.ts` (new) | Single owner that instantiates Router, FailoverController, RetryQueue, AuthMonitor, SessionManager, SteeringManager, MemoryManager, HeartbeatSystem, RoutineManager. Exposes `boot()` and `shutdown()`. |
| R2 | **Wire Router into execution path** | 5 | 5 | 3 | 2 | **6.5** | `src/orchestrator/orchestrator.ts`, `src/orchestrator/execution-loop.ts` | `Orchestrator.submitTask()` calls `Router.selectProvider()` before `ExecutionLoop.run()`. Pass the selected provider's model/config into the execution options. Currently `ExecutionLoop` hardcodes to Claude SDK — add provider dispatch. |
| R3 | **Connect FailoverController to error path** | 4 | 4 | 5 | 2 | **6.5** | `src/orchestrator/orchestrator.ts`, `src/orchestrator/failover-controller.ts` | Wrap `ExecutionLoop.run()` in try/catch. On provider error, call `FailoverController.handleFailure()`. If a `FailoverResult` is returned, re-run with the new provider. Fix the dead-code issue: `handleFailure()` currently exists but is **never invoked** (line 55 of `failover-controller.ts` admits this). |
| R4 | **Schedule AuthMonitor on heartbeat** | 3 | 3 | 5 | 1 | **11.0** | `src/orchestrator/orchestrator.ts`, `src/orchestrator/auth-monitor.ts` | Call `AuthMonitor.checkAll()` on a `setInterval` (default: every 5 minutes). Currently **never invoked** — wire it into `boot()`. Implement the missing `checkpointActiveJobs()` call (line 50 of auth-monitor.ts admits it's missing). |
| R5 | **Poll RetryQueue from background loop** | 3 | 3 | 4 | 2 | **5.0** | `src/orchestrator/orchestrator.ts`, `src/orchestrator/retry-queue.ts` | Add a `setInterval` in `boot()` that calls `RetryQueue.getReadyTasks()` and re-submits them via `submitTask()`. Currently `getReadyTasks()` returns ready tasks but **nothing consumes them**. Also fix the comment: code uses quadratic backoff (`retryCount^2`), not exponential. Either fix the code or the comment. |
| R6 | **Inject MemoryManager context systematically** | 4 | 3 | 2 | 1 | **9.0** | `src/orchestrator/orchestrator.ts` | Move the `memoryManager.loadContext()` call from the CLI `ask` command into `Orchestrator.submitTask()` so every execution path (CLI, routine, retry) gets memory context. Currently only the `ask` command does this manually. |
| R7 | **Poll SteeringManager during execution** | 4 | 3 | 2 | 2 | **4.5** | `src/orchestrator/orchestrator.ts`, `src/orchestrator/execution-loop.ts` | Use the `onMessage` callback in `ExecutionLoop` to periodically call `SteeringManager.getPendingMessages(jobId)`. Inject pending steering messages as system prompt amendments or user-turn injections. Currently messages are accepted but **never polled** during execution. |
| R8 | **Persist events to SessionManager** | 4 | 4 | 3 | 1 | **11.0** | `src/orchestrator/orchestrator.ts` | Use the `onMessage` callback to call `SessionManager.appendEvent(jobId, event)` for each event. Currently **no events are persisted** during execution. |
| R9 | **Start HeartbeatSystem and RoutineManager** | 4 | 2 | 1 | 1 | **7.0** | `src/orchestrator/orchestrator.ts` | In `boot()`, call `HeartbeatSystem.start()` and `RoutineManager.init()`. Currently **neither is ever instantiated** in any startup path. |
| R10 | **Refactor `ask` command to use Orchestrator** | 4 | 4 | 2 | 2 | **5.0** | `src/cli/index.ts` | Replace the manual `setupContext()` + `ExecutionLoop` wiring in the `ask` command with `Orchestrator.boot()` + `Orchestrator.submitTask()`. This eliminates code duplication and ensures all tasks go through the same wired path. |

### P0 Dependency Graph

```
R1 (Orchestrator class)
├── R2 (Wire Router)          ─── depends on R1
├── R3 (Wire FailoverController) ─── depends on R1, R2
├── R4 (Schedule AuthMonitor)  ─── depends on R1
├── R5 (Poll RetryQueue)      ─── depends on R1, R2
├── R6 (Inject Memory)        ─── depends on R1
├── R7 (Poll Steering)        ─── depends on R1, R2
├── R8 (Persist Sessions)     ─── depends on R1, R2
├── R9 (Start Heartbeat/Routines) ─── depends on R1
└── R10 (Refactor CLI)        ─── depends on R1 through R9
```

### P0 Implementation Order (by WSJF, respecting dependencies)

1. **R1** — Create `Orchestrator` shell (WSJF 4.7, blocks everything)
2. **R4** — Schedule AuthMonitor (WSJF 11.0, only needs R1)
3. **R8** — Persist sessions (WSJF 11.0, only needs R1)
4. **R6** — Inject memory (WSJF 9.0, only needs R1)
5. **R9** — Start heartbeat/routines (WSJF 7.0, only needs R1)
6. **R2** — Wire Router (WSJF 6.5, needs R1)
7. **R3** — Wire FailoverController (WSJF 6.5, needs R1+R2)
8. **R5** — Poll RetryQueue (WSJF 5.0, needs R1+R2)
9. **R7** — Poll Steering (WSJF 4.5, needs R1+R2)
10. **R10** — Refactor CLI `ask` (WSJF 5.0, needs all above)

**Estimated total: ~16 hours of focused implementation**

---

## P1 — Complete CLI and Dashboard

**Goal:** Real daemon lifecycle (`start`/`stop`/`status`) and a functional dashboard with live job data. After P1, a user can start Zora as a background daemon, view active jobs in a browser, and steer tasks from the web UI.

**Exit criteria:** `zora-agent start` spawns a background process, `zora-agent status` reports its PID and active jobs, `GET /api/jobs` returns real session data, and the frontend loads in a browser.

| # | Work Item | BV | TC | RR | Size | WSJF | Files Touched | Details |
|---|-----------|----|----|-----|------|------|---------------|---------|
| R11 | **Implement real `zora-agent start`** | 5 | 4 | 3 | 3 | **4.0** | `src/cli/index.ts`, `src/orchestrator/orchestrator.ts` | Replace `console.log('Daemon started (PID: 12345)')` with a real daemonization strategy. Options: (a) `child_process.fork()` with `detached: true` + `unref()`, writing PID to `~/.zora/state/daemon.pid`; or (b) systemd/launchd integration. Store PID + port in a pidfile. Boot the Orchestrator in the child process. |
| R12 | **Implement real `zora-agent stop`** | 4 | 3 | 2 | 1 | **9.0** | `src/cli/index.ts` | Read PID from `~/.zora/state/daemon.pid`, send `SIGTERM`, wait for graceful shutdown (Orchestrator calls `shutdown()` on signal), remove pidfile. Currently just logs `"Daemon stopped."` — a no-op. |
| R13 | **Implement real `zora-agent status`** | 4 | 3 | 2 | 2 | **4.5** | `src/cli/index.ts` | Read pidfile, check if process is alive (`process.kill(pid, 0)`), query `GET /api/health` on the dashboard port for provider status. Replace the hardcoded `"running (simulated)"` string. |
| R14 | **Wire `GET /api/jobs` to SessionManager** | 4 | 3 | 2 | 2 | **4.5** | `src/dashboard/server.ts`, `src/orchestrator/session-manager.ts` | Replace `{ jobs: [] }` placeholder with a real query. Add `SessionManager.listSessions()` that reads the `sessions/` directory and returns job metadata (jobId, event count, last activity, status). The dashboard server already has a `sessionManager` reference in its options — just use it. |
| R15 | **Build frontend dist** | 3 | 2 | 1 | 3 | **2.0** | `src/dashboard/frontend/` | The dashboard references `frontend/dist/` but no build output exists. Either: (a) run the Vite build and commit `dist/`, or (b) add a `postinstall` script that builds it. The React app in `src/dashboard/frontend/src/App.tsx` already exists with health-check polling. |
| R16 | **Add `SessionManager.listSessions()`** | 3 | 3 | 1 | 1 | **7.0** | `src/orchestrator/session-manager.ts` | New method that reads `sessions/` dir, parses each `.jsonl` filename for jobId, reads last line for timestamp/status. Returns `Array<{ jobId, eventCount, lastActivity, status }>`. |
| R17 | **Dashboard: add real-time job updates** | 3 | 2 | 1 | 2 | **3.0** | `src/dashboard/server.ts`, `src/dashboard/frontend/src/App.tsx` | Add SSE (Server-Sent Events) or WebSocket endpoint for live job status streaming. The frontend currently polls `/api/health` every 30 seconds — extend this to include job updates. |

### P1 Dependency Graph

```
R16 (SessionManager.listSessions)
└── R14 (Wire /api/jobs)
    └── R17 (Real-time updates)

R11 (zora-agent start)
├── R12 (zora-agent stop)     ─── depends on R11 (pidfile format)
└── R13 (zora-agent status)   ─── depends on R11 (pidfile format)

R15 (Build frontend)    ─── independent
```

### P1 Implementation Order

1. **R12** — `zora-agent stop` (WSJF 9.0, simple)
2. **R16** — `SessionManager.listSessions()` (WSJF 7.0, unblocks R14)
3. **R14** — Wire `/api/jobs` (WSJF 4.5, needs R16)
4. **R13** — `zora-agent status` (WSJF 4.5)
5. **R11** — `zora-agent start` (WSJF 4.0, most complex)
6. **R17** — Real-time updates (WSJF 3.0)
7. **R15** — Build frontend (WSJF 2.0)

**Estimated total: ~14 hours of focused implementation**

---

## P2 — Hardening

**Goal:** Security hardening, observability, and correctness fixes. After P2, the system is ready for team/org deployment.

**Exit criteria:** Express has rate limiting and body size limits, all logs are structured JSON with rotation, integration tests cover the full orchestration flow, and GeminiProvider parses real CLI output correctly.

| # | Work Item | BV | TC | RR | Size | WSJF | Files Touched | Details |
|---|-----------|----|----|-----|------|------|---------------|---------|
| R18 | **Fix GeminiProvider silent error swallowing** | 2 | 2 | 5 | 1 | **9.0** | `src/providers/gemini-provider.ts` | Lines 256 and 272 have empty `catch (e) {}` blocks that silently drop malformed JSON tool calls. Replace with logging + error event emission. This is a **data loss risk** — tool invocations are silently discarded. |
| R19 | **Fix GeminiProvider `checkAuth()`** | 2 | 2 | 4 | 2 | **4.0** | `src/providers/gemini-provider.ts` | Currently only checks `gemini --version` (line 62) — this verifies the binary exists, not that the user is authenticated. Should run `gemini auth status` or equivalent to verify actual auth. |
| R20 | **Test GeminiProvider tool parsing against real output** | 2 | 2 | 4 | 2 | **4.0** | `tests/unit/providers/gemini-provider.test.ts`, `tests/fixtures/` | The XML (`<tool_call>`) and markdown JSON regex patterns in `_parseToolCalls()` were written speculatively — they've never been validated against actual Gemini CLI output. Record real output samples as fixtures and test against them. |
| R21 | **Add Express rate limiting** | 2 | 1 | 5 | 1 | **8.0** | `src/dashboard/server.ts` | Add `express-rate-limit` middleware. Dashboard binds to `127.0.0.1` (good), but has no rate limiting. Default: 100 requests per 15 minutes per IP. |
| R22 | **Add Express body size limits** | 2 | 1 | 4 | 1 | **7.0** | `src/dashboard/server.ts` | `express.json()` on line 36 has no `limit` option — defaults to 100kb but should be explicit. Add `express.json({ limit: '1mb' })` and add a `Content-Length` check. |
| R23 | **Structured logging with rotation** | 3 | 2 | 3 | 3 | **2.7** | `src/utils/logger.ts` (new), multiple files | Replace scattered `console.log/error/warn` calls across the codebase with a structured JSON logger (e.g., pino or winston). Add log rotation. Currently 15+ files use raw `console.*` calls with inconsistent formatting. |
| R24 | **Integration tests for full orchestration** | 3 | 3 | 4 | 4 | **2.5** | `tests/integration/orchestrator-e2e.test.ts` (new) | Boot the Orchestrator with mock providers. Submit a task, verify: Router selected a provider, SessionManager persisted events, MemoryManager context was injected. Simulate a provider failure, verify: FailoverController triggered, RetryQueue enqueued the task. |
| R25 | **Add tests for untested CLI commands** | 2 | 1 | 3 | 3 | **2.0** | `tests/unit/cli/*.test.ts` (new) | 8 CLI command files have zero test coverage: `audit-commands.ts`, `doctor.ts`, `edit-commands.ts`, `memory-commands.ts`, `skill-commands.ts`, `steer-commands.ts`, `team-commands.ts`, and the main `index.ts`. At minimum, test command registration and argument parsing. |
| R26 | **Add tests for Dashboard and TelegramGateway** | 2 | 1 | 3 | 3 | **2.0** | `tests/unit/dashboard/*.test.ts`, `tests/unit/steering/telegram-gateway.test.ts` (new) | Dashboard auth middleware (`auth-middleware.ts`) and server endpoints have no tests. TelegramGateway has security-critical user allowlist logic with no test coverage. |
| R27 | **Fix AuditLogger silent write failures** | 1 | 1 | 4 | 1 | **6.0** | `src/security/audit-logger.ts` | Line 52: `.catch(() => {})` silently swallows all audit write failures. For an **audit log**, silent failure means undetectable data loss. Replace with error emission or fallback write. |
| R28 | **Add GeminiProvider stdout buffer bounds** | 1 | 1 | 3 | 1 | **5.0** | `src/providers/gemini-provider.ts` | `_streamToLines()` accumulates unbounded output in `buffer`. Add a max buffer size (e.g., 50MB) with truncation and warning. A runaway Gemini CLI could consume all available memory. |
| R29 | **Performance benchmarks** | 2 | 1 | 1 | 2 | **2.0** | `tests/benchmarks/` (new) | Baseline metrics: task submission latency, provider selection time, session write throughput, memory context loading time. No benchmarks exist today. |
| R30 | **Fix FlagManager silent file I/O errors** | 1 | 1 | 2 | 1 | **4.0** | `src/steering/flag-manager.ts` | Lines 96-98, 102-104, 132-134, 188-190: four separate empty `catch` blocks that skip malformed flag files. Add logging so operators can detect corrupted state. |

### P2 Priority Order (by WSJF)

1. **R18** — Fix silent error swallowing (WSJF 9.0)
2. **R21** — Express rate limiting (WSJF 8.0)
3. **R22** — Express body size limits (WSJF 7.0)
4. **R27** — Fix AuditLogger silent failures (WSJF 6.0)
5. **R28** — GeminiProvider buffer bounds (WSJF 5.0)
6. **R19** — Fix GeminiProvider checkAuth (WSJF 4.0)
7. **R20** — Test tool parsing against real output (WSJF 4.0)
8. **R30** — Fix FlagManager silent errors (WSJF 4.0)
9. **R23** — Structured logging (WSJF 2.7)
10. **R24** — Integration tests (WSJF 2.5)
11. **R25** — CLI command tests (WSJF 2.0)
12. **R26** — Dashboard/Telegram tests (WSJF 2.0)
13. **R29** — Performance benchmarks (WSJF 2.0)

**Estimated total: ~24 hours of focused implementation**

---

## Summary Table

| Phase | Items | Est. Hours | Exit Criteria | Unlocks |
|-------|-------|------------|---------------|---------|
| **P0** | R1-R10 | ~16h | Orchestrator boots, routes tasks, fails over, retries, persists sessions | Personal automation with multi-provider support |
| **P1** | R11-R17 | ~14h | Real daemon lifecycle, live dashboard with job data | Team/org deployment |
| **P2** | R18-R30 | ~24h | Rate limiting, structured logging, full test coverage, correctness fixes | Mission-critical production |
| **Total** | 30 items | ~54h | | |

---

## Critical Path

The absolute minimum path to a working multi-provider system:

```
R1 (Orchestrator) → R2 (Router) → R3 (Failover) → R8 (Sessions) → R10 (CLI refactor)
```

These 5 items (~10h) transform Zora from "single-provider one-shot" to "multi-provider with failover and persistence." Everything else is important but not blocking.

---

## Known Debt Carried Forward

These items were identified during the audit but are **not** blocking production readiness:

| Item | File | Note |
|------|------|------|
| Router classification uses naive keyword matching | `src/orchestrator/router.ts:80` | Works for v1; can be upgraded to LLM-based classification later |
| Round-robin mode is actually random | `src/orchestrator/router.ts:69` | Functional but misnamed; add a counter for true round-robin |
| RetryQueue uses quadratic backoff, not exponential | `src/orchestrator/retry-queue.ts:75` | Comment says "exponential" but code is `retryCount^2`. Either fix code or comment |
| SecretsManager doesn't use macOS Keychain | `src/security/secrets-manager.ts` | Comment says "in production would use keytar" — AES-256-GCM is fine for now |
| CapabilityTokens empty `allowedTools` means "all allowed" | `src/security/capability-tokens.ts:121` | Intentional default but potentially surprising |
| ClaudeProvider cost tracking accumulates but never resets | `src/providers/claude-provider.ts:154` | Memory leak over very long sessions; add periodic reset |
| Dashboard frontend health poll is hardcoded 30s | `src/dashboard/frontend/src/App.tsx:30` | Make configurable via env var or config |

---

## How to Use This Document

1. **Pick a phase** (P0 first — it blocks everything)
2. **Follow the implementation order** within each phase (respects dependencies and WSJF)
3. **Each work item is self-contained** — it names the files to touch, the problem to fix, and the approach
4. **Check the exit criteria** for each phase before moving on
5. **Carry forward** the "Known Debt" items into your backlog for post-v1.0 cleanup

---

**Assessment date:** 2026-02-13
**Companion documents:** `PRODUCTION_READINESS.md`, `specs/v5/IMPLEMENTATION_PLAN.md`
**Version assessed:** v0.9.0
