# NIST AI Risk Management Framework Alignment
## Zora Agent Framework Mapping

**Document ID:** SEC-NIST-001  
**Version:** 1.0  
**Date:** 2026-02-25  
**Status:** Approved  

Reference: NIST AI Risk Management Framework 1.0 (NIST AI 100-1)
Source: https://airc.nist.gov/Home

---

## Framework Overview

The NIST AI RMF organizes AI risk management into four core functions:
- **GOVERN** (GV): Organizational structures, policies, and culture for AI risk management
- **MAP** (MP): Risk identification and context establishment
- **MEASURE** (MS): Risk analysis, assessment, and prioritization
- **MANAGE** (MG): Risk response and treatment

---

## GOVERN (GV) Function

| Subcategory | Description | Zora Implementation | Source |
|---|---|---|---|
| GV-1.1 | Policies, processes, procedures for AI risk are established | ZoraPolicy declarative policy in policy.toml defines filesystem, shell, action, network, budget, and dry-run constraints | src/types.ts ZoraPolicy, policy.toml |
| GV-1.2 | Accountability for AI risk is established | AuditLogger SHA-256 hash-chained log provides tamper-evident accountability for all AI actions. WorkerCapabilityToken scopes per-job permissions to named jobId | src/security/audit-logger.ts, src/security/capability-tokens.ts |
| GV-1.5 | Policies for human oversight are established | DashboardServer provides real-time SSE event stream at localhost:8070. TelegramGateway enables async mobile steering. SteeringManager.always_flag config enables human approval gates for defined action categories | src/dashboard/server.ts, src/steering/telegram-gateway.ts, src/types.ts ActionsPolicy |
| GV-2.1 | AI risk is integrated into organizational risk management | PolicyEngine integrates risk controls at task execution time. BudgetPolicy limits per-session resource consumption | src/security/policy-engine.ts |
| GV-4.1 | Risk tolerance is defined | BudgetPolicy (max_actions_total, max_actions_by_type, max_tokens_total) and FilesystemPolicy / ShellPolicy allowlists define operational risk tolerance declaratively | src/types.ts BudgetPolicy, src/types.ts FilesystemPolicy |
| GV-6.2 | Roles and responsibilities for AI risk are defined | CLI subcommands (zora-agent audit, check-permissions, request-permissions, steer) define operator touchpoints | src/cli/audit-commands.ts, src/cli/steer-commands.ts |

---

## MAP (MP) Function

| Subcategory | Description | Zora Implementation | Source |
|---|---|---|---|
| MP-1.1 | Context is established for the AI system | ZoraConfig defines agent name, workspace, providers, routing mode, and memory configuration. SOUL.md provides agent identity and behavioral mandate | src/types.ts ZoraConfig, src/config/defaults.ts |
| MP-1.5 | Organizational risk tolerance is established | preset trust levels (safe, balanced, power) provide pre-configured risk tolerance boundaries. Operators can further customize via policy.toml | src/cli/presets.ts |
| MP-2.1 | Scientific principles and empirical evidence are used | Router uses deterministic capability + cost ranking (not probabilistic). FailoverController uses structured error classification (rate_limit, quota, auth, timeout, transient, permanent) with high/medium/low confidence | src/orchestrator/router.ts, src/orchestrator/failover-controller.ts |
| MP-2.3 | AI risk is contextualized within existing risk categories | LeakDetector maps patterns to severity levels (high: API keys/private keys; medium: JWT/passwords; low: base64 blocks). IntentCapsuleManager categorizes drift by allowedActionCategories | src/security/leak-detector.ts LeakSeverity, src/security/intent-capsule.ts |
| MP-3.1 | Risks are identified and prioritized | OWASP LLM Top 10 mapping documented in docs/architecture/ontologies/owasp-llm-alignment.md. Gap analysis table identifies unmitigated risks with priority ratings | docs/architecture/ontologies/owasp-llm-alignment.md |
| MP-5.1 | Likelihood and magnitude of AI risks are estimated | CircuitBreaker failure threshold (3 failures in 60s window) quantifies provider reliability. BudgetPolicy limits define blast radius of runaway sessions | src/providers/circuit-breaker.ts, src/types.ts BudgetPolicy |

---

## MEASURE (MS) Function

