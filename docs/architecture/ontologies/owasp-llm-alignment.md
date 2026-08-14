# OWASP LLM Top 10 Alignment
## Zora Agent Framework Security Mapping

**Document ID:** SEC-OWASP-001  
**Version:** 1.0  
**Date:** 2026-02-25  
**Status:** Approved  

Reference: OWASP Top 10 for Large Language Model Applications (2025 edition)
Source: https://owasp.org/www-project-top-10-for-large-language-model-applications/

---

## Alignment Matrix

| Risk ID | Risk Name | Zora Mitigation | Implementation File(s) | Status |
|---|---|---|---|---|
| **LLM01** | Prompt Injection | PromptDefense.sanitizeInput() wraps untrusted content in XML untrusted_content tags. Regex patterns detect: ignore previous instructions, you are now, INST, <<SYS>>, encoded base64/hex variants, RAG injection patterns (IMPORTANT INSTRUCTION, NOTE TO AI). validateOutput() scans tool call results for post-execution injection. | src/security/prompt-defense.ts | Implemented |
| **LLM02** | Sensitive Information Disclosure | LeakDetector.scan() applies built-in regex patterns for: OpenAI/Anthropic API keys (sk-), Google API keys (AIza), GitHub tokens (ghp_), Slack bot tokens (xoxb-), JWTs, base64 blocks > 50 chars, RSA/EC private key headers, AWS access key IDs (AKIA/ASIA), password assignments. Matches trigger redaction before output is returned to LLM. | src/security/leak-detector.ts | Implemented |
| **LLM03** | Supply Chain | Provider code is version-pinned in package.json. Claude SDK (@anthropic-ai/claude-agent-sdk ^0.3.232) and Gemini CLI are authenticated via existing OS sessions, not embedded API keys. Ollama runs locally with no external package dependencies. | package.json, src/providers/ | Partial (no SBOM generation yet) |
| **LLM04** | Data and Model Poisoning | IntegrityGuardian computes SHA-256 baselines for SOUL.md, MEMORY.md, policy.toml, and config.toml at boot. Mismatch is logged as a warning. Memory extraction uses ExtractionPipeline with schema validation (ValidationPipeline) to reject malformed items. | src/security/integrity-guardian.ts, src/memory/extraction-pipeline.ts, src/memory/validation-pipeline.ts | Implemented (warning-only; blocking mode is a gap) |
| **LLM05** | Improper Output Handling | Two pre-execution gates run before any tool executes: the SDK PreToolUse hook (SEC-21 bridge, where the tool-hook chain -- SensitiveFileGuard, ShellSafety, RateLimit, SecretRedact, IrreversibilityScorer -- can deny or rewrite arguments, and fails closed) and then PolicyEngine.createCanUseTool() under permissionMode 'default' (SEC-20). Shell commands are tokenized via ShellValidator before allowlist checking. LeakDetector scans tool outputs post-execution. | src/hooks/sdk-hook-bridge.ts, src/security/policy-engine.ts (createCanUseTool), src/security/shell-validator.ts, src/security/leak-detector.ts | Implemented |
| **LLM06** | Excessive Agency | PolicyEngine enforces BudgetPolicy: max_actions_total per session, max_actions_by_type per action category, max_tokens_total. FilesystemPolicy and ShellPolicy allowlists restrict what the agent can touch. WorkerCapabilityToken creates scoped, time-limited grants (30 min default) for sub-agents. | src/security/policy-engine.ts (BudgetPolicy tracking), src/security/capability-tokens.ts, src/types.ts | Implemented |
| **LLM07** | System Prompt Leakage | SOUL.md (agent identity/system prompt) is covered by IntegrityGuardian baseline. AuditLogger records task.start with the prompt hash, not the raw system prompt. DashboardServer auth-middleware.ts protects API routes with Bearer token. | src/security/integrity-guardian.ts, src/dashboard/auth-middleware.ts | Partial (SOUL.md not explicitly excluded from tool read access in default policy) |
| **LLM08** | Vector and Embedding Weaknesses | MemoryManager uses salience scoring (SalienceScorer) combining access count, recency decay, relevance, and source trust bonus. Memory items include source_type field (user_instruction, agent_analysis, tool_output) enabling source-trust-weighted retrieval. Validation pipeline rejects items with invalid types or malformed summaries. | src/memory/salience-scorer.ts, src/memory/memory-types.ts, src/memory/validation-pipeline.ts | Partial (no adversarial embedding poisoning detection) |
| **LLM09** | Misinformation | Zora grounds responses in actual tool execution results (filesystem reads, shell output, API responses) rather than pure LLM generation. AuditLogger records tool.result events so operators can verify what data was provided to the LLM. | src/security/audit-logger.ts, src/orchestrator/execution-loop.ts | Partial (no fact-checking layer; tool-grounded execution reduces but does not eliminate hallucination risk) |
| **LLM10** | Unbounded Consumption | BudgetPolicy enforces max_actions_total, max_actions_by_type, and max_tokens_total per session. RetryQueue uses exponential backoff with max_retries: 3 default. CircuitBreaker trips after 3 failures in 60s, with 30s cooldown. DryRunPolicy enables preview-without-execution mode. | src/security/policy-engine.ts (budget tracking, _actionCounts, _totalActions, _tokensUsed), src/providers/circuit-breaker.ts, src/orchestrator/retry-queue.ts, src/types.ts | Implemented |

