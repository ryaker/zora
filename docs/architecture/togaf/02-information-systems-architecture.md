# Information Systems Architecture
## TOGAF ADM Phase C --- Zora Agent Framework

**Document ID:** TOGAF-ISA-001  
**Version:** 1.0  
**Date:** 2026-02-25  
**Status:** Approved (scope note below)  

> **Scope note (2026-08).** This catalog was compiled at v0.6-era scope and has
> not been extended since. It does not cover the subsystems added afterwards:
> `src/channels/**` (ChannelManager pipeline, `CapabilitySet`, `StructuredIntent`,
> Signal and Telegram adapters), `src/skills/**`, `src/teams/**`,
> `src/routines/**`, `src/steering/**`, TLCI dispatch, or the SDK hook bridge
> added in SEC-21. Treat the tables below as accurate for what they list and
> incomplete for the rest; `CLAUDE.md` has the current module map.

---

## 1. Application Component Catalog

Derived from actual imports in src/orchestrator/orchestrator.ts and src/types.ts.

| TOGAF Component | Zora Class | Source File | Interface / Implements | Purpose |
|---|---|---|---|---|
| **Orchestration Controller** | Orchestrator | src/orchestrator/orchestrator.ts | OrchestratorOptions | Central controller: boots all components, owns submitTask() lifecycle |
| **Task Router** | Router | src/orchestrator/router.ts | RouterOptions | Selects best LLMProvider by RoutingMode, ProviderCapability, CostTier |
| **Failover Manager** | FailoverController | src/orchestrator/failover-controller.ts | FailoverConfig | Circuit breaker, error classification, HandoffBundle creation |
| **Retry Manager** | RetryQueue | src/orchestrator/retry-queue.ts | --- | Exponential backoff queue for transient failures |
| **Auth Monitor** | AuthMonitor | src/orchestrator/auth-monitor.ts | --- | Polls provider auth status; triggers failover on expiry |
| **Session Persistence** | SessionManager | src/orchestrator/session-manager.ts | --- | JSONL event stream writer per job; BufferedSessionWriter batches writes |
| **Execution Engine** | ExecutionLoop | src/orchestrator/execution-loop.ts | CustomToolDefinition | SDK turn loop; wires canUseTool callback; streams AgentEvents |
| **Error Pattern Detector** | ErrorPatternDetector | src/orchestrator/error-pattern-detector.ts | --- | Classifies repeated error patterns to guide failover decisions |
| **Policy Gate** | PolicyEngine | src/security/policy-engine.ts | ZoraPolicy, ValidationResult | Intercepts every tool call; validates paths, commands, budget, drift |
| **Audit Logger** | AuditLogger | src/security/audit-logger.ts | AuditEntryInput | Append-only SHA-256 hash-chained JSONL; verifyChain() integrity check |
| **Intent Guard** | IntentCapsuleManager | src/security/intent-capsule.ts | IntentCapsule | HMAC-SHA256 signed mandates; checkDrift() per action |
| **Leak Scanner** | LeakDetector | src/security/leak-detector.ts | LeakPattern, LeakMatch | Regex-based secret/PII detection and redaction |
| **Prompt Sanitizer** | PromptDefense (sanitizeInput) | src/security/prompt-defense.ts | --- | Injection pattern detection; wraps untrusted content in XML tags |
| **Integrity Checker** | IntegrityGuardian | src/security/integrity-guardian.ts | IntegrityBaseline | SHA-256 baselines for SOUL.md, MEMORY.md, policy.toml, config.toml |
| **Capability Tokens** | createCapabilityToken | src/security/capability-tokens.ts | WorkerCapabilityToken | Scoped per-job capability bundles derived from ZoraPolicy |
| **Shell Validator** | shellTokenize / splitChainedCommands | src/security/shell-validator.ts | --- | Tokenizes and splits chained shell commands for allowlist validation |
| **Memory Manager** | MemoryManager | src/memory/memory-manager.ts | MemoryConfig | Aggregates 3-tier memory context: MEMORY.md, daily notes, structured items |
| **Structured Memory** | StructuredMemory | src/memory/structured-memory.ts | MemoryItem | JSON-file-based structured memory item store |
| **Salience Scorer** | SalienceScorer | src/memory/salience-scorer.ts | SalienceScore | access_count + recency decay + source trust bonus scoring |
| **Category Organizer** | CategoryOrganizer | src/memory/category-organizer.ts | CategorySummary | Groups memory items into named categories with summaries |
| **Extraction Pipeline** | ExtractionPipeline | src/memory/extraction-pipeline.ts | ExtractionResult | Schema-guided extraction of MemoryItems from conversation text |
| **Context Compressor** | ContextCompressor | src/memory/context-compressor.ts | --- | Compresses long context windows for token budget management |
| **Validation Pipeline** | ValidationPipeline | src/memory/validation-pipeline.ts | --- | Validates extracted memory items against MemoryItem schema |
| **Observation Store** | ObservationStore | src/memory/observation-store.ts | --- | Stores raw observations from agent execution for later extraction |
| **Claude Backend** | ClaudeProvider | src/providers/claude-provider.ts | LLMProvider | Anthropic Claude Agent SDK wrapper; streaming event translation |
| **Gemini Backend** | GeminiProvider | src/providers/gemini-provider.ts | LLMProvider | gemini-cli subprocess wrapper; stdout streaming parser |
| **Ollama Backend** | OllamaProvider | src/providers/ollama-provider.ts | LLMProvider | Ollama REST API client; /api/chat streaming |
| **Circuit Breaker** | CircuitBreaker | src/providers/circuit-breaker.ts | CircuitBreakerOptions | CLOSED/OPEN/HALF_OPEN state machine; failure threshold + cooldown |
| **Dashboard Server** | DashboardServer | src/dashboard/server.ts | DashboardOptions | Express REST API + SSE event stream; port configurable via `steering.dashboard_port` in config.toml (default 8070) |
| **Auth Middleware** | createAuthMiddleware | src/dashboard/auth-middleware.ts | --- | Bearer token validation for dashboard API routes |
| **Telegram Gateway** | TelegramGateway | src/steering/telegram-gateway.ts | TelegramConfig | Long-polling Telegram Bot API; injects steer messages |
| **Steering Manager** | SteeringManager | src/steering/steering-manager.ts | --- | Routes steering commands to active execution loops |
| **Steer Injector** | SteerInjector | src/steering/steer-injector.ts | --- | Injects mid-task steering into Claude SDK session |
| **Flag Manager** | FlagManager | src/steering/flag-manager.ts | --- | Manages pause/stop/redirect flags for in-flight tasks |
| **Team Manager** | TeamManager | src/teams/team-manager.ts | TeamConfig | Creates and tears down multi-agent teams with filesystem-based mailboxes |
| **Mailbox** | Mailbox | src/teams/mailbox.ts | MailboxMessage | Filesystem inbox per agent: teams/<name>/inboxes/<agentId>.json |
| **Agent Loader** | AgentLoader | src/teams/agent-loader.ts | AgentMember | Launches and manages sub-agent processes |
| **Team Mailbox Channel** | MailboxChannelAdapter | src/channels/team/mailbox-channel-adapter.ts | ChannelMessage | Presents a team inbox as a channel so delegated tasks traverse the ChannelManager pipeline (INVARIANT-9). Replaced GeminiBridge, which ran inbox messages as a subprocess, bypassing it |
| **Routine Manager** | RoutineManager | src/routines/routine-manager.ts | RoutineDefinition | node-cron scheduler for recurring tasks |
| **Heartbeat System** | HeartbeatSystem | src/routines/heartbeat.ts | --- | Periodic health checks; triggers RoutineManager tasks |
| **Hook Runner** | HookRunner | src/hooks/hook-runner.ts | OnTaskStartHook, BeforeToolExecuteHook, AfterToolExecuteHook | Lifecycle hook dispatcher for user-defined interceptors |
| **Config Loader** | loadConfig | src/config/loader.ts | ZoraConfig | smol-toml parser; merges config.toml with DEFAULT_* values |
| **Policy Loader** | loadPolicy | src/config/policy-loader.ts | ZoraPolicy | smol-toml parser; loads policy.toml with safe defaults |
| **Skill Loader** | SkillLoader | src/skills/skill-loader.ts | LayeredSkillInfo | Three-layer skill discovery: project > global > builtin |
| **Negative Cache** | NegativeCache | src/services/negative-cache.ts | --- | Caches recently-denied tool calls to avoid redundant policy checks |
| **Error Normalizer** | ErrorNormalizer | src/lib/error-normalizer.ts | --- | Normalizes errors from SDK, subprocess, and REST providers to common format |

