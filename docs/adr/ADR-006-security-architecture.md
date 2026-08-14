# ADR-006: Security Architecture Design Decisions

**Status:** Accepted
**Date:** 2026-02-25
**Authors:** Zora Core Team

## Context

Zora executes arbitrary shell commands and file operations on the user machine based on LLM decisions. This creates a broad attack surface across five threat categories:

1. **Prompt injection** (LLM01): Malicious content in retrieved documents or tool outputs attempts to hijack the agent mandate.
2. **Goal drift** (ASI01): The LLM drifts from the original task over multiple turns, potentially performing unauthorized actions.
3. **Excessive agency** (LLM06): The agent acquires or exercises more permissions than necessary for the task.
4. **Data exfiltration** (LLM02): Secrets or PII present in the execution environment leak into LLM prompts or responses.
5. **Unbounded consumption** (LLM10): Runaway loops or provider failures cause excessive API usage or system resource consumption.

Each threat requires a distinct control, and controls must compose without creating usability-killing friction.

## Decisions

### D1: Defense in Depth via Layered Controls

No single control is sufficient. Zora implements five independent layers:

1. **Input sanitization** (PromptDefense.sanitizeInput, src/security/prompt-defense.ts): Wraps externally-sourced content in untrusted_content XML tags and detects known injection patterns before they reach the LLM.

2. **Intent binding** (IntentCapsuleManager, src/security/intent-capsule.ts): Creates an HMAC-SHA256 signed capsule at task start. Every subsequent action is checked for keyword and category alignment with the original mandate. Drift is classified and optionally blocked.

3. **Policy gate** (PolicyEngine.canUseTool, src/security/policy-engine.ts): Intercepts every tool call with path validation, command allowlisting, budget checking, and drift integration. The gate is in the SDK canUseTool callback, not the system prompt.

4. **Output scanning** (LeakDetector.scan, src/security/leak-detector.ts): Scans all tool outputs for secret patterns (API keys, private keys, JWT tokens, AWS credentials) before returning results to the LLM.

5. **Audit data minimization** (AuditLogger.log, src/security/audit-logger.ts): Redacts or hashes sensitive fields (prompt text, tool args/results containing secrets or PII) before persistence and export, while preserving forensic traceability via the hash chain.

### D2: HMAC-SHA256 for Intent Binding, SHA-256 for Audit Integrity

- **HMAC-SHA256** (node:crypto createHmac) is used for IntentCapsule signatures because it requires a secret key. This prevents the LLM from forging a capsule even if it reads the capsule data from its context.
- **SHA-256** (node:crypto createHash) is used for AuditLogger hash chains and IntegrityGuardian baselines because these are integrity proofs, not authentication tokens. The chain property (each hash includes the previous) is sufficient without a key.

### D3: Shell Tokenization Before Allowlist Checking

Shell command validation must tokenize and split chained commands (&&, ||, ;, |) before checking the allowlist. A command like git status && rm -rf / would pass a naive prefix check for git but execute rm. ShellValidator (src/security/shell-validator.ts) implements shell tokenization and splitting so each sub-command is checked individually.

### D4: Capability Tokens for Sub-Agents

Multi-agent teams spawn sub-agents that should operate with narrower permissions than the coordinator. WorkerCapabilityToken (src/security/capability-tokens.ts, `WorkerCapabilityToken` in src/types.ts) creates scoped, time-limited grants (30-minute default) derived from ZoraPolicy but potentially further restricted. Sub-agents receive tokens, not direct policy access.

### D5: Integrity Guardian for Critical Files

SOUL.md (agent identity), MEMORY.md (persistent memory), policy.toml, and config.toml are the four files whose modification could fundamentally alter agent behavior. IntegrityGuardian (src/security/integrity-guardian.ts) computes SHA-256 baselines at boot and alerts on mismatch. Quarantine capability (state/quarantine/) allows suspicious files to be isolated.

### D6: Encrypted Secrets Storage

