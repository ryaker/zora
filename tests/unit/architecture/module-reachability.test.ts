/**
 * Every module is reachable from an entry point — ARCH-01.
 *
 * The recurring defect in this codebase is not a broken module, it is a module
 * that was built, unit-tested, documented, and then connected to nothing. The
 * unit tests pass because they construct the thing themselves; the docs
 * describe a capability nobody can reach; and no test fails, because a
 * component that never runs is indistinguishable from one that is never
 * chosen.
 *
 * `graph_recall` (MEM-34) is the worked example: 10 unit tests, a benchmark, a
 * CHANGELOG entry claiming it was "exposed to the model", and zero callers in
 * `src/`. Removing its one import reproduces the state exactly — this test
 * reports `tools/graph-tools.ts` as unreachable, which is what should have
 * failed the build the day it landed.
 *
 * The check is a graph walk, not a heuristic. Start at the three real entry
 * points, follow static imports, dynamic `import()`, and `new URL('./x.js',
 * import.meta.url)` worker spawns. Anything not reached cannot execute, no
 * matter what its own tests say.
 *
 * What this does NOT catch — worth knowing so it is not over-trusted — is
 * *mis*-wiring: a module that is imported and runs, but in fewer places than
 * it should. `initGlobalForecaster` was reachable the whole time it was
 * missing from the `ask` path (see `tests/security/singleton-parity.test.ts`).
 * Reachability is the floor, not the ceiling.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src');

/** Where execution can actually begin. */
const ENTRY_POINTS = [
  'index.ts',      // library consumers
  'cli/index.ts',  // zora-agent ask (one-shot)
  'cli/daemon.ts', // zora-agent start (long-running)
];

/**
 * Modules that are deliberately unreachable.
 *
 * Every entry is a standing claim that shipping this file connected to nothing
 * is intentional. Prefer deleting the file to adding a line here.
 */
