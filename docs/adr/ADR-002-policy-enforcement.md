# ADR-002: Capability Policy Enforcement

**Status:** Accepted
**Date:** 2025-12-01
**Authors:** Zora Core Team

## Context

Zora operates autonomously, executing shell commands and file operations on the user's machine. Without guardrails, a misbehaving LLM could delete files, exfiltrate data, or run destructive commands. Users need configurable, enforceable boundaries.

The OWASP LLM Top 10 identifies several risks this addresses:
- **LLM06 (Excessive Agency):** Agents granted too many permissions.
- **LLM10 (Unbounded Consumption):** Agents making unlimited tool calls.
- **ASI01 (Goal Drift):** Agents drifting from their assigned task.
- **ASI02 (Unintended Actions):** Agents executing actions with unintended side effects.

## Decision

Implement a `PolicyEngine` class that intercepts every tool call before execution. The policy is defined in a user-editable `policy.toml` file with four sections:

1. **Filesystem** -- Allowlist/denylist of paths. Deny takes precedence. Symlink targets are checked against boundaries.
2. **Shell** -- Three modes: `allowlist` (only listed commands), `denylist` (everything except listed), `deny_all` (no shell). Chained commands (`&&`, `|`, `;`) are split and validated individually.
3. **Actions** -- Categorize tool calls (e.g., `write_file`, `shell_exec_destructive`, `git_push`) and flag specific categories for human approval via `always_flag`.
4. **Network** -- Domain allowlist/denylist for HTTP requests.

Two additional optional sections address advanced threats:
5. **Budget** (LLM06/LLM10) -- Per-session limits on total actions, per-action-type counts, and token spend.
6. **Dry Run** (ASI02) -- Preview write operations without executing them.

The PolicyEngine integrates with the Claude Agent SDK via the `canUseTool` callback, which the SDK calls before every tool execution. This allows Zora to enforce policy within the SDK's execution loop rather than wrapping it externally.

## Consequences

**Positive:**
- Users have fine-grained control over what the agent can do.
- Policy is declarative (TOML) and human-readable.
- The `canUseTool` integration means policy is enforced even for tool calls initiated by the LLM itself, not just those the orchestrator initiates.
- Budget tracking prevents runaway sessions.
- Dry-run mode enables safe previewing of agent behavior.

**Negative:**
- The PolicyEngine adds latency to every tool call (microseconds, but non-zero).
- Shell command parsing (quoting, escaping, chained commands) is complex and may have edge cases.
- Users who misconfigure the policy (too restrictive) will get confusing denials. Mitigated by `check_permissions` and `request_permissions` tools that let the agent self-diagnose.

## Alternatives Considered

1. **No policy enforcement (trust the LLM).** Rejected. Unsafe for production use.
2. **Container-level sandboxing only.** Considered as a complement but not a replacement. Container sandboxing is coarse-grained and doesn't support human-approval flows.
3. **Embedding policy in the system prompt.** Rejected. LLMs can ignore prompt instructions. Policy must be enforced in code, not requested in prose.

## Update -- 2026-08 (SEC-20, SEC-21)

The decision above stands, but for a period the implementation did not honour it
on the main task path. Two defects, both found in the August 2026 review
(`docs/reviews/2026-08-code-review.md`) and fixed in Wave 1:

- `ClaudeProvider` defaulted to the SDK's `bypassPermissions` mode. Under that
  mode the SDK never invokes `canUseTool`, so the PolicyEngine was not consulted
  on the main task path and `policy.toml` was advisory there. The provider now
  defaults to `permissionMode: 'default'`, both CLI factories pass it
  explicitly, and `bypassPermissions` no longer appears anywhere in `src/`.
- The tool-hook chain ran on *observation* of a streamed `tool_call` -- after
  the SDK had already executed the tool -- so a hook "denial" only wrote a
  synthetic result into Zora's own transcript. The chain now runs from an SDK
  `PreToolUse` hook (`src/hooks/sdk-hook-bridge.ts`), which is pre-execution and
  short-circuits ahead of `canUseTool`.

So enforcement is now two pre-execution layers, not one: PreToolUse (tool hooks,
fails closed, may also rewrite arguments) then `canUseTool` (PolicyEngine,
capability tokens, and for channel-originated tasks the channel `CapabilitySet`).
`tests/security/tool-enforcement.test.ts` is the permanent regression guard.
