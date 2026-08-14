/**
 * Enforced SDK options — SEC-23.
 *
 * Wave 1 (SEC-20/SEC-21) made tool-call enforcement real, but only on the main
 * task path. The reason it could be real in one place and absent in another is
 * that Zora had *several* places that hand-assemble the SDK's option object —
 * `ClaudeProvider.execute()`, and three separate `new ExecutionLoop({...})`
 * literals in the orchestrator — and each one decided independently which
 * defenses to pass. They drifted, and they drifted the wrong way round: the
 * heartbeat loop, which runs unattended scheduled routines with nobody reading
 * the output, ended up with the *weakest* gate in the system. It got
 * `canUseTool` and nothing else — no `PreToolUse` hook chain, so no
 * `ShellSafetyHook`, no `SensitiveFileGuardHook`, no `RateLimitHook`, no
 * `SecretRedactHook`, no `IrreversibilityScorerHook`.
 *
 * This module is the fix for the *cause*, not just the symptom: it is the one
 * place the enforcement half of the SDK options is built. Every execution path
 * spreads the result of `buildEnforcedSdkOptions()` and therefore cannot be
 * missing a layer — adding a new path without it is a visible omission rather
 * than a silent one, and `tests/security/sdk-options-coverage.test.ts` fails
 * when a path skips it.
 *
 * What it owns (and nothing else — model, cwd, prompt, maxTurns stay with the
 * caller):
 *
 *   [1] allowedTools / disallowedTools   static, derived from policy at boot
 *   [2] hooks (PreToolUse / PostToolUse) the ToolHookRunner chain
 *   [3] canUseTool + permissionMode      PolicyEngine / capability tokens
 *
 * ## What `ZoraPolicy` can and cannot express (SEC-23, item 2)
 *
 * `ZoraPolicy` has **no tool-name surface**. There is no `[tools]` section, no
 * `allowed_tools`, no `denied_tools` — it talks about paths, shell commands,
 * domains and action categories. So a general "these are the tools this install
 * may use" allowlist is *not* expressible today, and inventing one would mean
 * inventing a parallel config surface, which SEC-23 explicitly rules out.
 *
 * What the policy *does* say unambiguously enough to compile into a static tool
 * ban is narrower, and that is all this module derives:
 *
 *   - `shell.mode = "deny_all"`, or `shell.mode = "allowlist"` with an empty
 *     `allowed_commands`. Either way `PolicyEngine.validateCommand()` can never
 *     return `allowed` for any command, so the shell tools are dead weight in
 *     the model's context. Ban them outright.
 *   - `network.denied_domains` containing `"*"` while `allowed_domains` is
 *     empty — the `locked` and `safe` presets' way of saying "no network".
 *
 * Deliberately *not* derived: `filesystem.allowed_paths`. An empty list there is
 * ambiguous — `parsePolicy()` defaults it to `[]` when the section is absent, so
 * "deny every path" and "no filesystem section written" are indistinguishable,
 * and guessing wrong would silently remove Read/Write/Edit from every install
 * with a terse policy.toml. Path enforcement stays where it can see the actual
 * argument: `canUseTool` → `PolicyEngine.validatePath()`.
 *
 * `disallowedTools` is the stronger of the two SDK knobs — per the SDK docs it
 * removes the tool from the model's context entirely and blocks harness-internal
 * direct calls, "even if they would otherwise be allowed" — so a policy-derived
 * ban is applied there rather than by omission from `allowedTools`.
 */

import type { ZoraPolicy } from '../types.js';
import type { ZoraSdkHooks } from '../hooks/sdk-hook-bridge.js';

// ─── Types ───────────────────────────────────────────────────────────

/**
 * The `canUseTool` shape this module assumes by default. Structural rather than
 * imported so the module stays free of an SDK import (it is reached from the
 * CLI, the orchestrator and the provider alike).
 *
 * The builder is generic over this type: Zora has two subtly different
 * spellings in circulation — the SDK's discriminated `CanUseTool` that
 * `ExecutionLoop` takes, and the looser `TaskContext['canUseTool']` — and the
 * builder passes whichever it is given straight through rather than forcing a
 * cast at the call site.
 */
export type EnforcedCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal },
) => Promise<{ behavior: 'allow' | 'deny'; message?: string; updatedInput?: Record<string, unknown> }>;

/**
 * The one permission mode Zora runs in. `'default'` is the only mode under
 * which the SDK invokes `canUseTool`; anything else makes layer [3] dead code.
 * Typed as a literal so the invariant is checked by the compiler and not only
 * by a grep in CLAUDE.md.
 */
export type EnforcedPermissionMode = 'default';

/** Shell tools the SDK ships. Banned together — `BashOutput`/`KillShell`
 *  operate on shells that `Bash` started, so leaving them behind a shell ban
 *  is pointless but confusing. */
export const SHELL_TOOL_NAMES = ['Bash', 'BashOutput', 'KillShell', 'KillBash'] as const;

/** Network-reaching SDK tools. */
export const NETWORK_TOOL_NAMES = ['WebFetch', 'WebSearch'] as const;

/**
 * The keys every execution path must carry. Exported so the coverage test
 * asserts against one list rather than a copy that can rot.
 */
