/**
 * DOC-12 — Claude Agent SDK version drift guard.
 *
 * Drift this prevents: docs quoting an SDK version Zora no longer depends on.
 * This has already bitten once — the tree was on `@anthropic-ai/claude-agent-sdk`
 * 0.3.x while the docs still described 0.2.76 behaviour, which meant the
 * documented hook/permission surface did not exist in the installed package.
 * A reader debugging an enforcement question was reading about a different SDK.
 *
 * How it decides: `package.json` is the source of truth. Any version-looking
 * string that appears near a mention of the SDK package in the live docs must
 * quote the same version as the dependency range.
 */

import { describe, it, expect } from 'vitest';
import {
  formatFindings,
  loadDocs,
  isAllowed,
  readRepoFile,
  type Finding,
} from './doc-drift-helpers.js';

const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';

/** Matches `0.3.232`, `^0.3.232`, `v0.3.232`, `0.2.76`. */
const VERSION_RE = /[v^~]?\d+\.\d+\.\d+/g;

function declaredSdkRange(): string {
  const pkg = JSON.parse(readRepoFile('package.json')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const range = pkg.dependencies?.[SDK_PACKAGE] ?? pkg.devDependencies?.[SDK_PACKAGE];
  if (!range) {
    throw new Error(
      `DOC-12: ${SDK_PACKAGE} is not in package.json dependencies — the drift guard reads it ` +
        `as the source of truth for the documented SDK version.`,
    );
  }
  return range;
}

describe('DOC-12: SDK version claims in docs match package.json', () => {
  const range = declaredSdkRange();
  const declaredVersion = range.replace(/^[v^~>=<\s]+/, '');

  it('reads a concrete version range from package.json', () => {
    expect(declaredVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('every SDK version quoted in the docs matches the installed range', () => {
    const findings: Finding[] = [];

    for (const doc of loadDocs()) {
      for (let i = 0; i < doc.lines.length; i++) {
        const line = doc.lines[i]!;
        // Only lines that actually name the SDK package make a claim about its
        // version. A bare `0.12.0` elsewhere is Zora's own version, not the SDK's.
        if (!line.includes(SDK_PACKAGE) && !/claude[- ]agent[- ]sdk/i.test(line)) continue;

        VERSION_RE.lastIndex = 0;
        for (const m of line.matchAll(VERSION_RE)) {
          const quoted = m[0];
          const bare = quoted.replace(/^[v^~]/, '');
          if (bare === declaredVersion) continue;
          if (isAllowed(doc, i, quoted)) continue;
          findings.push({
            relPath: doc.relPath,
            line: i + 1,
            found: quoted,
            detail: `package.json pins "${SDK_PACKAGE}": "${range}" — write ${range} (or ${declaredVersion}).`,
          });
        }
      }
    }

    expect(
      findings,
      formatFindings('DOC-12: stale Claude Agent SDK versions in live documentation:', findings),
    ).toEqual([]);
  });
});
