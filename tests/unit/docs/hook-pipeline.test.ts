/**
 * DOC-12 — built-in tool hook pipeline drift guard.
 *
 * Drift this prevents: `SECURITY.md` describing "a pipeline of six built-in
 * hooks", naming them, and numbering them 1–6, while the orchestrator registers
 * a different set, a different count, or a different order. This is the highest
 * consequence drift in the repo: SECURITY.md is the artifact an operator reads
 * to decide what they can safely let the agent do, and its hook table is the
 * concrete list of what stands between the model and the filesystem.
 *
 * How it decides: `src/orchestrator/orchestrator.ts` is the source of truth for
 * *which* hooks exist and in *what order* — its `_toolHookRunner.register(...)`
 * calls run in sequence and `ToolHookRunner` preserves that order. This test
 * asserts the SECURITY.md table matches that sequence exactly, and that every
 * "six hooks"-style count claim anywhere in SECURITY.md agrees.
 *
 * It also asserts the pipeline really is pre-execution: the `PreToolUse` bridge
 * in `src/hooks/sdk-hook-bridge.ts` must drive `ToolHookRunner.runBefore` and
 * must be able to answer `deny`. Without that, "before it executes" and "any
 * hook can abort the pipeline" are the same false claims Wave 1 was created to
 * fix, and no count check would catch it.
 */

import { describe, it, expect } from 'vitest';
import { isAllowed, loadDocs, readRepoFile, stripTsComments } from './doc-drift-helpers.js';

const ORCHESTRATOR = 'src/orchestrator/orchestrator.ts';
const BRIDGE = 'src/hooks/sdk-hook-bridge.ts';
const SECURITY_DOC = 'SECURITY.md';

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10,
};

/**
 * Resolves a `register(...)` argument to the hook class it refers to.
 *
 * SEC-27: a hook that needs post-construction wiring is registered through a
 * local — `const irreversibilityScorer = new IrreversibilityScorerHook(...)`,
 * then `setApprovalQueue(...)`, then `register(irreversibilityScorer)`. The
 * pattern here only recognised `register(Name)` and `register(new Name(`, both
 * capitalised, so that form read as *no registration at all*: the scanner
 * silently dropped a hook that was still in the pipeline and demanded the
 * SECURITY.md row documenting it be deleted. A drift guard that answers a
 * refactor by asking for the docs to be made wrong is worse than none, so the
 * scanner follows the local to its constructor.
 *
 * An unresolvable identifier is returned as-is rather than skipped: it will not
 * match any documented row, so the guard fails loudly instead of quietly
 * shrinking the list it checks.
 */
function resolveHookClass(src: string, identifier: string): string {
  if (/^[A-Z]/.test(identifier)) return identifier;
  const decl = new RegExp(
    `\\b(?:const|let|var)\\s+${identifier}\\s*(?::[^=]+)?=\\s*new\\s+([A-Z]\\w*)`,
  ).exec(src);
  return decl?.[1] ?? identifier;
}

/**
 * Is this identifier a `ToolHook` parameter being forwarded, rather than a
 * built-in being registered?
 *
 * `registerToolHook(hook: ToolHook)` is the public API for hooks a *caller*
 * supplies at runtime. It forwards to the same `register()`, but what it
 * registers is not known statically and is not part of the built-in pipeline
 * SECURITY.md documents. Recognising it by its `ToolHook` parameter type keeps
 * the exclusion narrow: only a forwarded parameter is skipped, never a class.
 */
function isForwardedParameter(src: string, identifier: string): boolean {
  return new RegExp(`\\(\\s*${identifier}\\s*:\\s*ToolHook\\s*\\)`).test(src);
}

