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