---

## Supplementary ASI (Agentic Safety Initiative) Alignment

| Risk ID | Risk Name | Zora Mitigation | Implementation File(s) | Status |
|---|---|---|---|---|
| **ASI01** | Goal Drift / Mandate Hijacking | IntentCapsuleManager creates HMAC-SHA256 signed IntentCapsule at task start capturing the mandate, mandateHash, mandateKeywords, and allowedActionCategories. checkDrift() is called per action to detect keyword divergence and category mismatch. Drift modes: log_only (default), strict (blocks drift), paranoid (blocks on any category mismatch). | src/security/intent-capsule.ts, src/security/policy-engine.ts (driftBlockingMode), src/config/defaults.ts (DEFAULT_DRIFT_BLOCKING_MODE) | Implemented |
| **ASI02** | Unintended Side Effects | DryRunPolicy enables preview mode: write operations return a preview result without executing. PolicyEngine.checkDryRun() gates all write-category tool calls when dry_run.enabled = true. | src/security/policy-engine.ts, src/types.ts (DryRunPolicy) | Implemented |

---

## Gap Analysis

| Gap | Affected Risk(s) | Priority | Notes |
|---|---|---|---|
| SBOM generation | LLM03 | Medium | No automated Software Bill of Materials generation in CI/CD pipeline |
| IntegrityGuardian blocking mode | LLM04 | Medium | Mismatch currently logs warning; should have optional blocking mode for paranoid deployments |
| SOUL.md read-access restriction | LLM07 | Low | Default policy does not explicitly deny agent read access to SOUL.md; operator should add to denied_paths |
| Adversarial embedding detection | LLM08 | Low | No detection for deliberately crafted memory injection attacks via tool outputs |
| Fact-checking / grounding verification | LLM09 | Low | No layer to verify LLM textual assertions against retrieved tool results |

---

## References

- OWASP LLM Top 10 (2025): https://owasp.org/www-project-top-10-for-large-language-model-applications/
- ADR-002: Capability Policy Enforcement (docs/adr/ADR-002-policy-enforcement.md)
- ADR-006: Security Architecture Design Decisions (docs/adr/ADR-006-security-architecture.md)
- Audit Chain Design: docs/architecture/ontologies/prov-o-mapping.md
- NIST AI RMF Alignment: docs/architecture/ontologies/nist-ai-rmf-alignment.md
