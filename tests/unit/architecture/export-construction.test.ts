/**
 * Every exported class is constructed somewhere in src/ — ARCH-02.
 *
 * ARCH-01 (`module-reachability.test.ts`) asks whether there is an *import*
 * path from an entry point to a file. That is a real question, but it is a
 * weaker one than it looks, because a type-only import satisfies it. A module
 * can be "reachable" while the thing it exports is never built.
 *
 * `BridgeWatchdog` is the worked example, and it is the reason this file
 * exists. Before #179 it was imported for its type, reported as reachable by
 * ARCH-01, covered by 10 unit tests, and constructed exactly zero times in
 * `src/` against 12 times in `tests/`. The highest-WSJF gap on the tracker
 * (ERR-21, "the watchdog fails open") therefore had its fix land on a class
 * the daemon never instantiated. Every green test was honest and the
 * capability still did not exist.
 *
 * Deleting the single `new BridgeWatchdog(...)` in `src/cli/daemon.ts`
 * reproduces that state exactly — the type-only use on daemon.ts:275 keeps
 * ARCH-01 green — and this test reports it. That is the mutation check for
 * this guard; re-run it if you change the walk.
 *
 * One caveat for whoever changes the `extends` credit next: it has no live
 * subject. The only three subclasses in `src/` extend the built-in `Error`,
 * so the fixed point currently propagates credit to nothing, and no existing
 * code would notice if it broke. It was verified by injecting a subclass in
 * both configurations — constructed (base must be credited) and unconstructed
 * (base must still be reported) — rather than by any case already here.
 *
 * The check runs on the TypeScript AST rather than on a regex over the text,
 * for one specific reason: this codebase comments heavily, and several
 * comments narrate constructor calls in prose (`enforced-sdk-options.ts`
 * describes "three separate `new ExecutionLoop({...})` literals"). A textual
 * scan credits a class for being *discussed*. Only a real NewExpression counts
 * here — comments and string literals are not AST nodes.
 *
 * What this does NOT catch, so that it is not over-trusted:
 *
 *  - A class constructed only inside its own defining file, by a factory that
 *    nobody calls. Nine classes are legitimately constructed only in their own
 *    file (module-local singletons), so requiring a cross-file construction
 *    would be nine false positives, not a stronger guard.
 *  - A class constructed on a code path that is never taken. Construction is
 *    the floor, the same way reachability is: it proves the wiring exists, not
 *    that it runs. `tests/security/singleton-parity.test.ts` is the test that
 *    asks whether a booted Orchestrator actually holds the thing.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const TESTS_ROOT = path.join(REPO_ROOT, 'tests');

/**
 * Exported classes that are deliberately never constructed in src/.
 *
 * Every entry is a standing claim that shipping a class the product never
 * builds is intentional. Prefer deleting the class, or wiring it to the path
 * its tests pretend it is on, to adding a line here.
 */
const ALLOWED_UNCONSTRUCTED: { name: string; rationale: string }[] = [];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Same exclusions as ARCH-01: the dashboard's React frontend is a
      // browser bundle with its own entry point and its own build.
      if (entry.name === 'node_modules' || entry.name === 'frontend') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true);

const hasExportModifier = (node: ts.ClassDeclaration): boolean =>
  (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword);

interface ExportedClass {
  name: string;
  file: string;
}

interface SrcFacts {
  /** Exported classes, by name. */
  exported: ExportedClass[];
  /** Names declared more than once anywhere in src/ — see the uniqueness test. */
  duplicates: string[];
  /** Base classes of each declared class, keyed by subclass name. */
  bases: Map<string, string[]>;
}

/** Every class declared in src/, what it extends, and whether it is exported. */
function readSrc(): SrcFacts {
  const exported: ExportedClass[] = [];
  const bases = new Map<string, string[]>();
  const seen = new Map<string, number>();

  for (const file of walk(SRC_ROOT)) {
    const source = parse(file);
    const declared = new Map<string, ts.ClassDeclaration>();
    const exportedNames = new Set<string>();
    const localExportClause = new Set<string>();

    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) && node.name) {
        const name = node.name.text;
        declared.set(name, node);
        if (hasExportModifier(node)) exportedNames.add(name);

        // `extends X` is a construction path: if a subclass is built, its base
        // is built with it. Recorded for every class, exported or not, because
        // a private subclass can be what keeps an exported base alive.
        for (const clause of node.heritageClauses ?? []) {
          if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
          for (const type of clause.types) {
            const base = nameOf(type.expression);
            if (base) bases.set(name, [...(bases.get(name) ?? []), base]);
          }
        }
      }
      // `class X {}` … `export { X }` exports just as effectively as the
      // modifier does. Zero classes use this form today; it is covered so the
      // form is not an accidental way out of the guard.
      if (
        ts.isExportDeclaration(node) &&
        !node.moduleSpecifier &&
        node.exportClause &&
        ts.isNamedExports(node.exportClause)
      ) {
        for (const element of node.exportClause.elements) {
          localExportClause.add((element.propertyName ?? element.name).text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    for (const name of declared.keys()) {
      seen.set(name, (seen.get(name) ?? 0) + 1);
      if (exportedNames.has(name) || localExportClause.has(name)) {
        exported.push({ name, file: path.relative(SRC_ROOT, file).split(path.sep).join('/') });
      }
    }
  }

  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([name]) => name).sort();
  return { exported, duplicates, bases };
}