/** Built-in hook classes registered on the runner, in registration order. */
function registeredHooks(): string[] {
  const src = stripTsComments(readRepoFile(ORCHESTRATOR));
  // `this._toolHookRunner.register(SecretRedactHook)`, `.register(new AuditLogHook(...))`,
  // or `.register(someLocal)` where the local was constructed above.
  const re = /_toolHookRunner\s*\.register\(\s*(?:new\s+)?([A-Za-z_]\w*)/g;
  return [...src.matchAll(re)]
    .map((m) => m[1]!)
    .filter((identifier) => !isForwardedParameter(src, identifier))
    .map((identifier) => resolveHookClass(src, identifier));
}

/** Rows of the numbered hook table in SECURITY.md, in document order. */
function documentedHooks(): Array<{ order: number; name: string; line: number }> {
  const lines = readRepoFile(SECURITY_DOC).split('\n');
  const rows: Array<{ order: number; name: string; line: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    // | 1 | `ShellSafetyHook` | Pre-screens shell commands ... |
    const m = /^\|\s*(\d+)\s*\|\s*`([A-Z]\w*Hook)`\s*\|/.exec(lines[i]!);
    if (m) rows.push({ order: Number(m[1]), name: m[2]!, line: i + 1 });
  }
  return rows;
}

describe('DOC-12: SECURITY.md hook pipeline matches the code', () => {
  const registered = registeredHooks();

  it('finds the registration sequence in the orchestrator', () => {
    expect(
      registered.length,
      `DOC-12: found no \`_toolHookRunner.register(...)\` calls in ${ORCHESTRATOR}. ` +
        `Either hook registration moved (update this test) or the pipeline is gone.`,
    ).toBeGreaterThan(0);
  });

  it('documents the same hooks, in the same order, as the orchestrator registers', () => {
    const documented = documentedHooks();
    const docNames = documented.map((r) => r.name);

    const message =
      `DOC-12: ${SECURITY_DOC} "Tool Hook Pipeline" table does not match ${ORCHESTRATOR}.\n` +
      `  registered (source of truth, in order):\n` +
      registered.map((n, i) => `      ${i + 1}. ${n}`).join('\n') +
      `\n  documented in ${SECURITY_DOC}:\n` +
      (documented.length
        ? documented.map((r) => `      ${r.order}. ${r.name}   (line ${r.line})`).join('\n')
        : '      (no numbered `XHook` table rows found)') +
      `\n  fix: rewrite the table rows so the numbers and names read exactly like the ` +
      `registered list above.`;

    expect(docNames, message).toEqual(registered);
  });

  it('numbers the documented rows 1..N with no gaps', () => {
    const documented = documentedHooks();
    expect(
      documented.map((r) => r.order),
      `DOC-12: ${SECURITY_DOC} hook table rows are numbered ` +
        `${documented.map((r) => r.order).join(', ')} — expected 1..${documented.length}.`,
    ).toEqual(documented.map((_, i) => i + 1));
  });

  it('every "N built-in hooks" count claim in SECURITY.md matches the real count', () => {
    const lines = readRepoFile(SECURITY_DOC).split('\n');
    const expected = registered.length;
    const bad: string[] = [];

    // "pipeline of six built-in hooks", "6 built-in tool hooks", "Six hooks run before"
    const re = /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)[\s-]+(?:built-in\s+)?(?:tool\s+)?hooks?\b/gi;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const m of line.matchAll(re)) {
        const raw = m[1]!.toLowerCase();
        const n = NUMBER_WORDS[raw] ?? Number(raw);
        if (!Number.isFinite(n)) continue;
        if (n === expected) continue;
        bad.push(
          `  ${SECURITY_DOC}:${i + 1}\n      found:  "${m[0]}"\n` +
            `      fix:    the orchestrator registers ${expected} hooks — say ${expected}.`,
        );
      }
    }

    expect(
      bad,
      `DOC-12: hook-count claims in ${SECURITY_DOC} disagree with ${ORCHESTRATOR} ` +
        `(${expected} registered):\n${bad.join('\n')}`,
    ).toEqual([]);
  });

  it('prose lists of hook names are in registration order', () => {
    // Catches the second place the order is asserted: inline lists such as
    // "Active (ShellSafety, Audit, RateLimit, ...)". Only lines that already
    // name three or more hooks are inspected, so ordinary prose is untouched.
    const shortNames = registered.map((n) => n.replace(/Hook$/, ''));
    const bad: string[] = [];

    for (const doc of loadDocs()) {
      for (let i = 0; i < doc.lines.length; i++) {
        const line = doc.lines[i]!;
        const mentioned = shortNames
          .map((short) => ({ short, at: new RegExp(`\\b${short}(Hook)?\\b`).exec(line)?.index }))
          .filter((x): x is { short: string; at: number } => x.at !== undefined)
          .sort((a, b) => a.at - b.at)
          .map((x) => x.short);
        if (mentioned.length < 3) continue;
        if (isAllowed(doc, i, 'hook-order')) continue;

        const expectedOrder = shortNames.filter((s) => mentioned.includes(s));
        if (mentioned.join(',') === expectedOrder.join(',')) continue;
        bad.push(
          `  ${doc.relPath}:${i + 1}\n      found:  ${mentioned.join(', ')}\n` +
            `      fix:    reorder to ${expectedOrder.join(', ')} (registration order in ${ORCHESTRATOR}).`,
        );
      }
    }

    expect(
      bad,
      `DOC-12: hook name lists in the docs are not in registration order:\n${bad.join('\n')}\n\n` +
        `  (If a list is deliberately not ordered, add \`docs-drift-allow: hook-order\` on or above the line.)`,
    ).toEqual([]);
  });

  it('the PreToolUse bridge really runs the hook chain and can deny', () => {
    const bridge = readRepoFile(BRIDGE);
    // These three facts are what make SECURITY.md's "before it executes" and
    // "any hook can abort the pipeline" true rather than aspirational.
    expect(bridge, `DOC-12: ${BRIDGE} no longer references PreToolUse.`).toContain('PreToolUse');
    expect(
      bridge,
      `DOC-12: ${BRIDGE} no longer calls ToolHookRunner.runBefore — SECURITY.md's claim that ` +
        `hooks run "before it executes" would be false.`,
    ).toMatch(/runBefore/);
    expect(
      bridge,
      `DOC-12: ${BRIDGE} no longer emits permissionDecision: 'deny' — SECURITY.md's claim that ` +
        `"any hook can abort the pipeline" would be false.`,
    ).toMatch(/permissionDecision:\s*'deny'/);
  });
});
