# Technology Architecture
## TOGAF ADM Phase D --- Zora Agent Framework

**Document ID:** TOGAF-TA-001  
**Version:** 1.0  
**Date:** 2026-02-25  
**Status:** Approved  

---

## 1. Technology Portfolio Catalog

### 1.1 Runtime Platform

| Technology | Version | Role | Source |
|---|---|---|---|
| **Node.js** | >= 20.0.0 | Primary runtime; ESM module system | package.json engines |
| **TypeScript** | ^5.7.0 | Type-safe source; compiled to dist/ | devDependencies |
| **tsx** | ^4.19.0 | Development runtime (no compile step) | devDependencies |

### 1.2 Production Dependencies

| Package | Version | Purpose | Used In |
|---|---|---|---|
| @anthropic-ai/claude-agent-sdk | ^0.3.232 | Claude LLM execution, streaming, in-process MCP tool server, PreToolUse/PostToolUse hooks | src/providers/claude-provider.ts, src/tools/zora-mcp-server.ts, src/hooks/sdk-hook-bridge.ts |
| commander | ^14.0.3 | CLI argument parsing | src/cli/index.ts |
| express | ^4.21.2 | Dashboard REST API server | src/dashboard/server.ts |
| pino | ^10.3.1 | Structured JSON logger | src/utils/logger.ts |
| pino-pretty | ^13.1.3 | Development log formatter | src/utils/logger.ts |
| smol-toml | ^1.3.1 | TOML configuration parser (zero native deps) | src/config/loader.ts, src/config/policy-loader.ts |
| zod | ^4.3.6 | Runtime schema validation | config/policy validation |
| minisearch | ^7.2.0 | In-memory full-text search for memory retrieval | src/memory/ |
| node-cron | ^4.2.1 | Cron expression scheduler for routines | src/routines/routine-manager.ts |
| @clack/prompts | ^1.0.1 | Interactive CLI prompts for init | src/cli/init-command.ts |
| casbin | ^5.49.0 | Channel authorization model (per-channel policy gate) | src/channels/channel-policy-gate.ts |
| @nodesecure/js-x-ray | ^13.0.0 | Static supply-chain analysis of installed skills | src/skills/skill-scanner.ts |
| adm-zip | ^0.5.16 | Skill archive extraction | src/skills/skill-installer.ts |
| @chat-adapter/telegram | ^4.19.0 | Telegram channel adapter | src/channels/telegram/telegram-adapter.ts |

### 1.3 Peer / Optional Dependencies

| Package | Version | Purpose | Used In |
|---|---|---|---|
| node-telegram-bot-api | ^0.67.0 | Telegram Bot long-polling (optional) | src/steering/telegram-gateway.ts |

### 1.4 Dev / Test Dependencies

| Package | Version | Purpose |
|---|---|---|
| vitest | ^3.0.0 | Unit test runner |
| @playwright/test | ^1.58.2 | Browser/E2E tests for dashboard |
| supertest | ^7.2.2 | HTTP API testing |
| @types/express | ^4.17.21 | TypeScript types for Express |
| @types/node | ^22.19.11 | TypeScript types for Node.js |

---

## 2. LLM Provider Technology Catalog

| Provider | Type | Authentication | Protocol | Cost Tier | Key Capabilities | Source File |
|---|---|---|---|---|---|---|
| **Claude (Anthropic)** | claude-sdk | Existing Claude Code session (no API key) | Embedded SDK + streaming events | included | reasoning, coding, creative, structured-data, large-context | src/providers/claude-provider.ts |
| **Gemini (Google)** | gemini-cli | Google Workspace account (gcloud auth) | gemini CLI subprocess; prompt written to child stdin (SEC-22), stdout parsed | free | reasoning, search, large-context | src/providers/gemini-provider.ts |
| **Ollama (Local)** | ollama | None (local service) | REST HTTP /api/chat streaming | free | coding, fast, creative | src/providers/ollama-provider.ts |
| **Echo (test stub)** | echo | None | In-process; deterministic replies | free | -- | src/providers/echo-provider.ts |

The `echo` provider exists for the e2e scenario harness and CI. It is not a
production backend; see `docs/testing/e2e-cross-llm-evaluation.md`.

