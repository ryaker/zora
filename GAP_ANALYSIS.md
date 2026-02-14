# Zora Codebase Gap Analysis

**Date:** 2026-02-14
**Scope:** Full source code review of all 60+ TypeScript source files
**Methodology:** Three-perspective analysis (Architecture, Security, Technical Debt)

---

## Table of Contents

1. [Architecture Gaps](#1-architecture-gaps)
2. [Security Vulnerabilities](#2-security-vulnerabilities)
3. [Technical Debt & Incomplete Implementations](#3-technical-debt--incomplete-implementations)
4. [Dead Code & Unused Subsystems](#4-dead-code--unused-subsystems)
5. [Missing Integration Points](#5-missing-integration-points)
6. [Test Coverage Gaps](#6-test-coverage-gaps)

---

## 1. Architecture Gaps

### 1.1 Orchestrator is a God Object

**File:** `src/orchestrator/orchestrator.ts`
**Lines:** 1-559

The Orchestrator owns and directly instantiates 13 subsystems: Router, FailoverController, RetryQueue, AuthMonitor, SessionManager, SteeringManager, MemoryManager, PolicyEngine, NotificationTools, IntentCapsuleManager, HeartbeatSystem, RoutineManager, and ExecutionLoop. This creates tight coupling — every change to any subsystem potentially affects the Orchestrator.

**Specific issues:**
- Constructor takes the full config tree and distributes it to children — no subsystem-level config isolation
- `boot()` method is 110 lines with sequential initialization that could partially fail, leaving the Orchestrator in an inconsistent state (some systems booted, others not)
- No dependency injection container; all wiring is manual in `boot()`
- No health check for the Orchestrator itself — `_booted` is a simple boolean, not a state machine

### 1.2 FailoverController Creates Internal Router Instances

**File:** `src/orchestrator/failover-controller.ts:60-63`

```typescript
const candidateRouter = new Router({
  providers: candidates,
  mode: 'respect_ranking'
});
```

FailoverController creates a brand-new Router on every failure, discarding any state (cooldowns, health metrics) from the Orchestrator's main Router. The `_router` parameter passed to the constructor is never used (the variable name has an underscore prefix indicating it's unused).

### 1.3 HeartbeatSystem Bypasses Orchestrator Pipeline

**File:** `src/orchestrator/orchestrator.ts:179-185`

HeartbeatSystem is given a standalone ExecutionLoop that bypasses the Orchestrator's routing, failover, memory context, and session persistence. Tasks executed via heartbeat will not:
- Route through the Router
- Trigger failover on failure
- Have memory context injected
- Be persisted in SessionManager

### 1.4 No Graceful Degradation on Partial Boot Failure

**File:** `src/orchestrator/orchestrator.ts:95-205`

If `_memoryManager.init()` fails at line 115, the Router, FailoverController, RetryQueue, AuthMonitor, HeartbeatSystem, and RoutineManager are never initialized — but `_booted` is never set to true, so all subsequent calls will throw "not booted". There's no partial recovery or degraded mode.

### 1.5 Memory Context Loaded on Every Task Submission

**File:** `src/orchestrator/orchestrator.ts:247`

```typescript
const memoryContext = await this._memoryManager.loadContext();
```

Every `submitTask()` call reads from disk (MEMORY.md, daily notes directory, structured memory items, category summaries). For a long-running daemon processing many tasks, this creates an I/O bottleneck. No caching, TTL, or invalidation strategy exists.

### 1.6 Session History Grows Without Bounds

**File:** `src/orchestrator/orchestrator.ts:351`

```typescript
taskContext.history.push(event);
```

Every event during task execution is pushed into the in-memory history array AND persisted to JSONL. For long-running tasks, this creates unbounded memory growth. There is no history pruning, rotation, or retention policy.

### 1.7 RetryQueue Serializes Full TaskContext

**File:** `src/orchestrator/retry-queue.ts:78-91`

The retry queue persists the entire `TaskContext` object (including unbounded `history` array) to JSON. For tasks that have accumulated many events before failing, this can create very large state files.

### 1.8 Dashboard Server Missing `providers` Property

**File:** `src/dashboard/server.ts:124`

```typescript
const providers = this._options.providers ?? [];
```

The `DashboardOptions` interface does not declare a `providers` property, yet the `/api/quota` endpoint accesses `this._options.providers`. This means the quota endpoint always returns an empty array unless someone manually adds providers to the options object. The daemon in `src/cli/daemon.ts` does not pass providers to the dashboard.

### 1.9 Steering Directory Not Sanitized for Path Traversal

**File:** `src/steering/steering-manager.ts:39`

```typescript
const jobDir = path.join(this._steeringDir, message.jobId);
```

Unlike SessionManager which sanitizes jobId (`safeJobId = jobId.replace(/[^a-zA-Z0-9_-]/g, '_')`), SteeringManager uses the raw `jobId` as a directory name. A malicious jobId containing `../` could write steering messages outside the intended directory.

---

## 2. Security Vulnerabilities

### 2.1 GeminiProvider Command Injection via Task Prompt

**File:** `src/providers/gemini-provider.ts:140-146`

```typescript
const args = ['chat', '--prompt', prompt];
const child = spawn(this._cliPath, args);
```

The prompt string is passed directly as a CLI argument to `spawn()`. While `spawn()` with an args array is generally safe against shell injection, the Gemini CLI itself may interpret certain prompt content as commands or options if it has flag-like patterns (e.g., `--model`). The prompt is not sanitized before being passed.

### 2.2 Auth Middleware Not Wired to Dashboard

**File:** `src/dashboard/auth-middleware.ts` + `src/dashboard/server.ts`

The `createAuthMiddleware()` function exists and is exported, but it is **never used** by `DashboardServer`. The dashboard API has zero authentication — anyone with network access to port 7070 can:
- Submit tasks (`POST /api/task`)
- Inject steering messages (`POST /api/steer`)
- Read all job history (`GET /api/jobs`)
- See provider auth status (`GET /api/health`)

### 2.3 Dashboard Binds to Configurable Host Without Validation

**File:** `src/cli/daemon.ts:83`

```typescript
host: process.env.ZORA_BIND_HOST,
```

If `ZORA_BIND_HOST` is set to `0.0.0.0`, the dashboard becomes network-accessible without authentication (see 2.2). There is no warning or validation that binding to a non-loopback address is dangerous.

### 2.4 LeakDetector and PromptDefense Not Integrated

**Files:** `src/security/leak-detector.ts`, `src/security/prompt-defense.ts`

Both `LeakDetector` and `sanitizeInput`/`sanitizeToolOutput`/`validateOutput` from `prompt-defense.ts` are fully implemented but **never called** anywhere in the codebase:
- No provider sanitizes input/output through `sanitizeInput()` or `sanitizeToolOutput()`
- No provider runs `validateOutput()` on tool calls
- `LeakDetector` is never instantiated by Orchestrator, CLI, or Dashboard
- Tool outputs flowing through the system are completely unsanitized

### 2.5 IntegrityGuardian Not Wired to Orchestrator

**File:** `src/security/integrity-guardian.ts`

The `IntegrityGuardian` class can compute SHA-256 baselines of critical files (SOUL.md, MEMORY.md, policy.toml, config.toml) and detect tampering. However:
- It is never instantiated by the Orchestrator
- No periodic integrity checks are scheduled
- The config has `integrity_check: boolean` and `integrity_interval: string` but these are never read by any code
- The `quarantineFile()` method exists but no code path calls it

### 2.6 Capability Tokens Not Enforced

**File:** `src/security/capability-tokens.ts`

`createCapabilityToken()` and `enforceCapability()` are implemented and tested but:
- No code path creates capability tokens for jobs
- No code path enforces capability tokens before tool execution
- The Orchestrator does not create tokens when submitting tasks
- The PolicyEngine's `createCanUseTool()` does not check capability tokens

### 2.7 SecretsManager Not Integrated

**File:** `src/security/secrets-manager.ts`

The SecretsManager provides AES-256-GCM encrypted secrets storage with JIT decryption. However:
- No CLI command exists to manage secrets (store, retrieve, delete, list)
- The Orchestrator does not use SecretsManager to resolve API keys
- Provider configurations store `api_key_env` as a plain string reference, but no code reads the environment variable through SecretsManager
- The `jit_secret_decryption` config flag in SecurityConfig is never checked

### 2.8 Network Policy Never Enforced

**File:** `src/types.ts:358-363`

```typescript
export interface NetworkPolicy {
  allowed_domains: string[];
  denied_domains: string[];
  max_request_size: string;
}
```

The `NetworkPolicy` is defined in the policy schema and parsed from `policy.toml`, but:
- PolicyEngine's `createCanUseTool()` never checks WebSearch or WebFetch URLs against allowed/denied domains
- No HTTP request interceptor validates domain allowlists
- `max_request_size` is never enforced

### 2.9 AuditLogger Not Wired to PolicyEngine

**File:** `src/security/policy-engine.ts:98-100`

```typescript
setAuditLogger(logger: AuditLogger): void {
  this._auditLogger = logger;
}
```

The `setAuditLogger()` method exists but is **never called** in the Orchestrator's `boot()` or anywhere else. This means:
- Dry-run interceptions are not audit-logged
- Budget exceeded events are not audit-logged
- Goal drift detections are not audit-logged
- The audit log only captures tool invocations (via the SDK hook), not policy events

### 2.10 Telegram Gateway Rate Limiting Not Enforced

**File:** `src/steering/telegram-gateway.ts`

The `SteeringConfig` interface includes `rate_limit_per_min?: number` for Telegram, but the `TelegramGateway` class never reads or enforces this value. Any authorized Telegram user can send unlimited steering messages.

### 2.11 SessionManager Directory Created Without Restrictive Permissions

**File:** `src/orchestrator/session-manager.ts:122-126`

```typescript
private _ensureDir(): void {
  if (!fs.existsSync(this._sessionsDir)) {
    fs.mkdirSync(this._sessionsDir, { recursive: true });
  }
}
```

Unlike RetryQueue (`mode: 0o700`) and MemoryManager (`mode: 0o700`), SessionManager creates its directory with default permissions, potentially allowing other users on a shared system to read session history.

---

## 3. Technical Debt & Incomplete Implementations

### 3.1 Pervasive `as any` Type Assertions (28+ instances)

Locations across the codebase where type safety is bypassed:

| File | Line(s) | Context |
|------|---------|---------|
| `orchestrator.ts` | 336, 355, 361 | Steering message access, event content extraction |
| `failover-controller.ts` | 92, 96, 98, 106 | HandoffBundle construction from event history |
| `execution-loop.ts` | 100, 103, 112, 113 | SDK message type casting |
| `claude-provider.ts` | 196, 464-480 | Event content extraction from history |
| `gemini-provider.ts` | 42, 78, 290-291 | Active processes map, parsed data |
| `ollama-provider.ts` | 169, 264-266 | JSON chunk parsing |
| `routine-manager.ts` | 78 | TOML parsed output |
| `dashboard/server.ts` | 124 | Missing `providers` property |

Each `as any` is a potential runtime error if the shape of the data changes.

### 3.2 `OllamaProvider.getUsage()` Returns Zeros

**File:** `src/providers/ollama-provider.ts`

The `OllamaProvider` does not implement `getUsage()` — it always returns zero for all fields. Ollama does provide token usage data in its streaming response (`eval_count`, `prompt_eval_count`) but this is captured in the `done` event content and never aggregated.

### 3.3 Round-Robin Routing Uses `Math.random()`

**File:** `src/orchestrator/router.ts:87-88`

```typescript
case 'round_robin':
  return candidates[Math.floor(Math.random() * candidates.length)]!;
```

The comment says "Simplified round-robin for v1: just pick random from top candidates." This is not round-robin — it's random selection. True round-robin requires state tracking (which provider was last used).

### 3.4 Gemini Tool Call Parsing is Brittle

**File:** `src/providers/gemini-provider.ts:290-330`

Tool call extraction from Gemini output relies on regex parsing of XML patterns and JSON code blocks. This approach:
- Breaks if the output contains nested XML/JSON that matches the patterns
- Cannot distinguish between a tool call the model intended to execute vs. a tool call it was describing
- Has no validation of the parsed tool call structure beyond JSON parse success

### 3.5 Ollama Tool Call Parsing is Identical and Duplicated

**File:** `src/providers/ollama-provider.ts:280-301`

The `_parseToolCalls()` method in OllamaProvider is nearly identical to GeminiProvider's JSON-block parsing. This is copy-pasted code that should be a shared utility.

### 3.6 `_parseIntervalMinutes()` Silently Defaults

**File:** `src/orchestrator/orchestrator.ts:495-505`

```typescript
private _parseIntervalMinutes(interval: string): number {
  const match = interval.match(/^(\d+)(m|h|s)$/);
  if (!match) return 30; // default 30 minutes
```

Invalid interval strings silently fall back to 30 minutes with no warning or logging. This makes misconfiguration hard to debug.

### 3.7 `request_permissions` Tool is a Stub

**File:** `src/orchestrator/orchestrator.ts:447-488`

The `request_permissions` tool handler returns `{ granted: false, pending: true, ... }` with a comment: "The actual approval flow happens outside (CLI prompt, dashboard, etc.)". No code intercepts or completes this approval flow. The tool can never grant permissions.

### 3.8 ExtractionPipeline Never Called

**File:** `src/memory/extraction-pipeline.ts`

The `ExtractionPipeline` class implements schema-guided memory extraction from conversations, but:
- The MemoryManager never creates an ExtractionPipeline instance
- The `auto_extract_interval` in MemoryConfig is never used
- No periodic extraction from session history is scheduled
- The pipeline sits completely dormant

### 3.9 EventTriggerManager Never Instantiated

**File:** `src/routines/event-triggers.ts`

`EventTriggerManager` implements filesystem polling for event-triggered routines but:
- No code creates an instance of it
- No config schema supports defining event triggers
- The RoutineManager only handles cron-based schedules

### 3.10 Dashboard Frontend Does Not Exist

**File:** `src/dashboard/server.ts:53`

```typescript
const staticPath = path.join(__dirname, 'frontend', 'dist');
this._app.use(express.static(staticPath));
```

The server serves static files from `frontend/dist`, but there is only a `vite.config.ts` in `src/dashboard/frontend/` — no actual frontend code (no `index.html`, no React/Vue/etc.). The SPA catch-all route (`res.sendFile('index.html')`) will 404 for every request.

### 3.11 `SteerAck` Type Defined but Never Used

**File:** `src/steering/types.ts:42-46`

The `SteerAck` interface is defined in the type union but no code ever creates a `SteerAck` message. Steering messages are injected but never acknowledged back to the sender.

### 3.12 `JobStatus` Type Defined but Never Used

**File:** `src/steering/types.ts:51-58`

`JobStatus` is defined but not included in the `SteeringMessage` union and no code creates JobStatus objects. The Telegram `/status` command returns a hardcoded "Monitoring active (simulated)" string instead.

### 3.13 WASM Spike is a Hardcoded Report

**File:** `src/wasm/wasmtime-spike.ts`

`evaluateWasmFeasibility()` returns a hardcoded object with notes and recommendations. No actual WASM evaluation occurs. This is exported from the main barrel (`src/index.ts`) as if it were production code.

---

## 4. Dead Code & Unused Subsystems

### 4.1 Complete Subsystems Built but Never Wired

| Subsystem | File(s) | Status |
|-----------|---------|--------|
| LeakDetector | `security/leak-detector.ts` | Implemented, never instantiated |
| PromptDefense | `security/prompt-defense.ts` | Implemented, never called |
| IntegrityGuardian | `security/integrity-guardian.ts` | Implemented, never instantiated |
| CapabilityTokens | `security/capability-tokens.ts` | Implemented, never enforced |
| SecretsManager | `security/secrets-manager.ts` | Implemented, no CLI or integration |
| ExtractionPipeline | `memory/extraction-pipeline.ts` | Implemented, never instantiated |
| EventTriggerManager | `routines/event-triggers.ts` | Implemented, never instantiated |
| AuthMiddleware | `dashboard/auth-middleware.ts` | Implemented, never applied |
| WasmSpike | `wasm/wasmtime-spike.ts` | Hardcoded report, no actual functionality |

### 4.2 Config Fields Parsed but Never Read

| Config Field | Type | Expected Consumer |
|-------------|------|------------------|
| `security.integrity_check` | `boolean` | IntegrityGuardian (not wired) |
| `security.integrity_interval` | `string` | Periodic integrity check (not wired) |
| `security.integrity_includes_tool_registry` | `boolean` | IntegrityGuardian (not wired) |
| `security.leak_detection` | `boolean` | LeakDetector (not wired) |
| `security.sanitize_untrusted_content` | `boolean` | PromptDefense (not wired) |
| `security.jit_secret_decryption` | `boolean` | SecretsManager (not wired) |
| `memory.auto_extract_interval` | `number` | ExtractionPipeline (not wired) |
| `agent.resources.cpu_throttle_percent` | `number` | Not implemented |
| `agent.resources.memory_limit_mb` | `number` | Not implemented |
| `agent.resources.throttle_check_interval` | `string` | Not implemented |

---

## 5. Missing Integration Points

### 5.1 Orchestrator → AuditLogger

The Orchestrator's `boot()` method creates a PolicyEngine but never creates or wires an AuditLogger. The AuditLogger SDK hook (`createPostToolUseHook()`) is never registered. Tool invocations are not audit-logged.

### 5.2 Orchestrator → IntegrityGuardian

No periodic integrity checking is scheduled despite config fields existing for it.

### 5.3 Orchestrator → LeakDetector

Provider outputs are never scanned for leaked secrets before being returned to the user or persisted in session history.

### 5.4 Orchestrator → PromptDefense

User inputs and tool outputs are never sanitized through the prompt injection defense system.

### 5.5 PolicyEngine → NetworkPolicy

WebSearch and WebFetch tool calls pass through `createCanUseTool()` without any domain validation.

### 5.6 Dashboard → AuthMiddleware

The dashboard API is completely unauthenticated.

### 5.7 Dashboard → Providers

The quota endpoint cannot display provider status because providers are not passed to the dashboard.

### 5.8 RoutineManager → EventTriggerManager

Only cron-based scheduling exists. Event-triggered routines are not supported.

### 5.9 MemoryManager → ExtractionPipeline

No automatic memory extraction from conversation history.

### 5.10 CLI → SecretsManager

No CLI commands for secret management (store, get, delete, list).

---

## 6. Test Coverage Gaps

### 6.1 No Integration Test for Full Orchestrator Pipeline

The existing `tests/integration/orchestrator-e2e.test.ts` exists but there is no test that exercises:
- `submitTask()` → Router → Provider → SessionManager → MemoryManager → done
- Failover path: Provider failure → FailoverController → second provider
- Retry path: Provider failure → RetryQueue → poll → re-submit

### 6.2 No Test for Dashboard API Endpoints

`tests/unit/dashboard/` contains tests but needs verification that all API routes are covered:
- `POST /api/task`
- `POST /api/steer`
- `GET /api/events` (SSE)
- `GET /api/quota` (broken — no providers)

### 6.3 No Test for Daemon Lifecycle

No test covers:
- `zora-agent start` → daemon fork → `boot()` → dashboard start
- `zora-agent stop` → SIGTERM → graceful shutdown → pidfile cleanup
- Stale pidfile recovery

### 6.4 Security Subsystems Tested in Isolation but Not in Integration

All security modules have unit tests, but there are no tests verifying:
- PolicyEngine actually blocks a tool call in the SDK execution context
- AuditLogger actually logs entries during a real task execution
- IntentCapsule drift detection fires during a real task

---

## Summary Statistics

| Category | Count |
|----------|-------|
| Architecture gaps | 9 |
| Security vulnerabilities | 11 |
| Technical debt items | 13 |
| Dead/unused subsystems | 9 |
| Missing integration points | 10 |
| Test coverage gaps | 4 |
| **Total identified gaps** | **56** |