const ALLOWED_UNREACHABLE: { file: string; rationale: string }[] = [
  // channels/webhook-server.ts was here, dead since v0.11.0, with the standing
  // condition "do not wire it up without implementing that signature validation
  // first". INVARIANT-10 validation now exists in channels/webhook-signatures.ts
  // and the server is constructed from cli/daemon.ts when a platform delivers
  // by webhook, so the file is reachable and the exemption is gone.
  {
    file: 'hooks/index.ts',
    rationale:
      're-export barrel only, no logic. Consumers import the concrete hook modules directly ' +
      'and src/index.ts does not re-export hooks/, so nothing walks through this file.',
  },
  {
    file: 'security/index.ts',
    rationale:
      're-export barrel only, no logic. src/index.ts exposes security/policy-engine.js ' +
      'directly rather than the barrel, so this file is never on an import path.',
  },
  {
    file: 'skills/index.ts',
    rationale:
      're-export barrel only, no logic. The skill loader/installer are imported by their ' +
      'concrete paths from the orchestrator and CLI.',
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // The dashboard's React frontend is a browser bundle with its own entry.
      if (entry.name === 'node_modules' || entry.name === 'frontend') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const relative = (file: string): string => path.relative(SRC_ROOT, file).split(path.sep).join('/');

/** Resolve a specifier the way Node's ESM resolver would for this project. */
function resolveSpecifier(fromFile: string, specifier: string, known: Set<string>): string | null {
  const asFile = path.resolve(path.dirname(fromFile), specifier.replace(/\.js$/, '.ts'));
  if (known.has(asFile)) return asFile;
  const asDir = path.resolve(path.dirname(fromFile), specifier.replace(/\.js$/, ''), 'index.ts');
  if (known.has(asDir)) return asDir;
  return null;
}

/** Every module this one can hand control to. */
function outgoingEdges(file: string, source: string, known: Set<string>): string[] {
  const specifiers = new Set<string>();
  for (const m of source.matchAll(/from\s*['"](\.[^'"]+)['"]/g)) specifiers.add(m[1]);
  for (const m of source.matchAll(/import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)) specifiers.add(m[1]);
  // Side-effect imports have no `from` clause. Missing these made the
  // allowlist-staleness check silently unfalsifiable: a module could become
  // reachable by `import './x.js'` and still be reported as stranded.
  for (const m of source.matchAll(/^\s*import\s*['"](\.[^'"]+)['"]\s*;?\s*$/gm)) specifiers.add(m[1]);

  // There is deliberately no `new URL('./x.js', import.meta.url)` rule here.
  // An earlier version had one, on the assumption that the graph tier spawned
  // its worker that way. It does not — it is self-hosting, spawning
  // `new Worker(import.meta.url)` (or an eval'd bootstrap), and reaches
  // `worker-bootstrap.ts` by ordinary static import. The rule matched zero call
  // sites in `src/`, and `new URL()` does not load or execute a module, so
  // keeping it could only ever mark something reachable that is not. If a
  // worker is ever spawned from a URL literal, add the edge for the *Worker
  // constructor* rather than for every `new URL()`.

  const edges: string[] = [];
  for (const specifier of specifiers) {
    const resolved = resolveSpecifier(file, specifier, known);
    if (resolved) edges.push(resolved);
  }
  return edges;
}

function reachableFiles(): { reachable: Set<string>; all: string[] } {
  const all = walk(SRC_ROOT);
  const known = new Set(all);
  const source = new Map(all.map(f => [f, fs.readFileSync(f, 'utf-8')]));

  const entries = ENTRY_POINTS.map(p => path.join(SRC_ROOT, p)).filter(p => known.has(p));
  const reachable = new Set(entries);
  const queue = [...entries];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const next of outgoingEdges(current, source.get(current)!, known)) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  return { reachable, all };
}

describe('ARCH-01 — no module is stranded', () => {
  it('finds every entry point — a renamed entry would strand the whole tree', () => {
    for (const entry of ENTRY_POINTS) {
      expect(fs.existsSync(path.join(SRC_ROOT, entry)), `entry point src/${entry} is missing`).toBe(true);
    }
  });

  it('reaches every module in src/ from an entry point', () => {
    const { reachable, all } = reachableFiles();
    const allowed = new Set(ALLOWED_UNREACHABLE.map(e => e.file));
    const stranded = all.map(relative).filter(f => !reachable.has(path.join(SRC_ROOT, f.split('/').join(path.sep))) && !allowed.has(f)).sort();

    expect(
      stranded,
      stranded.length === 0
        ? ''
        : `ARCH-01: these modules cannot be reached from any entry point, so nothing ` +
          `in them can ever run:\n` +
          stranded.map(f => `  src/${f}`).join('\n') +
          `\n\nTheir own tests will still pass — a test that constructs the module itself ` +
          `supplies the wiring production is missing. That is exactly how graph_recall ` +
          `shipped with 10 green tests and no way for the agent to call it (MEM-34). ` +
          `Wire the module into a path that runs, or delete it. Add it to ` +
          `ALLOWED_UNREACHABLE only if shipping it connected to nothing is deliberate.`,
    ).toEqual([]);
  });

  it('keeps the allowlist honest — every entry must still exist and be unreachable', () => {
    const { reachable } = reachableFiles();
    for (const entry of ALLOWED_UNREACHABLE) {
      const full = path.join(SRC_ROOT, entry.file.split('/').join(path.sep));
      expect(fs.existsSync(full), `ALLOWED_UNREACHABLE lists src/${entry.file}, which no longer exists`).toBe(true);
      // If it became reachable, the exemption is stale and should be dropped —
      // otherwise the list slowly turns into a place things go to be forgotten.
      expect(
        reachable.has(full),
        `src/${entry.file} is reachable now — remove it from ALLOWED_UNREACHABLE`,
      ).toBe(false);
      expect(entry.rationale.length, `src/${entry.file} is exempt with no rationale`).toBeGreaterThan(60);
    }
  });
});