### 2.1 Provider Failover Technology Stack

| Component | Technology | Configuration |
|---|---|---|
| Circuit Breaker | CircuitBreaker class (src/providers/circuit-breaker.ts) | failureThreshold: 3, failureWindowMs: 60000, cooldownMs: 30000 |
| Retry Queue | RetryQueue class (src/orchestrator/retry-queue.ts) | max_retries: 3 (DEFAULT_FAILOVER) |
| Auth Monitor | AuthMonitor class (src/orchestrator/auth-monitor.ts) | polls provider.checkAuth() |
| Error Classifier | FailoverController.classifyError() (src/orchestrator/failover-controller.ts) | categories: rate_limit, quota, auth, timeout, transient, permanent, unknown |

---

## 3. Security Technology Stack

| Security Control | Technology | Algorithm / Standard | Source File |
|---|---|---|---|
| **Audit Chain Integrity** | AuditLogger | SHA-256 (node:crypto createHash) per entry + GENESIS_HASH seed | src/security/audit-logger.ts |
| **Intent Signing** | IntentCapsuleManager | HMAC-SHA256 (node:crypto createHmac) over capsule payload | src/security/intent-capsule.ts |
| **File Integrity** | IntegrityGuardian | SHA-256 (node:crypto createHash) baselines for SOUL.md, MEMORY.md, policy.toml, config.toml | src/security/integrity-guardian.ts |
| **Secret Detection** | LeakDetector | Regex patterns: OpenAI/Anthropic keys (sk-), Google keys (AIza), GitHub tokens (ghp_), JWT, AWS keys (AKIA/ASIA), private key headers, password assignments | src/security/leak-detector.ts |
| **Prompt Injection Defense** | sanitizeInput / validateOutput | Pattern matching: ignore previous instructions, you are now, INST, <<SYS>>, encoded variants (base64/hex) | src/security/prompt-defense.ts |
| **Shell Validation** | shellTokenize / splitChainedCommands / extractBaseCommand | Tokenization + chained command split (&&, ||, ;, |) | src/security/shell-validator.ts |
| **Policy Serialization** | writePolicyFile / getPolicySummary | TOML via smol-toml | src/security/policy-serializer.ts |
| **Capability Scoping** | createCapabilityToken / enforceCapability | 30-minute expiring scoped tokens derived from ZoraPolicy | src/security/capability-tokens.ts |
| **Bearer Token Auth** | createAuthMiddleware | HTTP Authorization: Bearer <token> header validation | src/dashboard/auth-middleware.ts |
| **Pre-execution Tool Gate (1)** | SdkHookBridge -> ToolHookRunner | SDK `PreToolUse` hook; deny short-circuits ahead of `canUseTool`; fails closed; may rewrite arguments via `updatedInput` | src/hooks/sdk-hook-bridge.ts, src/hooks/tool-hook-runner.ts |
| **Pre-execution Tool Gate (2)** | PolicyEngine.createCanUseTool + capability tokens | SDK `canUseTool` under `permissionMode: 'default'` | src/security/policy-engine.ts, src/security/capability-tokens.ts |
| **Post-execution Observation** | ToolHookRunner.runAfter | SDK `PostToolUse` hook; audit, leak scan, negative cache | src/hooks/sdk-hook-bridge.ts |

---

## 4. Storage Technology Stack

