# Architecture Vision
## TOGAF ADM Phase A --- Zora Agent Framework

**Document ID:** TOGAF-AV-001  
**Version:** 1.0  
**Date:** 2026-02-25  
**Status:** Draft  

---

## 1. Executive Summary

Zora is a long-running autonomous personal AI agent designed to operate directly on the user machine, executing real tasks (file operations, shell commands, code analysis, API calls) on behalf of the user through a multi-provider LLM orchestration layer. Unlike conversational AI assistants that require copy-paste workflows, Zora acts as an embedded agent with persistent memory, scheduled routines, and real-time human oversight.

The framework addresses a fundamental gap: existing LLM tools are conversational proxies, not task executors. Zora bridges this gap by providing a secure, auditable, and configurable execution environment that works with the LLM subscriptions users already possess (Claude Code, Google Gemini) without introducing per-token API charges.

The architecture is security-first by design. Every tool call passes through a PolicyEngine gate; every action is logged to a SHA-256 hash-chained audit log; every task is bound to a cryptographically signed intent capsule that detects goal drift in real time. These are architectural invariants enforced in src/security/policy-engine.ts, src/security/audit-logger.ts, and src/security/intent-capsule.ts.

---

## 2. Problem Statement

### 2.1 Current State

Individuals and small teams using LLM tools today face three structural problems:

1. **Manual mediation**: Users must manually copy file contents, command outputs, and system state into chat windows. The AI sees only what the user types.
2. **No persistence**: Each chat session is stateless. The AI has no memory of previous conversations, user preferences, or completed work.
3. **No accountability**: There is no audit trail of what the AI was asked to do or what it actually executed. This is unacceptable for regulated environments.

### 2.2 Target State

Zora establishes a resident agent layer on the user machine that:
- Reads and writes files, executes commands, and calls external services autonomously.
- Maintains a persistent three-tier memory system (long-term MEMORY.md, daily rolling context, salience-scored structured items via MemoryManager in src/memory/memory-manager.ts).
- Routes tasks to the optimal LLM provider based on capability, cost tier, and availability, failing over automatically via FailoverController in src/orchestrator/failover-controller.ts.
- Enforces a declarative policy (filesystem paths, shell commands, action budgets) at every tool invocation via PolicyEngine in src/security/policy-engine.ts.
- Produces a cryptographically verifiable audit trail suitable for SIEM ingestion via AuditLogger in src/security/audit-logger.ts.

---

## 3. Stakeholder Concerns

| Stakeholder | Primary Concerns | Architecture Response |
|---|---|---|
| End User / Operator | Does it break my system? Can I control what it does? | PolicyEngine with preset trust levels (safe / balanced / power). Dry-run mode (ASI02). |
| Security Team | Prompt injection, goal drift, data exfiltration | PromptDefense sanitization, IntentCapsuleManager HMAC drift detection, LeakDetector secret scanning, AuditLogger SHA-256 chain |
| IT / Platform | Dependency conflicts, port conflicts, process management | Single Node.js process, configurable ports, PID file, daemon mode |
| Legal / Compliance | Audit trail, data sovereignty, regulatory alignment | Append-only JSONL audit log with SHA-256 hash chain; all data stays on-machine |
| Operations | Provider availability, failover, cost control | FailoverController with circuit breaker, RetryQueue with exponential backoff, BudgetPolicy per-session limits |
| Developers / Contributors | Extensibility, test coverage, type safety | LLMProvider interface (ADR-001), dependency injection, Vitest unit tests, TypeScript strict mode |

---

## 4. Architecture Principles

### P1: Security by Policy, Not by Trust
Every tool call passes two pre-execution gates: the SDK `PreToolUse` hook, which runs Zora's tool-hook chain and fails closed (src/hooks/sdk-hook-bridge.ts), and then PolicyEngine.createCanUseTool() under `permissionMode: 'default'` (src/security/policy-engine.ts). The policy is declarative (TOML), user-editable, and loaded at boot. No LLM output can bypass either gate. See ADR-002 and its 2026-08 update.

