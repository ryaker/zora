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

---

