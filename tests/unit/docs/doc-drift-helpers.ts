/**
 * DOC-12 — shared scanning helpers for the documentation drift guard.
 *
 * Everything here is plain `node:fs` + regex on purpose. The drift guard has to
 * be cheap enough to live in the normal `npm run test:unit` run, so it must not
 * pull in a TypeScript parser, a TOML parser, or the network. It reads text
 * files and reports `file:line` positions.
 *
 * Each `*.test.ts` in this directory carries its own header explaining the one
 * kind of drift it prevents. This file only provides the plumbing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

/**
 * Documentation the guard treats as *live claims about the current code*.
 *
 * `docs/archive/`, `docs/reviews/` and `docs/research/` are deliberately
 * excluded: they are dated historical records (superseded specs, the August
 * 2026 review) and are supposed to keep saying what was true when they were
 * written. Rewriting them to match today's code would destroy their value.
 *
 * Adding a doc to the guard is a one-line change here.
 */
export const DOC_ROOTS = ['README.md', 'SECURITY.md', 'CLAUDE.md', 'docs'];

export const EXCLUDED_DOC_DIRS = ['docs/archive', 'docs/reviews', 'docs/research'];

/**
 * Escape hatch for prose that legitimately names something the code no longer
 * contains — "v0.11 defaulted to claude-sonnet-4-5", a historical CLI command
 * in a migration note, and so on.
 *
 * A doc author opts in explicitly by putting the marker on the offending line
 * or on one of the two lines above it:
 *
 *   <!-- docs-drift-allow: claude-sonnet-4-5 — historical, pre-SDK-04 default -->
 *   # docs-drift-allow: gemini-1.5-pro   (inside a fenced code block)
 *
 * It is deliberately greppable: `grep -rn "docs-drift-allow" README.md docs/`
 * lists every claim the guard has been told to stop checking.
 */
export const ALLOW_MARKER = 'docs-drift-allow';

/** How many lines above a finding an allow marker may sit and still apply. */
const ALLOW_LOOKBACK = 2;

export interface DocFile {
  /** Repo-relative path, e.g. `docs/configuration.md`. */
  relPath: string;
  /** Absolute path on disk. */
  absPath: string;
  /** File content split on newlines; index 0 is line 1. */
  lines: string[];
}

export interface Finding {
  relPath: string;
  /** 1-based. */
  line: number;
  /** The literal text that is wrong. */
  found: string;
  /** What it should say, or why it is wrong. */
  detail: string;
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(REPO_ROOT, abs);
    if (entry.isDirectory()) {
      if (EXCLUDED_DOC_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`))) continue;
      walk(abs, out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(abs);
    }
  }
}

let cachedDocs: DocFile[] | undefined;

/** Every markdown file the guard considers a live claim about the code. */
export function loadDocs(): DocFile[] {
  if (cachedDocs) return cachedDocs;
  const absPaths: string[] = [];
  for (const root of DOC_ROOTS) {
    const abs = path.join(REPO_ROOT, root);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) walk(abs, absPaths);
    else absPaths.push(abs);
  }
  absPaths.sort();
  cachedDocs = absPaths.map((absPath) => ({
    absPath,
    relPath: path.relative(REPO_ROOT, absPath),
    lines: fs.readFileSync(absPath, 'utf8').split('\n'),
  }));
  return cachedDocs;
}

/** Read a repo file as text. Throws loudly if the path moved — that is drift too. */
export function readRepoFile(relPath: string): string {
  const abs = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `DOC-12: expected ${relPath} to exist — the drift guard reads it as a source of truth. ` +
        `If the file moved, update tests/unit/docs/.`,
    );
  }
  return fs.readFileSync(abs, 'utf8');
}

/**
 * True when the author explicitly opted this occurrence out with an allow
 * marker naming the offending token (or naming nothing, which allows the whole
 * line).
 */
export function isAllowed(doc: DocFile, lineIdx: number, token: string): boolean {
  for (let i = Math.max(0, lineIdx - ALLOW_LOOKBACK); i <= lineIdx; i++) {
    const line = doc.lines[i];
    if (line === undefined) continue;
    const at = line.indexOf(ALLOW_MARKER);
    if (at === -1) continue;
    // `docs-drift-allow` with no token allows everything on the line;
    // `docs-drift-allow: <token>` allows only that token.
    const listed = line
      .slice(at + ALLOW_MARKER.length)
      .replace(/-->\s*$/, '')
      .replace(/^:?\s*/, '')
      .trim();
    if (listed === '' || listed.includes(token)) return true;
  }
  return false;
}

/**
 * Find every match of `re` across the doc set, skipping allowed occurrences.
 * `re` must be a global regex; capture group 1 is used as the token if present.
 */
export function scanDocs(
  re: RegExp,
  docs: DocFile[] = loadDocs(),
): Array<{ doc: DocFile; line: number; token: string }> {
  const hits: Array<{ doc: DocFile; line: number; token: string }> = [];
  for (const doc of docs) {
    for (let i = 0; i < doc.lines.length; i++) {
      const line = doc.lines[i]!;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const token = m[1] ?? m[0];
        if (!isAllowed(doc, i, token)) hits.push({ doc, line: i + 1, token });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
  }
  return hits;
}

/** Render findings as a block someone can fix the docs from, without opening this test. */
export function formatFindings(header: string, findings: Finding[]): string {
  const body = findings
    .map((f) => `  ${f.relPath}:${f.line}\n      found:  ${f.found}\n      fix:    ${f.detail}`)
    .join('\n');
  return `${header}\n${body}\n\n  (${findings.length} occurrence${
    findings.length === 1 ? '' : 's'
  }. If one is a deliberate historical mention, add an inline\n   \`${ALLOW_MARKER}: <token>\` comment on or just above that line.)`;
}

/**
 * Strip comments from TypeScript source before regex-scanning it.
 *
 * Line comments are removed wholesale, which also truncates anything after a
 * `//` inside a string literal (e.g. `"http://localhost:11434"`). That is
 * harmless for the declaration scanning done here and keeps the helper to four
 * lines instead of a tokenizer.
 */
export function stripTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}