### P2: Auditability as an Invariant
Every significant event (task start/end, tool call, policy decision, memory extraction, failover) is written to audit/audit.jsonl via AuditLogger.log() (src/security/audit-logger.ts). Entries form a SHA-256 hash chain. Any tampering is detectable via AuditLogger.verifyChain() (src/security/audit-logger.ts).

### P3: Provider Neutrality
The LLMProvider interface (src/types.ts) is the sole contract between the orchestration layer and any LLM backend. Adding a new provider requires implementing five methods (isAvailable, checkAuth, getQuotaStatus, execute, abort) and one factory case. No orchestrator changes. Defined in ADR-001.

### P4: Fail-Safe Defaults
Default policy presets are conservative. The safe preset allows read-only filesystem access and no shell commands. Destructive commands (rm -rf, sudo) are blocked by default in all presets. DEFAULT_DRIFT_BLOCKING_MODE (src/config/defaults.ts) is log_only in development.

### P5: Zero External Dependencies for Core Functions
Core orchestration, security, memory, and audit functions require no external services. Storage uses the local filesystem under ~/.zora/ (ADR-003). Runtime dependencies are: express, commander, pino, smol-toml, zod, minisearch, node-cron.

---

## 5. Key Architectural Constraints

| Constraint | Source | Impact |
|---|---|---|
| Node.js >= 20 required | package.json engines | ESM modules, node:crypto, node:fs/promises APIs used throughout |
| LLM credentials via existing CLI sessions | WHAT_IS_ZORA.md | No API key management; users must have Claude Code or Gemini CLI authenticated |
| Single-machine deployment for v1 | ADR-003 | No replication, no multi-machine state; ~/.zora/ is single source of truth |
| TOML for all configuration | ADR-004 | Config and policy must be parseable by smol-toml (zero native deps) |
| All data stays on-machine | WHAT_IS_ZORA.md | Only task prompt text leaves the machine; files, audit logs, memory remain local |
| Append-only audit log | src/security/audit-logger.ts | audit.jsonl must never be edited or truncated; rotation requires archival |

---

## 6. Solution Concept

Zora implements a layered orchestration architecture (see also docs/architecture/togaf/diagrams/system-context.mmd):

    User Channel (CLI / Telegram / Dashboard)
           |
           v
    [Orchestrator] --- central controller (orchestrator.ts)
      |   |    |
      |   |    +-- [SecurityLayer]
      |   |          - PolicyEngine          (policy gate per tool call)
      |   |          - IntentCapsuleManager  (HMAC-SHA256 drift detection)
      |   |          - AuditLogger           (SHA-256 hash-chained JSONL)
      |   |          - LeakDetector + PromptDefense
      |   |          - IntegrityGuardian     (SHA-256 file baselines)
      |   |
      |   +-- [MemoryLayer]
      |         - MemoryManager       (3-tier memory system)
      |         - ExtractionPipeline  (proactive extraction)
      |         - SalienceScorer      (access + recency decay)
      |
      +-- [ProviderLayer]
            - Router              (capability + cost routing)
            - FailoverController  (circuit breaker, HandoffBundles)
            - RetryQueue          (exponential backoff)
            - ClaudeProvider / GeminiProvider / OllamaProvider

---

## 7. Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| Policy enforcement coverage | 100% of tool calls gated | AuditLogger policy.allow + policy.deny event counts |
| Audit chain integrity | 0 broken links | zora-agent audit --verify exit code 0 |
| Provider failover latency | < 2s for handoff | Session event timestamps: task.start to first token on failover |
| Memory retrieval relevance | Top-3 items match task context | Salience score > 0.6 for retrieved items |
| Cold boot time | < 5s from zora-agent start to ready | Orchestrator.boot() duration log entry |
| Security test coverage | > 80% unit test coverage for security module | Vitest --coverage report on src/security/ |