Provider API keys and other credentials are stored encrypted at rest via SecretsManager (src/security/secrets-manager.ts). Each secret is encrypted with AES-256-GCM using a key derived from a master password (PBKDF2). Secrets are never stored in plaintext in config files or environment variables at rest; the encrypted store lives at ~/.zora/secrets.enc (mode 0o600).

### D7: Policy Serialization

PolicySerializer (src/security/policy-serializer.ts) separates policy I/O from the enforcement engine: `getPolicySummary()` produces human-readable policy summaries injected into the system prompt so the LLM understands its constraints; `writePolicyFile()` handles runtime policy persistence to TOML. Keeping serialization out of PolicyEngine ensures the enforcement path has no I/O dependencies.

### D8: Drift Blocking Modes

Drift blocking is configurable via DEFAULT_DRIFT_BLOCKING_MODE (src/config/defaults.ts) and the security.drift_blocking_mode config field:
- log_only: Detect and log drift; do not block (default for development)
- strict: Block drift-categorized actions (recommended for production)
- paranoid: Block on any category mismatch, not just keyword mismatch (maximum security)

## Consequences

**Positive:**
- Layered controls mean no single bypass compromises all security properties.
- HMAC signing prevents capsule forgery even by a sophisticated adversarial LLM.
- Shell tokenization prevents the most common command injection pattern (chained commands).
- Capability tokens support principle of least privilege for sub-agents.
- Drift blocking modes allow gradual escalation without code changes.

**Negative:**
- Each layer adds latency to tool calls (typically microseconds, but measurable).
- Drift detection uses keyword matching, which can generate false positives on legitimate tasks with unusual vocabulary. Tuning allowedActionCategories per task type reduces false positives.
- LeakDetector regex patterns are regex-based and may miss novel secret formats. Custom patterns can be registered, but this requires operator awareness.

## Alignment

This design addresses:
- OWASP LLM01 (Prompt Injection): D1 PromptDefense
- OWASP LLM02 (Sensitive Information Disclosure): D1 LeakDetector + D1 Audit data minimization
- OWASP LLM06 (Excessive Agency): D3 PolicyEngine + D4 Capability Tokens
- OWASP LLM10 (Unbounded Consumption): D3 PolicyEngine BudgetPolicy
- ASI01 (Goal Drift): D2 IntentCapsuleManager
- ASI02 (Unintended Side Effects): D3 PolicyEngine DryRunPolicy

See full mapping in docs/architecture/ontologies/owasp-llm-alignment.md.

## Update -- 2026-08 (SEC-20, SEC-21)

D1 layer 3 ("Policy gate") is now two pre-execution layers rather than one, and
the earlier wording understated where enforcement actually happens:

- **PreToolUse hook** (src/hooks/sdk-hook-bridge.ts). The tool-hook chain --
  SensitiveFileGuard, ShellSafety, AuditLog, RateLimit, SecretRedact,
  IrreversibilityScorer -- runs from the SDK's `PreToolUse` hook. A deny there
  short-circuits ahead of `canUseTool` and the tool is never invoked. It fails
  closed: a hook that throws denies the call. Argument rewrites (SecretRedact)
  now reach execution via `updatedInput` rather than only Zora's own log.
  Previously this chain ran on stream *observation*, after execution, so
  SensitiveFileGuardHook's "non-bypassable" claim was aspirational.
- **canUseTool** (PolicyEngine + capability tokens + channel `CapabilitySet`),
  which the SDK only invokes under `permissionMode: 'default'`. The provider
  previously defaulted to `bypassPermissions`, which skipped it entirely on the
  main task path. `bypassPermissions` has been removed from the codebase.

D4's capability tokens are enforced inside that `canUseTool` closure
(`Orchestrator._buildTokenAwareCanUseTool`), checking `path` and `command`
arguments against the active token before delegating to the PolicyEngine.

Background paths (heartbeat, memory extraction, context compression) run through
`ExecutionLoop` with `permissionMode: 'default'`, a static `allowedTools` list,
and the PolicyEngine `canUseTool`; they do not currently install the PreToolUse
bridge.

Regression guard: `tests/security/tool-enforcement.test.ts`. Background:
`docs/reviews/2026-08-code-review.md`.
