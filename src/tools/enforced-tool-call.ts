/**
 * Enforced tool calls for providers that run their own tool loop — #254.
 *
 * The Claude Agent SDK owns tool execution on the `claude-sdk` path: it calls
 * the `PreToolUse` hooks, then `canUseTool`, then the tool, then `PostToolUse`.
 * A provider that talks to a plain chat API (Ollama today, OpenAI later) gets
 * tool calls back as data and has to execute them itself. If each such provider
 * re-implemented the gate, the gates would drift apart — exactly the SEC-23
 * failure mode, where the heartbeat path quietly ended up with a weaker chain.
 *
 * So this module is the SDK's tool pipeline, reproduced once, consuming the
 * *same* objects the SDK path is given:
 *
 *   [1] disallowedTools  `deriveDisallowedTools(policy)` — static bans
 *   [2] PreToolUse       `TaskContext.sdkHooks` — the ToolHookRunner bridge
 *   [3] canUseTool       `TaskContext.canUseTool` — PolicyEngine, capability
 *                        tokens, channel CapabilitySet
 *   [4] execute
 *   [5] PostToolUse      observational
 *
 * There is no second policy here and no parallel enforcement path: every
 * decision is made by the hook and canUseTool objects the orchestrator already
 * builds per task. This module only decides the order and what "deny" means.
 *
 * Where it is deliberately *stricter* than the SDK (fail closed):
 *
 *   - No `canUseTool` supplied → deny. The SDK in `permissionMode: 'default'`
 *     with no callback would prompt; Zora has no one to prompt, so the only
 *     safe reading of "no gate wired" is "no tool runs".
 *   - A `PreToolUse` hook returning `'ask'` → deny, for the same reason.
 *   - A `PreToolUse` hook returning `'allow'` does NOT skip `canUseTool`. In the
 *     SDK it would, and `sdk-hook-bridge.ts` is careful never to return it for
 *     exactly that reason (SEC-20). Honouring it here would only create a way
 *     to take PolicyEngine out of the path.
 *   - A hook or `canUseTool` that throws → deny.
 */

import type { ZoraSdkHooks } from '../hooks/sdk-hook-bridge.js';
import type { EnforcedCanUseTool } from '../security/enforced-sdk-options.js';
import { toolFilterMatches } from '../security/tool-names.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('enforced-tool-call');

export interface ToolChain {
  /** Layer [1]: policy-derived static bans (`deriveDisallowedTools`). */
  disallowedTools?: string[];
  /** Layer [2] and [5]: the per-task SDK hook bridge. */
  hooks?: ZoraSdkHooks;
  /** Layer [3]: PolicyEngine and friends. Absent means every call is denied. */
  canUseTool?: EnforcedCanUseTool;
  signal: AbortSignal;
}

export type ToolAuthorization =
  | { allowed: true; input: Record<string, unknown> }
  | { allowed: false; reason: string; layer: 'disallowed' | 'pre_tool_use' | 'can_use_tool' };

/**
 * SDK hook-matcher semantics: no matcher (or `*`) matches every tool; otherwise
 * the matcher is an anchored regular expression over the tool name ("Bash",
 * "Write|Edit"). An invalid pattern matches everything — over-applying a
 * defense is the safe failure.
 */
function matcherApplies(matcher: string | undefined, toolName: string): boolean {
  if (matcher === undefined || matcher === '' || matcher === '*') return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(toolName);
  } catch {
    return true;
  }
}

/**
 * Run layers [1]–[3] for one tool call. Returns the input that must be
 * executed — which may differ from what the model asked for, because
 * `SecretRedactHook` rewrites arguments and that rewrite has to reach execution.
 */
export async function authorizeToolCall(
  chain: ToolChain,
  toolName: string,
  rawInput: Record<string, unknown>,
  toolUseId: string,
): Promise<ToolAuthorization> {
  // [1] Static bans. A banned tool is never offered to the model in the first
  // place (see `localToolSchemas`), so reaching here means the model invented
  // the call — deny it the same way.
  if (chain.disallowedTools && toolFilterMatches(chain.disallowedTools, toolName)) {
    return { allowed: false, layer: 'disallowed', reason: `Tool '${toolName}' is disabled by policy` };
  }

  let input = { ...rawInput };

  // [2] PreToolUse.
  for (const matcher of chain.hooks?.PreToolUse ?? []) {
    if (!matcherApplies(matcher.matcher, toolName)) continue;
    for (const hook of matcher.hooks) {
      let out;
      try {
        out = await hook(
          { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: input, tool_use_id: toolUseId },
          toolUseId,
          { signal: chain.signal },
        );
      } catch (err) {
        log.error({ err, tool: toolName }, 'PreToolUse hook threw — denying');
        return { allowed: false, layer: 'pre_tool_use', reason: `Tool '${toolName}' was blocked because a Zora security hook failed to evaluate it.` };
      }
      const decision = out?.hookSpecificOutput?.permissionDecision;
      if (decision === 'deny' || decision === 'ask') {
        return {
          allowed: false,
          layer: 'pre_tool_use',
          reason: out?.hookSpecificOutput?.permissionDecisionReason ?? `Tool '${toolName}' was blocked by a Zora hook`,
        };
      }
      if (out?.hookSpecificOutput?.updatedInput) {
        input = { ...out.hookSpecificOutput.updatedInput };
      }
    }
  }

  // [3] canUseTool — fail closed when nothing is wired.
  if (!chain.canUseTool) {
    return { allowed: false, layer: 'can_use_tool', reason: `Tool '${toolName}' denied: no permission gate is configured for this task` };
  }
  let verdict;
  try {
    verdict = await chain.canUseTool(toolName, input, { signal: chain.signal });
  } catch (err) {
    log.error({ err, tool: toolName }, 'canUseTool threw — denying');
    return { allowed: false, layer: 'can_use_tool', reason: `Tool '${toolName}' denied: the policy check failed` };
  }
  if (verdict.behavior !== 'allow') {
    return { allowed: false, layer: 'can_use_tool', reason: verdict.message ?? `Tool '${toolName}' denied by policy` };
  }
  return { allowed: true, input: verdict.updatedInput ? { ...verdict.updatedInput } : input };
}

/** Layer [5]. Observational: a throwing hook is logged and ignored. */
export async function runPostToolUse(
  chain: ToolChain,
  toolName: string,
  input: Record<string, unknown>,
  response: unknown,
  toolUseId: string,
  durationMs: number,
): Promise<void> {
  for (const matcher of chain.hooks?.PostToolUse ?? []) {
    if (!matcherApplies(matcher.matcher, toolName)) continue;
    for (const hook of matcher.hooks) {
      try {
        await hook(
          {
            hook_event_name: 'PostToolUse',
            tool_name: toolName,
            tool_input: input,
            tool_response: response,
            tool_use_id: toolUseId,
            duration_ms: durationMs,
          },
          toolUseId,
          { signal: chain.signal },
        );
      } catch (err) {
        log.error({ err, tool: toolName }, 'PostToolUse hook threw (non-critical)');
      }
    }
  }
}
