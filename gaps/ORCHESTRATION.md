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

