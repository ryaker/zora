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
import { getGlobalCooldown, cooldownConfigFrom, DEFAULT_COOLDOWN_CONFIG } from '../../src/core/agent-cooldown.js';
import { getGlobalForecaster, forecasterConfigFrom, DEFAULT_FORECASTER_CONFIG } from '../../src/core/memory-risk-forecaster.js';
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

/**
 * Every `export function initX(...)` / `export const initX = (...)` in `src/`.
 *
 * The arrow forms match nothing today. They are here because a guard that only
 * recognises one declaration syntax stops guarding the moment someone writes
 * the other, and nothing would say so.
 */
function globalInitialisers(): { fn: string; file: string }[] {
  const found: { fn: string; file: string }[] = [];
  const patterns = [
    /^export function (init[A-Z][A-Za-z0-9_]*)\s*\(/gm,
    /^export (?:const|let) (init[A-Z][A-Za-z0-9_]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(|function\b)/gm,
  ];
  for (const file of walk(SRC_ROOT)) {
    const source = fs.readFileSync(file, 'utf-8');
    const relative = path.relative(SRC_ROOT, file).split(path.sep).join('/');
    for (const pattern of patterns) {
      for (const m of source.matchAll(pattern)) found.push({ fn: m[1], file: relative });
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

    // Both singletons are process-global and vitest shares a worker process
    // across test files. If some other suite initialises them first, the
    // post-boot assertions below would pass without boot() having done
    // anything — this file would keep reporting green while guarding nothing,
    // which is the failure mode it exists to prevent, one level up. Verified
    // today by removing the boot-path wiring and running the *whole* suite:
    // the assertions below still fail. This pins that property instead of
    // relying on it.
    expect(
      getGlobalForecaster(),
      'a forecaster already exists before boot() — another suite initialised it, so this ' +
        'test can no longer prove boot() is what wires it. Isolate this file or reset the global.',
    ).toBeNull();
    expect(
      getGlobalCooldown(),
      'a cooldown already exists before boot() — see above',
    ).toBeNull();

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

// ─── Config parsing: a malformed table must not change enforcement ───

/**
 * These parsers decide how hard the agent brakes. They read a user-editable
 * TOML table, so "what does a wrong value do" is part of the enforcement
 * surface, not a tidiness question.
 *
 * All three of these were live in the daemon's copy before it moved here; the
 * move is what made them one function worth testing instead of two blocks of
 * inline literals.
 */
describe('SEC-29 — malformed config falls back instead of weakening enforcement', () => {
  it('rejects a maxEvents that would make the rolling window unbounded', () => {
    // `record()` trims with `events.slice(-maxEvents)` behind
    // `events.length > maxEvents`. At 0 that is `slice(-0)` — the whole array —
    // so the guard is always true, nothing is ever dropped, and session history
    // grows for the life of the process.
    expect(forecasterConfigFrom({ max_events: 0 }).maxEvents).toBe(DEFAULT_FORECASTER_CONFIG.maxEvents);
    expect(forecasterConfigFrom({ max_events: -5 }).maxEvents).toBe(DEFAULT_FORECASTER_CONFIG.maxEvents);
    expect(forecasterConfigFrom({ max_events: 2.5 }).maxEvents).toBe(DEFAULT_FORECASTER_CONFIG.maxEvents);
    expect(forecasterConfigFrom({ max_events: 10 }).maxEvents).toBe(10);
  });

  it('refuses an auto-deny threshold below the intercept threshold', () => {
    // Inverted thresholds do not disable escalation — they auto-deny every
    // score in the gap that should merely have been intercepted, so the agent
    // silently refuses more than intended while looking like a tuning change.
    const inverted = forecasterConfigFrom({ intercept_threshold: 88, auto_deny_threshold: 72 });
    expect(inverted.autoDenyThreshold).toBeGreaterThanOrEqual(inverted.interceptThreshold);
    // A correctly ordered pair is left alone.
    const ordered = forecasterConfigFrom({ intercept_threshold: 60, auto_deny_threshold: 80 });
    expect(ordered.interceptThreshold).toBe(60);
    expect(ordered.autoDenyThreshold).toBe(80);
  });

  it('does not let a non-boolean `enabled` switch enforcement on', () => {
    // `enabled` was cast, not checked. TOML `enabled = "false"` is a *string*,
    // and every non-empty string is truthy — so the one spelling a user is most
    // likely to reach for while trying to turn something OFF turned it ON.
    expect(forecasterConfigFrom({ enabled: 'false' }).enabled).toBe(false);
    expect(cooldownConfigFrom({ enabled: 'no' }).enabled).toBe(false);
    expect(forecasterConfigFrom({ enabled: true }).enabled).toBe(true);
    expect(cooldownConfigFrom({ enabled: true }).enabled).toBe(true);
  });

  it('rejects non-positive cooldown thresholds', () => {
    expect(cooldownConfigFrom({ level1_threshold: -1 }).level1Threshold)
      .toBe(DEFAULT_COOLDOWN_CONFIG.level1Threshold);
    expect(cooldownConfigFrom({ shutdown_threshold: 0 }).shutdownThreshold)
      .toBe(DEFAULT_COOLDOWN_CONFIG.shutdownThreshold);
    expect(cooldownConfigFrom({ level1_threshold: 5 }).level1Threshold).toBe(5);
  });

  it('takes its fallbacks from the DEFAULT_* constants, not from copies', () => {
    // Repeating the defaults as literals gave every setting two sources of
    // truth: changing a DEFAULT_* applied only to installs with no table at
    // all, and silently not to anyone who had configured the section.
    const fromEmptyTable = forecasterConfigFrom({});
    expect(fromEmptyTable.interceptThreshold).toBe(DEFAULT_FORECASTER_CONFIG.interceptThreshold);
    expect(fromEmptyTable.autoDenyThreshold).toBe(DEFAULT_FORECASTER_CONFIG.autoDenyThreshold);
    expect(fromEmptyTable.maxEvents).toBe(DEFAULT_FORECASTER_CONFIG.maxEvents);
    expect(cooldownConfigFrom({}).shutdownThreshold).toBe(DEFAULT_COOLDOWN_CONFIG.shutdownThreshold);
  });
});
