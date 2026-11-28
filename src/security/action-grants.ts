/**
 * Per-job scoped action grants (#233).
 *
 * A grant lets one job run a named, otherwise approval-gated action without a
 * prompt each time ("push to agent/*", not "ask on every push"). It is stored on
 * the job's capability token, set by trusted code (SubmitTaskOptions), never by
 * model-supplied input.
 *
 * Invariants:
 *  - A grant only ever skips the *approval prompt* for an action. Path/command
 *    validation, auto_deny, budgets and drift checks all still run first/after.
 *    It cannot allow anything policy.toml forbids (narrow-only).
 *  - Fail closed: anything ambiguous (compound shell, force flags, bare
 *    `git push`, missing constraints) does not match, so the normal approval runs.
 */

export interface ActionGrant {
  /** Stable id, written to the log with every action it covers. */
  id: string;
  /** Action key, as classified by PolicyEngine (e.g. `git_push`). */
  action: string;
  /** git_push only: branch globs (`*` wildcard) the push may target. Required for git_push. */
  branches?: string[];
  /** git_push only: remote names the push may target. Required for git_push (URLs never match). */
  remotes?: string[];
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** Characters that let one shell string run more than the command we parsed. */
const COMPOUND_RE = /[;&|`$<>\n\r(){}]/;
/** The only push flags that do not widen what is pushed or rewrite remote history. */
const SAFE_PUSH_FLAGS = new Set(['-u', '--set-upstream', '--no-verify']);

/** Parse `git push [flags] <remote> <branch>...`; null when anything is ambiguous. */
export function parseGitPush(command: string): { remote: string; branches: string[] } | null {
  if (COMPOUND_RE.test(command)) return null;
  const args = command.trim().split(/\s+/);
  if (args[0] !== 'git' || args[1] !== 'push') return null;
  const positional: string[] = [];
  for (const a of args.slice(2)) {
    if (a.startsWith('-')) {
      if (!SAFE_PUSH_FLAGS.has(a)) return null;
    } else {
      positional.push(a);
    }
  }
  if (positional.length < 2) return null; // bare `git push` / no explicit branch
  const [remote, ...refspecs] = positional as [string, ...string[]];
  const branches: string[] = [];
  for (const spec of refspecs) {
    if (spec.startsWith('+') || spec.startsWith(':')) return null; // force / delete
    const dst = spec.includes(':') ? spec.slice(spec.indexOf(':') + 1) : spec;
    if (!dst || (dst.startsWith('refs/') && !dst.startsWith('refs/heads/'))) return null;
    branches.push(dst.replace(/^refs\/heads\//, ''));
  }
  return { remote, branches };
}

/** The first grant that covers this action, or null (=> normal approval applies). */
export function findCoveringGrant(
  grants: readonly ActionGrant[] | undefined,
  action: string,
  toolInput: Record<string, unknown>,
): ActionGrant | null {
  if (!grants?.length) return null;
  for (const g of grants) {
    if (g.action !== action) continue;
    if (action === 'git_push') {
      if (!g.branches?.length) continue; // an unconstrained push grant is never valid
      const parsed = parseGitPush(typeof toolInput['command'] === 'string' ? toolInput['command'] : '');
      if (!parsed) continue;
      // Required: without it the grant would also cover `git push https://any-host/x.git`.
      if (!g.remotes?.length || !g.remotes.includes(parsed.remote)) continue;
      const res = g.branches.map(globToRegExp);
      if (parsed.branches.every(b => res.some(r => r.test(b)))) return g;
      continue;
    }
    return g;
  }
  return null;
}
