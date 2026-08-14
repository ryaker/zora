/**
 * DOC-12 — model ID drift guard.
 *
 * Drift this prevents: a doc telling an operator to put `model = "claude-sonnet-4-6"`
 * (or `"claude-haiku"`, or any other id) in `config.toml` when no such id exists
 * anywhere in the code. Model ids age out fast; a stale one in a quickstart is a
 * config that fails on first run, and the reader has no way to tell which of the
 * two is wrong.
 *
 * How it decides: the source of truth is the set of model-id-shaped strings that
 * appear in `src/**`, anchored on `DEFAULT_CLAUDE_MODEL` (SDK-04's shared
 * constant in `src/providers/claude-provider.ts`) so the guard fails loudly if
 * that constant is renamed or moved rather than silently checking nothing.
 *
 * False positives: the shape regexes deliberately require a model *family*
 * (`opus`/`sonnet`/`haiku`) or a version number, so `claude-sdk`, `claude-mem`,
 * `gemini-cli` and `gemini-provider.ts` do not match. Genuinely historical
 * mentions opt out with an inline `docs-drift-allow:` marker.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CLAUDE_MODEL } from '../../../src/providers/claude-provider.js';
import {
  REPO_ROOT,
  formatFindings,
  scanDocs,
  stripTsComments,
  type Finding,
} from './doc-drift-helpers.js';

/**
 * Model-id *shapes*, not a hardcoded list.
 *
 *   claude-opus-5, claude-sonnet-4-5, claude-haiku, claude-3-5-sonnet-20241022
 *   gemini-2.5-pro, gemini-3-pro-preview, gemini-flash
 *
 * Anchored on a family word or a leading digit so provider types (`claude-sdk`,
 * `gemini-cli`), package names (`claude-agent-sdk`) and filenames
 * (`gemini-provider.ts`) are not mistaken for model ids.
 */
const MODEL_ID_PATTERNS: RegExp[] = [
  /\bclaude-(?:opus|sonnet|haiku)(?:-[a-z0-9]+)*\b/g,
  /\bclaude-[0-9](?:[-.][0-9a-z]+)*?-(?:opus|sonnet|haiku)(?:-[a-z0-9]+)*\b/g,
  /\bgemini-[0-9][0-9.]*(?:-[a-z0-9]+)*\b/g,
  /\bgemini-(?:pro|flash|ultra|nano)\b/g,
];

/** Every model-id-shaped string that appears anywhere in the shipped source. */
function collectSourceModelIds(): Set<string> {
  const ids = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // The dashboard frontend has its own node_modules; nothing in it names a model.
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(abs);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        const src = stripTsComments(fs.readFileSync(abs, 'utf8'));
        for (const re of MODEL_ID_PATTERNS) {
          re.lastIndex = 0;
          for (const m of src.matchAll(re)) ids.add(m[0]);
        }
      }
    }
  };
  walk(path.join(REPO_ROOT, 'src'));
  return ids;
}

describe('DOC-12: model IDs in docs exist in the code', () => {
  const sourceIds = collectSourceModelIds();

  it('anchors on the SDK-04 shared default model constant', () => {
    // If this fails, DEFAULT_CLAUDE_MODEL moved or stopped looking like a model
    // id — and the check below would have been silently comparing against an
    // empty-ish set.
    expect(
      sourceIds.has(DEFAULT_CLAUDE_MODEL),
      `DEFAULT_CLAUDE_MODEL ("${DEFAULT_CLAUDE_MODEL}") is not matched by the model-id shape ` +
        `patterns in this test. Update MODEL_ID_PATTERNS in tests/unit/docs/model-ids.test.ts.`,
    ).toBe(true);
    expect(sourceIds.size).toBeGreaterThan(1);
  });

  it('every model ID named in the docs is a model the code knows about', () => {
    const known = [...sourceIds].sort();
    const findings: Finding[] = [];

    for (const re of MODEL_ID_PATTERNS) {
      for (const hit of scanDocs(re)) {
        if (sourceIds.has(hit.token)) continue;
        findings.push({
          relPath: hit.doc.relPath,
          line: hit.line,
          found: hit.token,
          detail:
            `no such model ID in src/. Model IDs used by the code: ${known.join(', ')}. ` +
            `Replace it with one of those (the current default is "${DEFAULT_CLAUDE_MODEL}").`,
        });
      }
    }

    expect(
      findings,
      formatFindings('DOC-12: stale/unknown model IDs in live documentation:', findings),
    ).toEqual([]);
  });
});
