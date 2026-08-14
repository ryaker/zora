/**
 * DOC-12 — config/policy key drift guard for `docs/configuration.md`.
 *
 * Drift this prevents, in two directions:
 *
 *   1. **Lies** — a documented key that the loader does not read. The user sets
 *      it, nothing happens, and there is no error to tell them. This fails the
 *      build.
 *   2. **Silence** — a real config or policy key documented nowhere. This is a
 *      smaller sin (nothing breaks; the key just goes undiscovered), so it is
 *      reported as a warning list on stderr rather than a failure — unless the
 *      undocumented share gets egregious, at which point the reference has
 *      stopped being a reference.
 *
 * How it decides:
 *   - Documented keys come from `docs/configuration.md`: both the TOML fences
 *     and the `| \`field\` | type | default | description |` tables, attributed
 *     to the nearest preceding `[section]` heading.
 *   - Real keys come from the code: `DEFAULT_CONFIG` (walked at runtime, which
 *     gives exact dotted paths) plus every property declared by an interface in
 *     `src/types.ts` whose name ends in `Config`, `Policy` or `Entry` — that is
 *     the config/policy surface, and it covers optional fields that have no
 *     default to walk.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';
import { formatFindings, readRepoFile, stripTsComments, type Finding } from './doc-drift-helpers.js';

const CONFIG_DOC = 'docs/configuration.md';

/**
 * Tables whose *keys* are user-chosen rather than schema-defined. Anything
 * documented underneath them is an example, not a claim about the schema.
 *   - `budget.max_actions_per_type` is `Record<string, number>` (action names)
 *   - `mcp.servers` is `Record<string, McpServerEntry>` (server names)
 *   - `actions.scores` / `actions.thresholds` are free-form score maps
 */
const OPEN_SECTIONS = [
  'budget.max_actions_per_type',
  'mcp.servers',
  'actions.scores',
  'actions.thresholds',
];

/**
 * Schema keys that intentionally have no place in the reference: internal or
 * derived fields a user never writes into a TOML file. Kept short and explicit
 * — every entry here is a decision not to document something.
 */
const NOT_USER_FACING = new Set<string>([
  'providers', // documented as `[[providers]]`, an array of tables, not a key
]);

interface DocKey {
  /** Dotted section, e.g. `agent.resources` or `providers`. */
  section: string;
  key: string;
  line: number;
}

/** Every key `docs/configuration.md` claims exists. */
function documentedKeys(): DocKey[] {
  const lines = readRepoFile(CONFIG_DOC).split('\n');
  const out: DocKey[] = [];
  let headingSection = '';
  let fenceSection = '';
  let inFence = false;
  // Only tables whose header row is `| Field | ... |` declare schema keys. The
  // reference also has value tables ("Routing modes", "Action categories")
  // whose first column is a *value*, not a key.
  let inFieldTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (!inFence) {
      if (/^\|\s*Field\s*\|/i.test(line)) {
        inFieldTable = true;
        continue;
      }
      if (!line.trimStart().startsWith('|')) inFieldTable = false;
    }

    if (/^\s*```/.test(line)) {
      inFence = /^\s*```toml/.test(line) ? true : false;
      if (inFence) fenceSection = headingSection;
      continue;
    }

    if (inFence) {
      const table = /^\s*\[\[?([A-Za-z0-9_.<>-]+)\]\]?\s*$/.exec(line);
      if (table) {
        fenceSection = table[1]!;
        continue;
      }
      const kv = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (kv) out.push({ section: fenceSection, key: kv[1]!, line: i + 1 });
      continue;
    }

    // `### \`[agent]\``, `#### \`[agent.resources]\``, `### \`[[providers]]\``
    const heading = /^#+\s+`?\[\[?([A-Za-z0-9_.<>-]+)\]\]?`?/.exec(line);
    if (heading) {
      headingSection = heading[1]!.replace(/\.<name>$/, '');
      continue;
    }

    // Field table row: `| \`key\` | type | default | description |`
    const row = /^\|\s*`([A-Za-z_][A-Za-z0-9_]*)`\s*\|/.exec(line);
    if (row && inFieldTable && headingSection) {
      out.push({ section: headingSection, key: row[1]!, line: i + 1 });
    }
  }
  return out;
}

/**
 * Dotted paths of every key that has a default, e.g. `memory.compression.enabled`.
 * `leaves` excludes container objects — those are documented as `[section]`
 * headings, not as table rows, so they must not show up as "undocumented".
 */
