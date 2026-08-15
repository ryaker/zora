/**
 * Lazy, failure-tolerant loader for the optional `sparrowdb` native module (MEM-30).
 *
 * `sparrowdb` is an optionalDependency with N-API bindings. It can be absent or
 * unloadable for several ordinary reasons:
 *   - `npm install --no-optional`, or an install where the optional dep failed;
 *   - an unsupported platform. As of sparrowdb 0.1.25 the package publishes
 *     prebuilt binaries for five targets: darwin-arm64, darwin-x64,
 *     linux-x64-gnu, linux-arm64-gnu and win32-x64-msvc. This list was
 *     previously "linux-x64-gnu and darwin-arm64 only — no Windows, no
 *     linux-arm64", which stopped being true by 0.1.24 and left the graph tier
 *     refusing to load on ARM Linux and Windows without ever attempting it;
 *   - a published platform sub-package that does not resolve, in which case
 *     `require('sparrowdb')` throws at module-load time.
 *
 * None of those may take Zora down. This module converts every failure mode
 * into `{ available: false, reason }` and logs exactly one warning per process.
 */

import { createLogger } from '../../utils/logger.js';

const log = createLogger('graph-memory');

/** A value that may be bound to a Cypher parameter. */
export type CypherValue = string | number;

/**
 * Bound parameters for {@link SparrowDatabase.executeWithParams}.
 *
 * Keys are **bare names**: `{name: 'Alice'}` binds `$name`. A `$`-prefixed key
 * is an error (`parameter $name was referenced in the query but not supplied`),
 * so the mistake is loud rather than silent — but it is still a mistake.
 */
export type CypherParams = Record<string, CypherValue>;

/** A single result set. */
export interface SparrowResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

/** The subset of the `sparrowdb` surface the graph tier uses. */
export interface SparrowDatabase {
  execute(cypher: string): SparrowResult;
  /**
   * Execute with bound parameters (sparrowdb >= 0.1.23; parameterized `CREATE`
   * since 0.1.24). Values are bound at the plan level and never re-enter the
   * parser, which is what lets the adapter carry no escaper.
   */
  executeWithParams(cypher: string, params: CypherParams): SparrowResult;
  checkpoint(): void;
  optimize(): void;
}

export interface SparrowModule {
  SparrowDB: { open(path: string): SparrowDatabase };
}

export type SparrowLoadResult =
  | { available: true; module: SparrowModule }
  | { available: false; reason: string };

/**
 * Platforms for which `sparrowdb` publishes a prebuilt binary, keyed as
 * `${process.platform}-${process.arch}` — so the npm sub-package's ABI suffix
 * (`-gnu`, `-msvc`) is dropped, since `process.arch` cannot express it.
 *
 * Kept in step with the installed package by
 * `tests/unit/memory/graph/sparrow-platforms.test.ts`, which derives the
 * expected set from sparrowdb's own `optionalDependencies`. Hardcoding drifted
 * once already: this set said linux-x64/darwin-arm64/darwin-x64 while the
 * package had shipped linux-arm64-gnu and win32-x64-msvc since 0.1.24, so the
 * graph tier reported "no prebuilt binary" on ARM Linux and Windows without
 * attempting the load that would have succeeded.
 */
const SUPPORTED_PLATFORMS = new Set([
  'linux-x64',
  'linux-arm64',
  'darwin-arm64',
  'darwin-x64',
  'win32-x64',
]);

let cached: SparrowLoadResult | null = null;
let warned = false;

/** Reset the memoized load result. Test-only. */
export function resetSparrowLoaderCache(): void {
  cached = null;
  warned = false;
}

/**
 * Attempt to load `sparrowdb`.
 *
 * Never throws. The result is memoized, so an unavailable module costs one
 * failed import per process rather than one per call.
 *
 * @param importer Injectable importer, for tests that simulate a missing module.
 */
export async function loadSparrow(
  importer: () => Promise<unknown> = () => import('sparrowdb' as string),
): Promise<SparrowLoadResult> {
  if (cached) return cached;

  const platform = `${process.platform}-${process.arch}`;
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    cached = {
      available: false,
      reason:
        `sparrowdb has no prebuilt binary for ${platform} ` +
        `(supported: ${[...SUPPORTED_PLATFORMS].join(', ')})`,
    };
    warnOnce(cached.reason);
    return cached;
  }

  try {
    const mod = (await importer()) as Record<string, unknown>;

    // `sparrowdb` is CJS with no exports map and assigns `module.exports` from
    // a function call, so Node's cjs-module-lexer cannot detect named exports.
    // Under real Node ESM — which is what Zora runs, `"type": "module"` — the
    // namespace has exactly one key, `default`, and
    // `import { SparrowDB } from 'sparrowdb'` throws
    // "Named export 'SparrowDB' not found". Vite/vitest interops it into named
    // exports instead, so both shapes must be accepted.
    const candidate = (mod.SparrowDB ? mod : (mod.default as Record<string, unknown>)) ?? {};
    const SparrowDB = (candidate as { SparrowDB?: unknown }).SparrowDB;
    if (typeof SparrowDB !== 'function' && typeof SparrowDB !== 'object') {
      cached = { available: false, reason: 'sparrowdb loaded but exported no SparrowDB class' };
      warnOnce(cached.reason);
      return cached;
    }
    cached = { available: true, module: candidate as unknown as SparrowModule };
    return cached;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    cached = { available: false, reason: `sparrowdb could not be loaded: ${message}` };
    warnOnce(cached.reason);
    return cached;
  }
}

function warnOnce(reason: string): void {
  if (warned) return;
  warned = true;
  log.warn(
    { reason },
    'Graph memory tier is inert — sparrowdb is unavailable. Zora continues without relational recall.',
  );
}