| Subcategory | Description | Zora Implementation | Source |
|---|---|---|---|
| MS-1.1 | Metrics for AI risk are identified | AuditLogger event types (policy.allow, policy.deny, tool.call, tool.result, failover, steer) provide quantifiable metrics for risk monitoring | src/security/security-types.ts AuditEntryEventType |
| MS-2.1 | AI risk is measured | AuditLogger.verifyChain() provides integrity measurement. PolicyEngine._actionCounts + _totalActions + _tokensUsed provide consumption metrics. BudgetStatus reports real-time budget utilization | src/security/audit-logger.ts, src/security/policy-engine.ts, src/security/security-types.ts BudgetStatus |
| MS-2.3 | AI system performance is monitored | AuthMonitor polls LLMProvider.checkAuth() and LLMProvider.getQuotaStatus() on schedule. ErrorPatternDetector aggregates failure patterns across execution loops | src/orchestrator/auth-monitor.ts, src/orchestrator/error-pattern-detector.ts |
| MS-2.5 | Feedback processes are defined | `SalienceScorer.access_count` and `last_accessed` fields track memory retrieval feedback. `reinforcement_score` field in MemoryItem tracks item quality over time | src/memory/salience-scorer.ts, src/memory/memory-types.ts |
| MS-2.8 | Risk assessment results are used to improve AI system | FailoverController classifyError() results inform router weight adjustments. ErrorPatternDetector outputs feed CircuitBreaker thresholds | src/orchestrator/failover-controller.ts, src/orchestrator/error-pattern-detector.ts |
| MS-3.1 | Test sets are developed | Vitest unit tests in tests/ directory cover policy engine, audit logger, intent capsule, failover controller, router, memory manager | vitest.config.ts, tests/ |
| MS-4.1 | Risks are tracked over time | AuditLogger JSONL provides time-series record of all events. Entries are timestamped (ISO 8601) and hash-chained for tamper evidence | src/security/audit-logger.ts |

---

## MANAGE (MG) Function

| Subcategory | Description | Zora Implementation | Source |
|---|---|---|---|
| MG-1.1 | Responses to identified risks are established | PolicyEngine.canUseTool() blocks disallowed actions immediately. IntentCapsuleManager.checkDrift() in strict/paranoid mode blocks drifted actions. DryRunPolicy enables preview without execution | src/security/policy-engine.ts, src/security/intent-capsule.ts |
| MG-2.1 | Treatments for identified risks are implemented | PromptDefense wraps untrusted content. LeakDetector redacts secrets before returning to LLM. IntegrityGuardian detects tampered critical files. PolicyEngine enforces shell tokenization via ShellValidator | src/security/prompt-defense.ts, src/security/leak-detector.ts, src/security/integrity-guardian.ts |
| MG-2.2 | Residual risk is managed | BudgetPolicy session limits bound maximum damage from policy bypass. WorkerCapabilityToken expiry (30 min default) limits window of exposure for sub-agent tokens | src/security/capability-tokens.ts DEFAULT_EXPIRATION_MS, src/types.ts |
| MG-2.4 | Risk is monitored on an ongoing basis | AuditLogger continuous append; DashboardServer SSE stream provides real-time event monitoring; TelegramGateway enables async notification of significant events | src/security/audit-logger.ts, src/dashboard/server.ts |
| MG-3.1 | Incidents are managed | RetryQueue with exponential backoff handles transient failures. FailoverController with HandoffBundle protocol handles provider failures. NegativeCache prevents repeated denied actions | src/orchestrator/retry-queue.ts, src/orchestrator/failover-controller.ts, src/services/negative-cache.ts |
| MG-3.2 | Learning from incidents is incorporated | ErrorPatternDetector aggregates failure patterns. AuditLogger verifyChain() detects integrity violations. Both feed into future policy refinements | src/orchestrator/error-pattern-detector.ts, src/security/audit-logger.ts |
| MG-4.1 | Risks are prioritized for treatment | OWASP LLM Top 10 alignment gap table (docs/architecture/ontologies/owasp-llm-alignment.md) and WSJF gap tracker (gaps/wsjf-scores.json) prioritize open improvements | docs/architecture/ontologies/owasp-llm-alignment.md, gaps/wsjf-scores.json |

---

## Overall Maturity Assessment

| NIST AI RMF Function | Implemented Subcategories | Maturity Level | Notes |
|---|---|---|---|
| GOVERN | GV-1.1, GV-1.2, GV-1.5, GV-2.1, GV-4.1, GV-6.2 | Managed (Level 3) | Policy infrastructure complete; formal governance processes emerging |
| MAP | MP-1.1, MP-1.5, MP-2.1, MP-2.3, MP-3.1, MP-5.1 | Defined (Level 2) | Risk categories mapped; quantitative estimation partial |
| MEASURE | MS-1.1, MS-2.1, MS-2.3, MS-2.5, MS-3.1, MS-4.1 | Managed (Level 3) | Comprehensive metrics; feedback loops established; monitoring active |
| MANAGE | MG-1.1, MG-2.1, MG-2.2, MG-2.4, MG-3.1, MG-3.2, MG-4.1 | Managed (Level 3) | Full risk response stack implemented; learning loops closing |

Maturity Levels: Initial (1) - Repeatable (2) - Defined (3) - Managed (4) - Optimizing (5)

---

## References

- NIST AI RMF 1.0: https://airc.nist.gov/Home
- NIST AI 100-1: https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf
- ADR-006: Security Architecture Design Decisions (docs/adr/ADR-006-security-architecture.md)
- OWASP LLM Alignment: docs/architecture/ontologies/owasp-llm-alignment.md
