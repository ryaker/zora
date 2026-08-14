/**
 * Tool-name normalisation — SEC-24.
 *
 * ## The bug class
 *
 * Zora grew two vocabularies for the same thing. Its own tools, its hook
 * filters, its policy action keys and its config files were all written in
 * snake_case lowercase — `bash`, `read_file`, `write_file`. The Claude Agent
 * SDK spells its built-ins in PascalCase — `Bash`, `Read`, `Write`, `Edit` —
 * and MCP tools arrive fully qualified, `mcp__zora-tools__memory_save`.
 *
 * For as long as the hook chain ran over Zora's *own* observed event stream,
 * the two never met. Since SEC-21 the chain runs from the SDK's `PreToolUse`
 * hook, so every comparison site suddenly receives the SDK's spelling — and
 * every site that compared with `===`, `Array.includes()` or `Set.has()`
 * silently stopped matching. Nothing threw. Nothing logged. The controls just
 * became inert:
 *
 *   - SEC-23: `ShellSafetyHook`'s `tools: ['bash', …]` filter never matched
 *     `Bash`, so the hook that refuses `rm -rf /` was skipped on every call.
 *   - SEC-24: `RateLimitHook`'s `{ tool: 'bash', maxCalls: 60 }` never matched
 *     `Bash`, so the shell rate limit was never applied.
 *   - SEC-24: `IrreversibilityScorerHook`'s `toolToAction()` mapped `bash`, not
 *     `Bash`, so every SDK call fell through to the unknown-tool default of 50
 *     instead of its real action score — and the ApprovalQueue gate for
 *     destructive operations was computed against the wrong category.
 *   - SEC-24: `PolicyEngine._checkDryRun()` compared the SDK's name against the
 *     lowercase `dry_run.tools` list from policy.toml, so a configured dry run
 *     intercepted nothing.
 *   - SEC-24: `validateOutput()` in prompt-defense compared against `'bash'`,
 *     `'write_file'` and `'read_file'` — none of which an SDK call is ever
 *     called.
 *
 * A missing check is loud; a check that runs and never matches is silent. That
 * is what makes this a *class* rather than a handful of typos, and why the fix
 * is one shared normaliser rather than five careful comparisons.
 *
 * ## The contract
 *
 * `normalizeToolName()` is the only way to reduce a tool name to a comparable
 * form, and `toolFilterMatches()` is the only way to test one against a list.
 * Every gate in `src/` routes through them.
 * `tests/security/tool-name-normalization.test.ts` scans `src/` for tool-name
 * comparisons and hand-rolled normalisation idioms and fails on any it does not
 * recognise — the failure is triggered by the *existence* of an unregistered
 * comparison, so a new site cannot pass by being carefully written.
 *
 * Normalisation is deliberately lossy in exactly two ways, and no others:
 *
 *   1. Case is dropped. `Bash`, `bash` and `BASH` are one tool.
 *   2. An MCP qualification prefix is dropped. `mcp__zora-tools__memory_save`
 *      compares equal to `memory_save`, because that is the name a filter or a
 *      policy file would sensibly be written against.
 *
 * It does **not** try to unify aliases — `bash` and `run_command` stay distinct
 * names, and the sites that treat them as synonyms say so with an explicit
 * alias list (see `SHELL_TOOL_ALIASES`). Guessing at synonyms is how a rename
 * would quietly widen a gate.
 */

/**
 * Reduce a tool name to its comparable form: MCP prefix stripped, lowercased.
 *
 * This is the single normalisation in the codebase. Do not inline
 * `.toLowerCase()` or `.split('__').pop()` at a comparison site — that is the
 * exact shape the guard test fails on, because three near-identical
 * normalisations is how the SEC-23/SEC-24 mismatch survived a release.
 */
export function normalizeToolName(tool: string): string {
  const trimmed = tool.trim();
  const base = trimmed.includes('__') ? (trimmed.split('__').pop() ?? trimmed) : trimmed;
  return base.toLowerCase();
}

/** Are these two names the same tool? */
export function toolNameEquals(a: string, b: string): boolean {
  return normalizeToolName(a) === normalizeToolName(b);
}

/**
 * Does `tool` match any entry in `filter`?
 *
 * A filter entry matches either the tool's full name or its MCP base name, both
 * case-insensitively. Keeping the full-name comparison matters: a filter
 * written as `mcp__zora-tools__memory_save` should pin that one server's tool
 * and not every `memory_save` from every server, so the entry is compared
 * as-written first and only then by base name.
 */
export function toolFilterMatches(filter: Iterable<string>, tool: string): boolean {
  const full = tool.trim().toLowerCase();
  const base = normalizeToolName(tool);
  for (const entry of filter) {
    const candidate = entry.trim().toLowerCase();
    if (candidate === full || candidate === base) return true;
  }
  return false;
}

/**
 * The Claude Agent SDK's built-in tool names, as the SDK spells them.
 *
 * Exported so tests can assert against real SDK spellings rather than the
 * lowercase ones Zora happens to use internally. A test that only exercises
 * `'bash'` is precisely what let SEC-23 and SEC-24 ship.
 */
export const SDK_TOOL_NAMES = [
  'Bash',
  'BashOutput',
  'KillShell',
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'Task',
  'TodoWrite',
] as const;

/**
 * Every spelling of "run a shell command" that reaches a gate: the SDK's,
 * Zora's own, and the aliases older hook filters were written against.
 */
export const SHELL_TOOL_ALIASES = [
  'bash',
  'shell',
  'run_command',
  'execute_bash',
  'execute_command',
  'bashoutput',
  'killshell',
] as const;

/** Every spelling of "read a file or search the filesystem". */
export const READ_TOOL_ALIASES = [
  'read',
  'read_file',
  'cat',
  'grep',
  'glob',
] as const;

/** Every spelling of "create or modify a file". */
export const WRITE_TOOL_ALIASES = [
  'write',
  'write_file',
  'create_file',
  'edit',
  'edit_file',
  'multiedit',
  'notebookedit',
  'str_replace_editor',
] as const;

/**
 * Tools that can change something outside the agent's own head.
 *
 * SEC-24: this list is the one the channel `destructiveOpsAllowed` gate uses.
 * It previously lived inline in `orchestrator.ts` as
 * `new Set(['Bash', 'bash', 'Write', 'write_file', 'Edit', 'edit_file'])` — a
 * set that spelled each name twice to paper over the missing normaliser, and
 * still missed `MultiEdit` and `NotebookEdit` entirely, so an untrusted channel
 * with `destructiveOpsAllowed: false` could edit files through them.
 */
export const DESTRUCTIVE_TOOL_NAMES = [
  ...SHELL_TOOL_ALIASES,
  ...WRITE_TOOL_ALIASES,
  'delete_file',
  'rm',
  'mv',
] as const;
