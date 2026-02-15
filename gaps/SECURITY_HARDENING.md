# Security Hardening & Post-Release Quality Gaps

> **Source:** Independent codebase review (2026-02-15), vetted against current code.
> Only gaps confirmed as still present in the codebase are listed here.

---

## SEC-01: Dashboard API Unauthenticated

**Files:** `src/dashboard/server.ts`, `src/dashboard/auth-middleware.ts`
**Severity:** S1

`auth-middleware.ts` implements timing-safe Bearer token validation but is never mounted in `server.ts`. All API endpoints are public: `POST /api/task`, `POST /api/steer`, `GET /api/events` (SSE), `GET /api/quota`, `/api/jobs`, `/api/system`.

**Fix:** Mount auth middleware on all non-health routes. Add Bearer token to frontend axios calls. The middleware is already written and tested -- just needs to be wired.

---

## SEC-02: Path Traversal via Unsanitized jobId

**Files:** `src/steering/steering-manager.ts`, `src/steering/flag-manager.ts`
**Severity:** S1

`jobId` parameter used directly in `path.join()` for file path construction without validation. A crafted `jobId` containing `../` could write files outside the steering directory.

**Fix:** Validate jobId format (alphanumeric + hyphens only) before any path construction. Add a shared `validateJobId()` util.

---

## SEC-03: Security Components Never Instantiated

**Files:** `src/orchestrator/orchestrator.ts`, `src/security/*.ts`
**Severity:** S2

Four security modules exist as working code but are never imported or called by the orchestrator:
- `LeakDetector` -- scans for API keys, private keys in outputs
- `PromptDefense` -- 23 injection detection patterns
- `SecretsManager` -- encrypted credential storage
- `IntegrityGuardian` -- file hash baselines

**Fix:** Wire into orchestrator boot sequence. Call `sanitizeInput()` in submitTask, `validateOutput()` in execution-loop event processing, scan tool outputs before yielding.

---

## SEC-04: TOCTOU in Symlink Validation

**File:** `src/security/policy-engine.ts` (now `shell-validator.ts`)
**Severity:** S3

Symlink target resolved and validated, but target could change between validation and file operation.

**Fix:** Use `O_NOFOLLOW` flags or validate at operation time rather than ahead-of-time.

---

## PROV-01: Quota Status Always Returns Healthy

**Files:** All provider files
**Severity:** S2

All three providers return hardcoded `healthScore: 1.0, isExhausted: false` from `getQuotaStatus()`. Router cannot make informed decisions about provider health.

**Fix:** Track actual usage counts. Detect quota/rate-limit headers from API responses. Update health scores based on real data.

---

## PROV-02: No Circuit Breaker on Provider Failures

**Files:** All provider files
**Severity:** S2

Repeated errors don't deactivate providers. Failed requests continue until orchestrator failover (which only works once per task).

**Fix:** Implement circuit breaker pattern: open after N failures in time window, half-open after cooldown.

---

## OPS-06: Retry Backoff Has No Cap

**File:** `src/orchestrator/retry-queue.ts:81`
**Severity:** S2

Backoff formula: `Math.pow(retryCount, 2) * 60_000ms` (quadratic). Retry 10 = 100 min. Retry 20 = 400,000 min. No upper cap. Also, `Invalid Date` from deserialization causes silent permanent stuck.

**Fix:** Cap backoff at 24 hours. Validate Date on deserialization. Guard against `NaN` from `getTime()`.

---

## OPS-07: Daemon Shutdown Has No Timeout

**File:** `src/cli/daemon.ts`
**Severity:** S2

Shutdown sequence (Telegram -> dashboard -> orchestrator -> PID cleanup) has no overall timeout. Any hung step = zombie daemon holding PID file.

**Fix:** Add 30-second shutdown timeout. Force-exit after timeout.

---

## OPS-08: jobId Uses Date.now + Random

**File:** `src/cli/daemon.ts:78`
**Severity:** S3

`job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}` has collision risk under concurrent load.

**Fix:** Use `crypto.randomUUID()` instead.

---

## DASH-01: SSE Has No Reconnection Logic

**File:** `src/dashboard/frontend/src/App.tsx:275`
**Severity:** S3

`EventSource.onerror` logs a warning but doesn't reconnect. User sees stale data forever after disconnect.

**Fix:** Implement reconnection with exponential backoff. Show connection status indicator.

---

## STEER-01: Telegram /status Returns Hardcoded Response

**File:** `src/steering/telegram-gateway.ts:123`
**Severity:** S3

`/status <jobId>` returns `"Monitoring active (simulated)"` instead of querying SessionManager.

**Fix:** Wire to `sessionManager.getSession(jobId)` for real status.

---

## MEM-16: Item Cache Unbounded Growth

**File:** `src/memory/structured-memory.ts:35`
**Severity:** S3

`_itemCache: Map<string, MemoryItem>` grows without bound. Long-running processes with 10k+ items cause memory spikes.

**Fix:** Implement LRU cache with configurable max size (e.g., 1000 entries).

---

## ROUT-01: Heartbeat Tasks Bypass Policy Validation

**File:** `src/routines/heartbeat.ts`
**Severity:** S2

HEARTBEAT.md tasks (unchecked markdown checkboxes) executed as LLM prompts without policy enforcement, cost limits, or approval. Any write to HEARTBEAT.md = task execution.

**Fix:** Route heartbeat tasks through PolicyEngine. Add cost ceiling per heartbeat cycle.

---

## MEM-17: MCP Bridge to Mem0/OpenMemory Not Implemented

**Files:** `src/memory/`, `src/config/`
**Severity:** S3

No integration with Mem0 or OpenMemory MCP servers. Memory is local-only (file-based). Blocks cloud sync and cross-device memory sharing.

**Fix:** Add MCP client bridge that syncs local memory items to a configured Mem0 endpoint.

---

## MEM-18: No SHA-256 Integrity Baselines on MEMORY.md

**Files:** `src/memory/`, `src/security/integrity-guardian.ts`
**Severity:** S3

Read-only enforcement on MEMORY.md is filesystem-level only. No hash verification to detect tampering. IntegrityGuardian exists but isn't wired for memory files.

**Fix:** Generate SHA-256 baselines for MEMORY.md on creation. Verify on each read. Wire IntegrityGuardian.