---

## 2. Data Entity Catalog

| Entity | TypeScript Type | Source | Storage | Description |
|---|---|---|---|---|
| **ProviderCapability** | type ProviderCapability | src/types.ts | in-memory | Capability tags: reasoning, coding, creative, structured-data, large-context, search, fast |
| **CostTier** | type CostTier | src/types.ts | in-memory | Cost classification: free, included, metered, premium |
| **RoutingMode** | type RoutingMode | src/types.ts | config.toml | Provider selection strategy: respect_ranking, optimize_cost, provider_only, round_robin |
| **AuthStatus** | interface AuthStatus | src/types.ts | in-memory | Provider authentication health: valid, expiresAt, canAutoRefresh, requiresInteraction |
| **QuotaStatus** | interface QuotaStatus | src/types.ts | in-memory | Rate-limit state: isExhausted, remainingRequests, cooldownUntil, healthScore |
| **AgentEvent** | interface AgentEvent | src/types.ts | sessions/jobId.jsonl | Streaming event from execution: type, content, sessionId, jobId, timestamp |
| **AgentEventType** | type AgentEventType | src/types.ts | sessions/jobId.jsonl | Event taxonomy: thinking, tool_call, tool_result, text, error, done, steering, task.start, task.end, turn.start, turn.end, text.delta, tool.start, tool.end |
| **TaskContext** | interface TaskContext | src/types.ts | in-memory | Task execution context: prompt, sessionId, jobId, provider, capabilities, modelPreference, memoryContext, routineContext, maxTurns, abortSignal |
| **LLMProvider** | interface LLMProvider | src/types.ts | in-memory | Provider abstraction: name, rank, capabilities, costTier, isAvailable(), checkAuth(), getQuotaStatus(), execute(), abort() |
| **HandoffBundle** | interface HandoffBundle | src/types.ts | in-memory | Provider transition: fromProvider, toProvider, partialResult, toolCallHistory, checkpointReason |
| **AuditEvent** | interface AuditEvent | src/types.ts | audit/audit.jsonl | Raw audit event before hash-chaining |
| **AuditEntry** | interface AuditEntry | src/security/security-types.ts | audit/audit.jsonl | Full audit record: entryId, timestamp, eventType, jobId, sessionId, data, previousHash, hash |
| **AuditEntryEventType** | type AuditEntryEventType | src/security/security-types.ts | audit/audit.jsonl | Audit event taxonomy: task.start, task.end, tool.call, tool.result, policy.allow, policy.deny, memory.extract, failover, steer |
| **IntentCapsule** | interface IntentCapsule | src/security/security-types.ts | in-memory per task | HMAC-SHA256 signed mandate bundle: capsuleId, mandate, mandateHash, mandateKeywords, allowedActionCategories, signature, createdAt, expiresAt |
| **DriftCheckResult** | interface DriftCheckResult | src/security/security-types.ts | in-memory | Drift analysis result: aligned, reason, driftScore, actionKeywords, matchedKeywords |
| **BudgetStatus** | interface BudgetStatus | src/security/security-types.ts | in-memory | Per-session budget tracking: totalActions, actionsRemaining, tokenBudgetUsed, byActionType |
| **WorkerCapabilityToken** | interface WorkerCapabilityToken | src/types.ts | in-memory | Scoped capability grant: jobId, allowedPaths, deniedPaths, allowedCommands, allowedTools, maxExecutionTime, createdAt, expiresAt |
| **MemoryItem** | interface MemoryItem | src/memory/memory-types.ts | memory/items/ | Structured memory record: id, type, summary, source, source_type, created_at, last_accessed, access_count, reinforcement_score, tags, category |
| **MemoryItemType** | type MemoryItemType | src/memory/memory-types.ts | memory/items/ | Memory classification: profile, event, knowledge, behavior, skill, tool |
| **SalienceScore** | interface SalienceScore | src/memory/memory-types.ts | in-memory | Salience computation: itemId, score, components (accessWeight, recencyDecay, relevanceScore, sourceTrustBonus) |
| **CategorySummary** | interface CategorySummary | src/memory/memory-types.ts | memory/categories/ | Category metadata: category, summary, item_count, last_updated, member_item_ids |
| **ZoraConfig** | interface ZoraConfig | src/types.ts | config.toml | Top-level config: agent, providers, routing, failover, memory, security, steering, notifications, mcp, hooks, routines |
| **ZoraPolicy** | interface ZoraPolicy | src/types.ts | policy.toml | Security policy: filesystem, shell, actions, network, budget, dry_run |
| **FilesystemPolicy** | interface FilesystemPolicy | src/types.ts | policy.toml | Path allowlist/denylist, follow_symlinks flag |
| **ShellPolicy** | interface ShellPolicy | src/types.ts | policy.toml | Shell mode (allowlist/denylist/deny_all), allowed_commands, denied_commands, max_execution_time |
| **BudgetPolicy** | interface BudgetPolicy | src/types.ts | policy.toml | Per-session limits: max_actions_total, max_actions_by_type, max_tokens_total |
| **TeamConfig** | interface TeamConfig | src/teams/team-types.ts | teams/<name>/config.json | Multi-agent team: name, members, coordinatorId, persistent, prNumber |
| **AgentMember** | interface AgentMember | src/teams/team-types.ts | teams/<name>/config.json | Team member spec: agentId, name, provider, model, cwd, capabilities |
| **MailboxMessage** | interface MailboxMessage | src/teams/team-types.ts | teams/<name>/inboxes/ | Inter-agent message: from, text, timestamp, read, type, metadata |
| **RoutineDefinition** | interface RoutineDefinition | src/types.ts | routines/<name>.toml | Scheduled task: name, prompt, cron, model, max_cost_tier, timeout |
| **HookConfigEntry** | interface HookConfigEntry | src/types.ts | config.toml [hooks] | Lifecycle hook: event, command, timeout |

