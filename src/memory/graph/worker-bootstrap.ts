/**
 * TypeScript worker bootstrap (MEM-30) — development and test only.
 *
 * In a built install the graph worker entry is `graph-memory-worker.js` and
 * `new Worker(entryPath)` is all that is needed. But Zora also runs straight
 * from TypeScript under `tsx` (`npm run dev`) and under vitest, and a bare
 * `Worker` cannot load a `.ts` file.
 *
 * The obvious fix — `execArgv: ['--import', 'tsx']` — starts the worker and
 * loads the `.ts` entry, but then fails on the entry's own imports:
 *
 *     Cannot find module '…/graph-store.js' imported from '…/graph-memory-worker.ts'
 *
 * tsx's `.js` → `.ts` specifier remapping (required by `module: node16`, which
 * makes TypeScript emit `.js` extensions in source) does not take effect inside
 * a worker thread; verified with `--import tsx`, `--import tsx/esm` and
 * `tsx/esm/api.register()` on tsx 4.21 / Node 22. `register()` inside a worker
 * additionally fails with a `require(esm) in a cycle` error.
 *
 * What does work — and is what this module builds — is an eval'd ESM bootstrap
 * that registers a minimal resolve hook to do the `.js` → `.ts` remap itself,
 * then hands the entry to tsx's `tsImport()` for the actual transform.
 *
 * This whole path is inert in production: `buildTypeScriptBootstrap()` is only
 * called when the module URL ends in `.ts`.
 */

/**
 * A resolve hook that rewrites a relative `./x.js` specifier to `./x.ts` when
 * the TypeScript file exists on disk and the importer is itself TypeScript.
 *
 * Serialized into a data: URL, so it must be self-contained JavaScript.
 */
const RESOLVE_HOOK_SOURCE = `
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL;
  const relative = specifier.startsWith('./') || specifier.startsWith('../');
  if (relative && specifier.endsWith('.js') && parent && parent.endsWith('.ts')) {
    const candidate = new URL(specifier.slice(0, -3) + '.ts', parent);
    if (existsSync(fileURLToPath(candidate))) {
      return nextResolve(specifier.slice(0, -3) + '.ts', context);
    }
  }
  return nextResolve(specifier, context);
}
`;

/**
 * The bootstrap module body, evaluated as the worker's entry.
 *
 * Order matters: the resolve hook must be registered *before* `tsImport()` so
 * that the entry's transitive `.js` specifiers are remapped as they are
 * encountered. Registering tsx globally instead of via `tsImport()` triggers a
 * `require(esm) in a cycle` failure.
 */
const BOOTSTRAP_SOURCE = `
import { register } from 'node:module';
import { workerData } from 'node:worker_threads';
register(workerData.__resolveHook);
const tsx = await import('tsx/esm/api');
await tsx.tsImport(workerData.__entry, import.meta.url);
`;

export interface TypeScriptBootstrap {
  /** ESM source to pass to `new Worker(source, { eval: true })`. */
  source: string;
  /** Extra `workerData` fields the bootstrap needs. */
  workerData: { __entry: string; __resolveHook: string };
}

/**
 * Build the eval bootstrap for a TypeScript worker entry.
 *
 * @param entryUrl `file://` URL of the `.ts` worker entry.
 */
export function buildTypeScriptBootstrap(entryUrl: string): TypeScriptBootstrap {
  return {
    source: BOOTSTRAP_SOURCE,
    workerData: {
      __entry: entryUrl,
      __resolveHook: `data:text/javascript,${encodeURIComponent(RESOLVE_HOOK_SOURCE)}`,
    },
  };
}
