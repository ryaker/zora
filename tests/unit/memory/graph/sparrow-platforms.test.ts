/**
 * The loader's platform gate matches the installed sparrowdb — MEM-30.
 *
 * `sparrow-loader.ts` hardcodes the platforms sparrowdb publishes a prebuilt
 * binary for, and refuses to even attempt the import anywhere else. That list
 * is a claim about a third-party package, so it goes stale silently on the one
 * event nobody re-reads it for: a dependency bump.
 *
 * It did. The set said `linux-x64`, `darwin-arm64`, `darwin-x64` while
 * sparrowdb had been publishing `linux-arm64-gnu` and `win32-x64-msvc` since
 * 0.1.24. On ARM Linux — Graviton, ARM CI runners, Apple-silicon containers —
 * and on Windows, the graph memory tier reported "sparrowdb has no prebuilt
 * binary for this platform" and went inert, without ever trying an import that
 * would have worked. Nothing failed; the tier was simply absent, which is the
 * hardest kind of missing capability to notice.
 *
 * This derives the expectation from the installed package's own
 * `optionalDependencies` instead of restating it, so the next bump either
 * agrees or fails here.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SPARROW_PKG = path.join(REPO_ROOT, 'node_modules', 'sparrowdb', 'package.json');
const LOADER = path.join(REPO_ROOT, 'src', 'memory', 'graph', 'sparrow-loader.ts');

/**
 * `@sparrowdb/linux-x64-gnu` → `linux-x64`.
 *
 * The loader keys on `${process.platform}-${process.arch}`, which carries no
 * ABI component, so the trailing `-gnu` / `-msvc` / `-musl` segment is dropped.
 * Two sub-packages can collapse to one key (a musl and a gnu build of the same
 * target); the Set handles that.
 */
function loaderKeyFor(subPackage: string): string {
  const target = subPackage.replace(/^@sparrowdb\//, '');
  const [platform, arch] = target.split('-');
  return `${platform}-${arch}`;
}

/** The platform set as written in the loader source. */
function declaredPlatforms(): Set<string> {
  const source = fs.readFileSync(LOADER, 'utf-8');
  const match = /const SUPPORTED_PLATFORMS = new Set\(\[([\s\S]*?)\]\)/.exec(source);
  if (!match) throw new Error('SUPPORTED_PLATFORMS is no longer a `new Set([...])` literal in sparrow-loader.ts');
  return new Set([...match[1]!.matchAll(/'([^']+)'/g)].map(m => m[1]!));
}

describe('MEM-30 — sparrow-loader platform gate', () => {
  // sparrowdb is an optionalDependency: an install that skipped it, or a
  // platform with no binary, is a supported state. Skipping is correct here —
  // but only when the package is genuinely absent, never as a way to pass.
  const installed = fs.existsSync(SPARROW_PKG);

  it.runIf(installed)('lists exactly the platforms the installed sparrowdb ships', () => {
    const pkg = JSON.parse(fs.readFileSync(SPARROW_PKG, 'utf-8')) as {
      version: string;
      optionalDependencies?: Record<string, string>;
    };
    const subPackages = Object.keys(pkg.optionalDependencies ?? {}).filter(name =>
      name.startsWith('@sparrowdb/'),
    );

    expect(
      subPackages.length,
      `sparrowdb@${pkg.version} declares no @sparrowdb/* platform sub-packages — either the ` +
        `packaging changed shape or this test is reading the wrong manifest, and in both cases ` +
        `the comparison below would be vacuous`,
    ).toBeGreaterThan(0);

    const expected = new Set(subPackages.map(loaderKeyFor));
    const declared = declaredPlatforms();

    const missing = [...expected].filter(p => !declared.has(p)).sort();
    const extra = [...declared].filter(p => !expected.has(p)).sort();

    expect(
      { missing, extra },
      `SUPPORTED_PLATFORMS in sparrow-loader.ts disagrees with sparrowdb@${pkg.version}.\n` +
        (missing.length
          ? `  missing: ${missing.join(', ')} — sparrowdb ships a binary for these and the ` +
            `loader refuses to try, so the graph tier is inert there for no reason\n`
          : '') +
        (extra.length
          ? `  extra: ${extra.join(', ')} — sparrowdb no longer ships these; the loader will ` +
            `attempt an import that cannot resolve and fall back with a confusing reason\n`
          : ''),
    ).toEqual({ missing: [], extra: [] });
  });

  it('reads the platform set out of the loader at all', () => {
    // If the regex above stops matching, `declaredPlatforms()` throws and the
    // comparison never runs. Assert it finds something so a refactor of that
    // literal cannot turn this file into a no-op.
    expect(declaredPlatforms().size).toBeGreaterThan(0);
  });
});