function defaultConfigPaths(): { all: Set<string>; leaves: Set<string> } {
  const all = new Set<string>();
  const leaves = new Set<string>();
  const walk = (obj: unknown, prefix: string): void => {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const dotted = prefix ? `${prefix}.${k}` : k;
      all.add(dotted);
      const isContainer = v !== null && typeof v === 'object' && !Array.isArray(v);
      if (isContainer) walk(v, dotted);
      else leaves.add(dotted);
    }
  };
  walk(DEFAULT_CONFIG, '');
  return { all, leaves };
}

/**
 * Every property name declared by a `*Config` / `*Policy` / `*Entry` interface
 * in `src/types.ts`, at any nesting depth. Used as the permissive check for
 * "does this key exist at all", so that optional fields with no default (e.g.
 * `routing.provider_only_name`, `steering.telegram.bot_token`) are not
 * miscounted as lies.
 */
function schemaPropertyNames(): Set<string> {
  const src = stripTsComments(readRepoFile('src/types.ts'));
  const names = new Set<string>();
  const header = /export\s+interface\s+(\w*(?:Config|Policy|Entry))\b[^{]*\{/g;

  for (const m of src.matchAll(header)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    const body = src.slice(start, i - 1);
    for (const p of body.matchAll(/(?:^|[;{,])\s*(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\??\s*:/g)) {
      names.add(p[1]!);
    }
  }
  return names;
}

describe('DOC-12: documented config keys exist in the schema', () => {
  const docKeys = documentedKeys();
  const { all: defaults, leaves: defaultLeaves } = defaultConfigPaths();
  const schemaNames = schemaPropertyNames();

  it('parses a plausible number of keys out of the reference and the schema', () => {
    expect(docKeys.length, `DOC-12: parsed no keys out of ${CONFIG_DOC}.`).toBeGreaterThan(40);
    expect(schemaNames.size, 'DOC-12: parsed no *Config/*Policy interfaces out of src/types.ts.')
      .toBeGreaterThan(40);
  });

  it('no documented key is invented', () => {
    const findings: Finding[] = [];

    for (const dk of docKeys) {
      if (OPEN_SECTIONS.some((s) => dk.section === s || dk.section.startsWith(`${s}.`))) continue;
      const dotted = dk.section ? `${dk.section}.${dk.key}` : dk.key;
      if (defaults.has(dotted)) continue;
      if (schemaNames.has(dk.key)) continue;
      findings.push({
        relPath: CONFIG_DOC,
        line: dk.line,
        found: `${dk.section ? `[${dk.section}] ` : ''}${dk.key}`,
        detail:
          `no such field: \`${dotted}\` is absent from DEFAULT_CONFIG (src/config/defaults.ts) ` +
          `and no *Config/*Policy interface in src/types.ts declares \`${dk.key}\`. ` +
          `Either wire it up in src/ or delete the row — as written, a user who sets it gets silence.`,
      });
    }

    expect(
      findings,
      formatFindings(`DOC-12: ${CONFIG_DOC} documents keys the code does not have:`, findings),
    ).toEqual([]);
  });

  it('reports schema keys that are documented nowhere', () => {
    const documented = new Set(docKeys.map((d) => d.key));
    const undocumented = [...defaultLeaves]
      .map((p) => ({ path: p, leaf: p.split('.').pop()! }))
      .filter(({ path, leaf }) => {
        if (NOT_USER_FACING.has(path) || NOT_USER_FACING.has(leaf)) return false;
        if (OPEN_SECTIONS.some((s) => path === s || path.startsWith(`${s}.`))) return false;
        // Section names themselves (`agent`, `memory`) are headings, not rows.
        if (!path.includes('.')) return false;
        return !documented.has(leaf);
      })
      .map(({ path }) => path)
      .sort();

    if (undocumented.length > 0) {
      // Warning, not a failure: an undocumented key is a smaller sin than a
      // documented key that does not exist. It still belongs in the DOC-11
      // work list, so it is printed every run.
      console.warn(
        `\nDOC-12 WARNING: ${undocumented.length} config key(s) exist in DEFAULT_CONFIG but are ` +
          `documented nowhere in ${CONFIG_DOC}:\n` +
          undocumented.map((p) => `  - ${p}`).join('\n') +
          `\n`,
      );
    }

    // Egregious threshold: if a third of the defaulted surface is undocumented,
    // the reference has stopped being a reference and this is no longer a warning.
    const total = [...defaultLeaves].filter((p) => p.includes(".")).length;
    expect(
      undocumented.length,
      `DOC-12: ${undocumented.length} of ${total} defaulted config keys are undocumented in ` +
        `${CONFIG_DOC} — over a third of the surface. See the warning above for the list.`,
    ).toBeLessThan(total / 3);
  });
});