| Data Type | Format | Technology | Location | Notes |
|---|---|---|---|---|
| Configuration | TOML | smol-toml | ~/.zora/config.toml | Human-editable; typed via ZoraConfig |
| Security Policy | TOML | smol-toml | ~/.zora/policy.toml | Human-editable; typed via ZoraPolicy |
| Session Events | JSONL | node:fs/promises | ~/.zora/sessions/<jobId>.jsonl | Append-only; one AgentEvent per line |
| Audit Log | JSONL + SHA-256 chain | node:crypto + node:fs/promises | ~/.zora/audit/audit.jsonl | Append-only; tamper-evident |
| Memory Items | JSON | node:fs/promises | ~/.zora/memory/items/ | One file per MemoryItem |
| Category Summaries | JSON | node:fs/promises | ~/.zora/memory/categories/ | One file per CategorySummary |
| Long-term Memory | Markdown | node:fs/promises | ~/.zora/memory/MEMORY.md | Human-readable; SHA-256 baseline checked |
| Daily Notes | Markdown | node:fs/promises | ~/.zora/memory/daily/YYYY-MM-DD.md | Rolling daily context |
| Retry Queue | JSON | node:fs/promises (atomic write) | ~/.zora/retry/retry-queue.json | Atomic write via rename |
| Routine State | JSON | node:fs/promises | ~/.zora/routines/<name>.json | Per-routine execution state |
| Team Config | JSON | node:fs/promises | ~/.zora/teams/<name>/config.json | Multi-agent team definitions |
| Integrity Baselines | JSON | node:fs/promises | ~/.zora/state/integrity-baselines.json | SHA-256 hashes of critical files |
| PID File | text | node:fs | ~/.zora/daemon.pid | Prevents duplicate daemon instances |

---

## 5. Network Architecture

| Interface | Protocol | Endpoint | Direction | Authentication |
|---|---|---|---|---|
| Dashboard REST API | HTTP | localhost:8070/api/* | inbound | Optional Bearer token (dashboardToken config) |
| Dashboard SSE Stream | HTTP + SSE | localhost:8070/api/events | inbound | Same Bearer token |
| Dashboard Static UI | HTTP | localhost:8070/ | inbound | Same Bearer token |
| Claude SDK | HTTPS | api.anthropic.com (via SDK) | outbound | Existing Claude Code session token |
| Gemini CLI | HTTPS | generativelanguage.googleapis.com (via gemini subprocess) | outbound | Google Workspace gcloud auth |
| Ollama REST | HTTP | localhost:11434/api/chat | local | None |
| Telegram Long Polling | HTTPS | api.telegram.org | outbound | Bot token (config.toml telegram.bot_token) |

---

## 6. Infrastructure Reference Architecture

### 6.1 Single-User Developer Deployment

    [macOS / Linux workstation]
      zora-agent daemon (Node.js >= 20)
        --> Claude Code CLI (authenticated)
        --> Gemini CLI (gcloud auth)
        --> Ollama service (localhost:11434)
      ~/.zora/
        config.toml, policy.toml
        audit/audit.jsonl
        sessions/*.jsonl
        memory/

### 6.2 Enterprise Call Center Deployment

    [Operator workstation or server]
      zora-agent daemon --preset call-center
        --> Claude claude-sdk (cost:included)
        --> Gemini gemini-cli (cost:free fallback)
        --> PolicyEngine with CPNI-tuned allowlists
        --> LeakDetector with custom PII patterns
        --> AuditLogger --> SIEM integration
      [IVR/ACD integration via Orchestrator REST API]
      [Human escalation via HandoffBundle protocol]

### 6.3 Docker Deployment (Dockerfile included)

    docker-compose.yml (repo root)
      service: zora-agent
        image built from Dockerfile
        volumes: ~/.zora:/root/.zora
        environment: ZORA_CONFIG_PATH, ZORA_POLICY_PATH

---

## 7. Technology Decisions and Rationale

| Decision | Technology | Alternatives Rejected | Rationale |
|---|---|---|---|
| Configuration format | TOML (smol-toml) | JSON (no comments), YAML (whitespace bugs, security) | ADR-004: human-readable, comment support, type-safe |
| Storage backend | Filesystem JSONL | SQLite (native deps), PostgreSQL (server), LevelDB (native) | ADR-003: zero deps, human-inspectable, backup = directory copy |
| LLM interface | LLMProvider interface | Direct SDK calls in orchestrator | ADR-001: provider neutrality, mockable in tests |
| Policy enforcement | PolicyEngine.canUseTool() | Container sandbox only, prompt instructions | ADR-002: enforced in code not prompt; supports human-approval flows |
| Streaming | Async generator (AgentEvent) | Callbacks, EventEmitter, Promises | Composable, pausable, back-pressure aware; matches SDK streaming model |
| Logger | pino | winston, console.log | Structured JSON, low overhead, pino-pretty for dev UX |
| Test runner | vitest | jest, mocha | ESM-native, fast, Vitest browser mode for dashboard tests |
