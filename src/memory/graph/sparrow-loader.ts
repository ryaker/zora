/**
 * Lazy, failure-tolerant loader for the optional `sparrowdb` native module (MEM-30).
 *
 * `sparrowdb` is an optionalDependency with N-API bindings. It can be absent or
 * unloadable for several ordinary reasons:
 *   - `npm install --no-optional`, or an install where the optional dep failed;
 *   - an unsupported platform (the package ships prebuilt binaries for
 *     linux-x64-gnu and darwin-arm64 only — no Windows, no linux-arm64);
 *   - a published platform sub-package that does not resolve, in which case
 *     `require('sparrowdb')` throws at module-load time.
 *
 * None of those may take Zora down. This module converts every failure mode
 * into `{ available: false, reason }` and logs exactly one warning per process.
 */

import { createLogger } from '../../utils/logger.js';

const log = createLogger('graph-memory');

/** The subset of the `sparrowdb` surface the graph tier uses. */
export interface SparrowDatabase {
  execute(cypher: string): { columns: string[]; rows: Array<Record<string, unknown>> };
  checkpoint(): void;
  optimize(): void;
}

export interface SparrowModule {
  SparrowDB: { open(path: string): SparrowDatabase };
}

export type SparrowLoadResult =
  | { available: true; module: SparrowModule }
  | { available: false; reason: string };

/** Platforms for which `sparrowdb` publishes a prebuilt binary. */
const SUPPORTED_PLATFORMS = new Set(['linux-x64', 'darwin-arm64', 'darwin-x64']);

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