export const ENFORCEMENT_OPTION_KEYS = [
  'permissionMode',
  'canUseTool',
  'hooks',
  'allowedTools',
  'disallowedTools',
] as const;

export type EnforcementOptionKey = (typeof ENFORCEMENT_OPTION_KEYS)[number];

export interface BuildEnforcedSdkOptionsInput<TCanUseTool = EnforcedCanUseTool> {
  /**
   * The resolved policy. Layer [1] is derived from it.
   *
   * Required, but explicitly nullable: a library embedding or a test may have
   * no policy, and that must be spelled `policy: undefined` at the call site
   * rather than achieved by leaving the key off. No policy means no *static*
   * bans; the dynamic gates are unaffected.
   */
  policy: ZoraPolicy | undefined;

  /** Layer [3]. Omitted only by paths that have no tool surface at all. */
  canUseTool?: TCanUseTool | undefined;

  /** Layer [2]: the PreToolUse/PostToolUse bridge over `ToolHookRunner`. */
  hooks?: ZoraSdkHooks | undefined;

  /**
   * `'none'` pins `allowedTools` to `[]` — the path is a single-shot text call
   * and must not be able to reach a tool at all. `'full'` (the default) leaves
   * `allowedTools` to `baseAllowedTools`.
   */
  toolSurface?: 'full' | 'none';

  /**
   * A static allowlist to start from. `undefined` means "no allowlist" — an
   * allowlist is a filter, not a registry, and omitting the key lets the SDK
   * permit its built-ins plus the zora-tools MCP server. The policy-derived
   * bans in `disallowedTools` apply either way.
   */
  baseAllowedTools?: string[] | undefined;

  /**
   * Zora's own MCP tool names. Only meaningful alongside a non-empty
   * `baseAllowedTools`: with an allowlist in play, Zora's tools have to be
   * named explicitly or the filter drops them.
   */
  extraAllowedTools?: string[] | undefined;
}

export interface EnforcedSdkOptions<TCanUseTool = EnforcedCanUseTool> {
  permissionMode: EnforcedPermissionMode;
  canUseTool: TCanUseTool | undefined;
  hooks: ZoraSdkHooks;
  /** `undefined` = do not set the key; `[]` = no tools at all. */
  allowedTools: string[] | undefined;
  disallowedTools: string[];
}

// ─── Policy → static tool bans ───────────────────────────────────────

/**
 * Compile the parts of `ZoraPolicy` that are tool-shaped into a
 * `disallowedTools` list. See the module header for what is and is not
 * derivable; this function is deliberately conservative, because a false
 * positive here removes a tool the user expected to have with no runtime
 * message explaining why.
 */
export function deriveDisallowedTools(policy: ZoraPolicy | undefined): string[] {
  const denied = new Set<string>();
  if (!policy) return [];

  const shell = policy.shell;
  if (shell) {
    // Both of these mean `validateCommand()` denies unconditionally, so the
    // shell tools can never succeed. Advertising them to the model only buys
    // wasted turns and a confusing denial.
    const denyAll = shell.mode === 'deny_all';
    const emptyAllowlist = shell.mode === 'allowlist' && (shell.allowed_commands?.length ?? 0) === 0;
    if (denyAll || emptyAllowlist) {
      for (const t of SHELL_TOOL_NAMES) denied.add(t);
    }
  }

  const net = policy.network;
  // `denied_domains = ["*"]` with nothing allowed is how the locked/safe
  // presets say "no network". A non-empty allowed_domains alongside it is
  // ambiguous (which wins?), so leave those installs to the runtime gate.
  if (net && net.denied_domains?.includes('*') && (net.allowed_domains?.length ?? 0) === 0) {
    for (const t of NETWORK_TOOL_NAMES) denied.add(t);
  }

  return [...denied];
}

// ─── The builder ─────────────────────────────────────────────────────

/**
 * Assemble the enforcement half of the SDK options.
 *
 * Every execution path must spread this. `permissionMode` is returned as a
 * constant rather than accepted as input: there is no caller-supplied value
 * that is correct, and making it a parameter is how it drifted last time.
 */
export function buildEnforcedSdkOptions<TCanUseTool = EnforcedCanUseTool>(
  input: BuildEnforcedSdkOptionsInput<TCanUseTool>,
): EnforcedSdkOptions<TCanUseTool> {
  const disallowedTools = deriveDisallowedTools(input.policy);

  let allowedTools: string[] | undefined;
  if (input.toolSurface === 'none') {
    // An explicit empty array, not `undefined`: `undefined` means "no filter"
    // and would hand the path every built-in tool.
    allowedTools = [];
  } else {
    allowedTools = input.baseAllowedTools;
    if (allowedTools && allowedTools.length > 0 && input.extraAllowedTools?.length) {
      allowedTools = [...allowedTools, ...input.extraAllowedTools];
    }
    if (allowedTools) {
      // Keep the two lists consistent. The SDK applies `disallowedTools` last
      // anyway, but an allowlist that still names a policy-banned tool reads
      // like the ban is negotiable.
      const bans = new Set<string>(disallowedTools);
      allowedTools = allowedTools.filter(t => !bans.has(t));
    }
  }

  return {
    permissionMode: 'default',
    canUseTool: input.canUseTool,
    hooks: input.hooks ?? {},
    allowedTools,
    disallowedTools,
  };
}
