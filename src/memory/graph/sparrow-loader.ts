/**
 * Lazy, failure-tolerant loader for the optional `sparrowdb` native module (MEM-30).
 *
 * `sparrowdb` is an optionalDependency with N-API bindings. It can be absent or
 * unloadable for several ordinary reasons:
 *   - `npm install --no-optional`, or an install where the optional dep failed;
 *   - an unsupported platform (0.1.26 bundles prebuilt binaries for
 *     `linux-x64-gnu` and `darwin-arm64` only — no Windows, no linux-arm64, no
 *     Intel macOS, no musl/Alpine);
 *   - a binary present under the expected name that still fails to `dlopen`,
 *     in which case `require('sparrowdb')` throws at module-load time.
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
 * is an error — on 0.1.26 it surfaces indirectly, as
 * `parameter $name was referenced in the query but not supplied`, because the
 * binder simply never matches it — so the mistake is loud rather than silent,
 * but it is still a mistake.
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
 * Platforms for which `sparrowdb` ships a prebuilt binary.
 *
 * Must mirror `PLATFORM_BINARIES` in the package's own `index.js`. Up to 0.1.24
 * the package declared `optionalDependencies` on `@sparrowdb/darwin-x64`,
 * `@sparrowdb/linux-arm64-gnu` and `@sparrowdb/win32-x64-msvc`, none of which
 * were ever published; 0.1.26 dropped those declarations and bundles the two
 * binaries that do exist directly in the tarball. `darwin-x64` was in this set
 * on the strength of a sub-package that never shipped, so an Intel Mac got past
 * this gate only to fail at `require`. Two entries is the honest list.
 */
const SUPPORTED_PLATFORMS = new Set(['linux-x64', 'darwin-arm64']);

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

    // Both the namespaced and the default-only shape must be accepted.
    //
    // `sparrowdb` is CJS and assigns `module.exports` from a function call,
    // which Node's cjs-module-lexer cannot see through — so up to 0.1.24 the
    // ESM namespace had exactly one key, `default`, and
    // `import { SparrowDB } from 'sparrowdb'` threw "Named export 'SparrowDB'
    // not found". 0.1.26 fixed that (upstream #449) by re-assigning the names
    // statically after the dynamic export, and the namespace now carries
    // `SparrowDB`, `ReadTx` and `WriteTx` under real Node ESM. Vite/vitest
    // interops the old shape into named exports anyway. Reading `mod.SparrowDB`
    // first and falling back to `mod.default` covers all three cases without
    // pinning the loader to a version.
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