/** The identifier a `new` targets: `new Foo()` and `new mod.Foo()` both give `Foo`. */
function nameOf(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

/** Class names appearing in a real `new` expression under `root`. */
function constructedNames(root: string): Map<string, string[]> {
  const sites = new Map<string, string[]>();
  for (const file of walk(root)) {
    const source = parse(file);
    const visit = (node: ts.Node): void => {
      if (ts.isNewExpression(node)) {
        const name = nameOf(node.expression);
        if (name) {
          const where = path.relative(REPO_ROOT, file).split(path.sep).join('/');
          const existing = sites.get(name) ?? [];
          if (!existing.includes(where)) sites.set(name, [...existing, where]);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return sites;
}

/**
 * Names that are built in src/, directly or through a subclass.
 *
 * Fixed point rather than a blanket "anything with a subclass is fine": a base
 * whose only subclass is itself never constructed stays uncredited, which is
 * the honest answer.
 */
function creditedNames(directlyConstructed: Set<string>, bases: Map<string, string[]>): Set<string> {
  const credited = new Set(directlyConstructed);
  for (;;) {
    let grew = false;
    for (const subclass of [...credited]) {
      for (const base of bases.get(subclass) ?? []) {
        if (!credited.has(base)) {
          credited.add(base);
          grew = true;
        }
      }
    }
    if (!grew) return credited;
  }
}

describe('ARCH-02 — no exported class is built only by its own tests', () => {
  const facts = readSrc();
  const srcSites = constructedNames(SRC_ROOT);
  const testSites = constructedNames(TESTS_ROOT);
  const credited = creditedNames(new Set(srcSites.keys()), facts.bases);

  it('finds the exported classes at all — an empty walk would assert nothing', () => {
    // A guard that silently stops seeing its subject passes forever. If the
    // src layout moves and this walk returns nothing, fail here rather than
    // report a clean bill of health over an empty set.
    expect(facts.exported.length).toBeGreaterThan(50);
  });

  it('constructs every exported class somewhere in src/', () => {
    const allowed = new Set(ALLOWED_UNCONSTRUCTED.map(e => e.name));
    const offenders = facts.exported
      .filter(c => !credited.has(c.name) && !allowed.has(c.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    const describeOffender = (c: ExportedClass): string => {
      const inTests = testSites.get(c.name) ?? [];
      const verdict = inTests.length
        ? `built only by tests, in ${inTests.length} file(s): ${inTests.join(', ')}`
        : 'built nowhere at all, tests included';
      return `  ${c.name} (src/${c.file}) — ${verdict}`;
    };

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `ARCH-02: these exported classes are never constructed in src/, so the ` +
          `product never builds them:\n` +
          offenders.map(describeOffender).join('\n') +
          `\n\nA class built only by its own tests is a capability that does not ` +
          `exist: the tests supply the wiring production is missing, so they pass ` +
          `whether or not anything is connected. Importing the module for its type ` +
          `is not wiring — that is what made BridgeWatchdog look reachable to ` +
          `ARCH-01 while the daemon never instantiated it (#179), and it is why a ` +
          `fix for the top-scored gap landed on dead code. Construct it on a path ` +
          `that runs, or delete it. Add it to ALLOWED_UNCONSTRUCTED only if ` +
          `shipping a class the product never builds is deliberate.`,
    ).toEqual([]);
  });

  it('keeps class names unique — the walk credits by name, not by symbol', () => {
    // Two classes sharing a name would let a constructed one vouch for an
    // unconstructed one. There are none today; if that changes, this guard has
    // to resolve imports rather than match names, and should say so loudly
    // instead of quietly getting weaker.
    expect(
      facts.duplicates,
      `these class names are declared more than once in src/, so ARCH-02 can no ` +
        `longer tell the constructed one from the unconstructed one: ${facts.duplicates.join(', ')}`,
    ).toEqual([]);
  });

  it('keeps the allowlist honest — every entry must exist and still be unconstructed', () => {
    const exportedNames = new Set(facts.exported.map(c => c.name));
    for (const entry of ALLOWED_UNCONSTRUCTED) {
      expect(
        exportedNames.has(entry.name),
        `ALLOWED_UNCONSTRUCTED lists ${entry.name}, which is no longer an exported class in src/`,
      ).toBe(true);
      expect(
        credited.has(entry.name),
        `${entry.name} is constructed in src/ now — remove it from ALLOWED_UNCONSTRUCTED`,
      ).toBe(false);
      expect(entry.rationale.length, `${entry.name} is exempt with no rationale`).toBeGreaterThan(60);
    }
  });
});
