/**
 * Process-global enforcement singletons reach every entry point — SEC-29.
 *
 * Zora has two entry points that run tasks: `cli/daemon.ts` (long-running) and
 * `cli/index.ts` (one-shot `zora-agent ask`). Both construct an Orchestrator
 * and boot it, so anything wired inside `boot()` is shared. Anything wired in
 * an entry point is not.
 *
 * `initGlobalCooldown` and `initGlobalForecaster` were called only from the
 * daemon. On the ask path `getGlobalForecaster()` therefore returned null —
 * and `IrreversibilityScorerHook` guards its entire session-risk block on
 * `if (forecaster && ctx.jobId)`, so `shouldAutoDeny()` never ran there. A run
 * the daemon would have stopped for a critical risk pattern went ahead under
 * `ask`. Same hook, same registration, weaker enforcement, nothing looking.
 *
 * That is the SEC-23 shape again — the heartbeat loop with the weakest tool
 * gate — in a different subsystem. The recurring mechanism is not a missing
 * check but a *shared* mechanism that each caller configures for itself, which
 * means some caller eventually doesn't.
 *
 * `initLogger` had it right all along: it is called in `Orchestrator.boot()`,
 * so every entry point gets it. That is the rule this file enforces.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Orchestrator } from '../../src/orchestrator/orchestrator.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { MockProvider } from '../fixtures/mock-provider.js';
import { getGlobalCooldown } from '../../src/core/agent-cooldown.js';
import { getGlobalForecaster } from '../../src/core/memory-risk-forecaster.js';
import type { ZoraPolicy } from '../../src/types.js';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/** Entry points that run tasks. Anything wired only here is not shared. */
const ENTRY_POINTS = ['cli/daemon.ts', 'cli/index.ts'];

/** The shared path both entry points go through. */
const SHARED_BOOT = 'orchestrator/orchestrator.ts';

/**
 * Singletons deliberately not initialized on the shared boot path.
 *
 * Empty. An entry here is a claim that one entry point should enforce less
 * than another, which needs to be written down and argued.
 */
const ENTRY_POINT_ONLY: { fn: string; rationale: string }[] = [];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'frontend') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Every `export function initGlobalX(...)` / `initX(...)` in `src/`. */
function globalInitialisers(): { fn: string; file: string }[] {
  const found: { fn: string; file: string }[] = [];
  for (const file of walk(SRC_ROOT)) {
    for (const m of fs.readFileSync(file, 'utf-8').matchAll(/^export function (init[A-Z][A-Za-z0-9_]*)\s*\(/gm)) {
      found.push({ fn: m[1], file: path.relative(SRC_ROOT, file).split(path.sep).join('/') });
    }
  }
  return found.sort((a, b) => a.fn.localeCompare(b.fn));
}

function callsIn(relPath: string, fn: string): boolean {
  const full = path.join(SRC_ROOT, relPath);
  if (!fs.existsSync(full)) return false;
  return new RegExp(String.raw`(?<![.\w])${fn}\s*\(`).test(stripComments(fs.readFileSync(full, 'utf-8')));
}

describe('SEC-29 — every global initialiser is on the shared boot path', () => {
  it('finds the initialisers at all — the scan must not go silent', () => {
    // A rename would otherwise make every check below vacuously pass.
    expect(globalInitialisers().length).toBeGreaterThanOrEqual(3);
  });

  it('initialises every process-global on the path both entry points share', () => {
    const exempt = new Set(ENTRY_POINT_ONLY.map(e => e.fn));
    const offenders = globalInitialisers()
      .filter(i => !exempt.has(i.fn))
      .filter(i => !callsIn(SHARED_BOOT, i.fn))
      .map(i => ({ ...i, entryPoints: ENTRY_POINTS.filter(e => callsIn(e, i.fn)) }))
      // Called nowhere at all is a different defect (dead code), not this one.
      .filter(i => i.entryPoints.length > 0);

    expect(
      offenders.map(o => `${o.fn} (only in ${o.entryPoints.join(', ')})`),
      offenders.length === 0
        ? ''
        : `SEC-29: these process-global singletons are initialised in an entry point ` +
          `but not in ${SHARED_BOOT}:\n` +
          offenders.map(o => `  ${o.fn} — src/${o.file}, initialised only by ${o.entryPoints.join(', ')}`).join('\n') +
          `\n\nAn entry point that misses one runs with that enforcement silently absent. ` +
          `That is how 'zora-agent ask' ended up with no session-risk forecaster while the ` +
          `daemon had one, so IrreversibilityScorerHook's shouldAutoDeny never fired there. ` +
          `Initialise it in Orchestrator.boot() — the way initLogger does — or add it to ` +
          `ENTRY_POINT_ONLY with a rationale for why one entry point should enforce less.`,
    ).toEqual([]);
  });

  it('gives every ENTRY_POINT_ONLY exemption a rationale', () => {
    for (const entry of ENTRY_POINT_ONLY) {
      expect(entry.rationale.length, `${entry.fn} is exempt with no rationale`).toBeGreaterThan(40);
    }
  });
});

// ─── Behavioural: what a booted process actually holds ───────────────

const testPolicy: ZoraPolicy = {
  filesystem: { allowed_paths: ['/tmp'], denied_paths: [], resolve_symlinks: false, follow_symlinks: false },
  shell: { mode: 'allowlist', allowed_commands: ['echo'], denied_commands: [], split_chained_commands: true, max_execution_time: '30s' },
  actions: { reversible: [], irreversible: [], always_flag: [] },
  network: { allowed_domains: [], denied_domains: [], max_request_size: '10MB' },
};

describe('SEC-29 — a booted Orchestrator holds both enforcement singletons', () => {
  let baseDir: string | null = null;
  let orchestrator: Orchestrator | null = null;

  afterEach(async () => {
    await orchestrator?.shutdown().catch(() => { /* teardown is not under test */ });
    if (baseDir) await fsp.rm(baseDir, { recursive: true, force: true }).catch(() => { /* temp dir */ });
    orchestrator = null;
    baseDir = null;
  });

  it('leaves neither singleton null after boot, on any entry point', async () => {
    // Both `cli/daemon.ts` and `cli/index.ts` do exactly this — construct and
    // boot — so asserting on boot covers both without shelling out to the CLI.
    baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zora-singleton-parity-'));
    const config = structuredClone(DEFAULT_CONFIG);
    config.agent.log_level = 'error';
    config.agent.workspace = path.join(baseDir, 'workspace');

    orchestrator = new Orchestrator({
      config,
      policy: testPolicy,
      providers: [new MockProvider({ name: 'primary', rank: 1 })],
      baseDir,
      skipChannels: true,
    });
    await orchestrator.boot();

    expect(
      getGlobalForecaster(),
      'no forecaster after boot — IrreversibilityScorerHook will skip its entire ' +
        'session-risk block, so shouldAutoDeny() can never fire',
    ).not.toBeNull();
    expect(
      getGlobalCooldown(),
      'no cooldown after boot — subagent-tool falls back to no cooldown at all',
    ).not.toBeNull();
  }, 40_000);
});