---

## 3. Application Interaction Map

    Orchestrator
      |-- instantiates --> Router, FailoverController, RetryQueue, AuthMonitor
      |-- instantiates --> SessionManager, ExecutionLoop
      |-- instantiates --> PolicyEngine, IntentCapsuleManager, LeakDetector, PromptDefense
      |-- instantiates --> MemoryManager, ExtractionPipeline, ValidationPipeline
      |-- instantiates --> SteeringManager, TelegramGateway
      |-- instantiates --> HeartbeatSystem, RoutineManager
      |-- instantiates --> HookRunner
      |-- instantiates --> DashboardServer, TeamManager

    ExecutionLoop
      |-- calls --> PolicyEngine.canUseTool() [before every tool]
      |-- calls --> AuditLogger.log() [task.start, tool.call, tool.result, task.end]
      |-- calls --> IntentCapsuleManager.checkDrift() [via PolicyEngine]
      |-- calls --> LeakDetector.scan() [on tool output]

    Router
      |-- reads --> LLMProvider.isAvailable()
      |-- reads --> LLMProvider.getQuotaStatus()
      |-- returns --> LLMProvider (best match by capability + cost + rank)

    FailoverController
      |-- uses --> Router [to select next provider]
      |-- creates --> HandoffBundle [context for provider transition]
      |-- uses --> CircuitBreaker [per provider]

    MemoryManager
      |-- uses --> StructuredMemory [item CRUD]
      |-- uses --> SalienceScorer [ranking]
      |-- uses --> CategoryOrganizer [grouping]
      |-- uses --> ExtractionPipeline [LLM-powered extraction]
      |-- uses --> ContextCompressor [token budget management]
