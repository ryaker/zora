/**
 * DOC-12 — self-test for the drift guard's escape hatch.
 *
 * The other tests in this directory are only safe to enforce because a doc
 * author can opt a genuinely historical sentence out ("v0.11 defaulted to
 * claude-sonnet-4-5"). If the marker silently stopped working, the guard would
 * either block honest prose or — worse, if it started matching too eagerly —
 * quietly stop checking anything. Both failure modes are covered here.
 */

import { describe, it, expect } from 'vitest';
import { ALLOW_MARKER, isAllowed, type DocFile } from './doc-drift-helpers.js';

function doc(...lines: string[]): DocFile {
  return { relPath: 'test.md', absPath: '/test.md', lines };
}

describe('DOC-12: docs-drift-allow marker', () => {
  it('suppresses a named token on the same line', () => {
    const d = doc(`Older builds used \`claude-sonnet-4-5\`. <!-- ${ALLOW_MARKER}: claude-sonnet-4-5 -->`);
    expect(isAllowed(d, 0, 'claude-sonnet-4-5')).toBe(true);
  });

  it('suppresses a named token from up to two lines above', () => {
    const d = doc(`<!-- ${ALLOW_MARKER}: claude-sonnet-4-5 historical -->`, '', 'model = "claude-sonnet-4-5"');
    expect(isAllowed(d, 2, 'claude-sonnet-4-5')).toBe(true);
  });

  it('does not reach further than two lines back', () => {
    const d = doc(`<!-- ${ALLOW_MARKER}: claude-sonnet-4-5 -->`, '', '', 'model = "claude-sonnet-4-5"');
    expect(isAllowed(d, 3, 'claude-sonnet-4-5')).toBe(false);
  });

  it('only suppresses the token it names', () => {
    const d = doc(`gemini-1.0-pro and claude-sonnet-4-5 <!-- ${ALLOW_MARKER}: claude-sonnet-4-5 -->`);
    expect(isAllowed(d, 0, 'claude-sonnet-4-5')).toBe(true);
    expect(isAllowed(d, 0, 'gemini-1.0-pro')).toBe(false);
  });

  it('suppresses the whole line when no token is named', () => {
    const d = doc(`legacy example <!-- ${ALLOW_MARKER} -->`);
    expect(isAllowed(d, 0, 'anything-at-all')).toBe(true);
  });

  it('does nothing on an unmarked line', () => {
    const d = doc('model = "claude-sonnet-4-5"');
    expect(isAllowed(d, 0, 'claude-sonnet-4-5')).toBe(false);
  });
});
