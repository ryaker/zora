/**
 * Tool registration coverage — MEM-34.
 *
 * `tests/security/sdk-options-coverage.test.ts` checks that every path handing
 * options to the SDK routes through the shared builder. It has nothing to say
 * about whether a *tool* the model is supposed to have ever reaches the model,
 * and that gap shipped: `createGraphTools` was written, unit-tested,
 * benchmarked, and documented in CHANGELOG.md as "exposed to the model as a
 * `graph_recall` tool" — while being called from nowhere in `src/`. The graph
 * memory tier was reachable only from its own test suite. The agent could not
 * call it.
 *
 * Nothing failed, because a tool that is never registered is indistinguishable
 * from a tool that is never chosen. The tests passed, the docs described a
 * capability, and the model was never offered it.
 *
 * So: every tool factory must be invoked in `_buildCustomTools()`, and the
 * value it produces must actually reach the returned array. Calling a factory
 * and dropping its result on the floor is the same defect one step later.
 *
 * The checks come in two layers, deliberately. The structural ones read source
 * text: the failure mode is a *missing reference*, and that is what source
 * structure shows — cheaply, and with a message naming the file to fix. The
 * behavioural ones at the bottom boot a real Orchestrator and read back the
 * tool list it hands to tasks, because a structural check is still a claim
 * about spelling, and a structural check is what was missing when this bug
 * shipped. The boot is cheap (MockProvider, `skipChannels`, a temp dir) and it
 * is the only layer that would survive a rewrite of `_buildCustomTools`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Orchestrator } from '../../../src/orchestrator/orchestrator.js';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';
import { MockProvider } from '../../fixtures/mock-provider.js';
import type { ZoraPolicy } from '../../../src/types.js';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src');

/** Directories whose exported `create*Tool(s)` functions build model-callable tools. */
const TOOL_DIRS = ['tools', path.join('orchestrator', 'tools')];

/**
 * Factories that deliberately do not appear in `_buildCustomTools()`.
 *
 * Empty, and that is the point — an entry here is a claim that a tool exists
 * but the agent should not be offered it, which needs a reason next to it.
 */
const NOT_REGISTERED: { fn: string; rationale: string }[] = [];

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Every exported `create…Tool` / `create…Tools` factory, with its file. */
function toolFactories(): { fn: string; file: string }[] {
  const found: { fn: string; file: string }[] = [];
  for (const dir of TOOL_DIRS) {
    for (const file of walk(path.join(SRC_ROOT, dir))) {
      const source = fs.readFileSync(file, 'utf-8');
      for (const m of source.matchAll(/^export function (create[A-Za-z0-9_]*Tools?)\s*\(/gm)) {
        found.push({ fn: m[1], file: path.relative(SRC_ROOT, file).split(path.sep).join('/') });
      }
    }
  }
  return found.sort((a, b) => a.fn.localeCompare(b.fn));
}

/** The source text of `Orchestrator._buildCustomTools()`, braces balanced. */
function buildCustomToolsBody(): string {
  const source = fs.readFileSync(path.join(SRC_ROOT, 'orchestrator', 'orchestrator.ts'), 'utf-8');
  const start = source.search(/private\s+_buildCustomTools\s*\(/);
  expect(start, 'Orchestrator._buildCustomTools() not found — was it renamed?').toBeGreaterThan(-1);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error('unbalanced braces in _buildCustomTools()');
}

/** The `return [...]` array literal that ends `_buildCustomTools()`. */
function returnedArray(body: string): string {
  const m = body.match(/return\s*\[([\s\S]*?)\];/);
  expect(m, '_buildCustomTools() does not end in a `return [...]` array').toBeTruthy();
  return m![1];
}

describe('MEM-34 — every defined tool is registered', () => {
  it('finds the tool factories at all — the scan itself must not go silent', () => {
    // A rename or a move that makes `toolFactories()` return nothing would make
    // every check below vacuously pass. Pin the floor.
    expect(toolFactories().length).toBeGreaterThanOrEqual(6);
  });

  it('invokes every tool factory in _buildCustomTools()', () => {
    const body = buildCustomToolsBody();
    const exempt = new Set(NOT_REGISTERED.map(e => e.fn));
    const orphans = toolFactories()
      .filter(f => !exempt.has(f.fn))
      .filter(f => !new RegExp(String.raw`\b${f.fn}\s*\(`).test(body));

    expect(
      orphans.map(o => `${o.fn} (src/${o.file})`),
      orphans.length === 0
        ? ''
        : `MEM-34: these tool factories are defined but never called from ` +
          `Orchestrator._buildCustomTools(), so the model is never offered them:\n` +
          orphans.map(o => `  ${o.fn} — src/${o.file}`).join('\n') +
          `\n\nA tool that is never registered is indistinguishable from a tool that is ` +
          `never chosen: its unit tests pass, the docs describe it, and the agent cannot ` +
          `call it. That is how graph_recall shipped unreachable. Either wire it into ` +
          `_buildCustomTools() or add it to NOT_REGISTERED with a rationale.`,
    ).toEqual([]);
  });

  it('lets every registered factory reach the returned array', () => {
    // Calling a factory and dropping its result is the same defect one step
    // later, and reads as wired at a glance.
    const body = buildCustomToolsBody();
    const returned = returnedArray(body);
    const exempt = new Set(NOT_REGISTERED.map(e => e.fn));
    const dropped: string[] = [];

    for (const { fn } of toolFactories()) {
      if (exempt.has(fn)) continue;
      // `const graphTools = ... createGraphTools(client) ...` — capture the
      // binding the factory's result lands in, then require it in the return.
      const assignment = body.match(new RegExp(String.raw`const\s+([\w$]+)\s*(?::[^=]+)?=\s*[^;]*\b${fn}\s*\(`));
      if (!assignment) continue; // called inline in the return, or not called — covered above.
      if (!new RegExp(String.raw`\b${assignment[1]}\b`).test(returned)) {
        dropped.push(`${fn} → ${assignment[1]}`);
      }
    }

    expect(
      dropped,
      dropped.length === 0
        ? ''
        : `MEM-34: these factories are called but their result never reaches the ` +
          `returned tool array:\n` + dropped.map(d => `  ${d}`).join('\n'),
    ).toEqual([]);
  });

  it('registers graph_recall alongside memory_search', () => {
    // The specific regression. The graph tier answers relational questions BM25
    // provably cannot; shipping it unreachable made the CHANGELOG claim false.
    const body = buildCustomToolsBody();
    expect(body, 'graph tools are not built').toMatch(/createGraphTools\s*\(/);
    expect(returnedArray(body), 'graph tools are built but not returned').toMatch(/graphTools/);
  });

  it('starts the graph client before the tool list is cached', () => {
    // Ordering is load-bearing and invisible: createGraphTools() returns [] for
    // an inert client, and the list is built once per boot. Starting the tier
    // after _buildCustomTools() would register nothing, silently, forever.
    const source = fs.readFileSync(path.join(SRC_ROOT, 'orchestrator', 'orchestrator.ts'), 'utf-8');
    const created = source.indexOf('GraphMemoryClient.create(');
    const cached = source.indexOf('this._customTools = this._buildCustomTools();');
    expect(created, 'the orchestrator never starts a GraphMemoryClient').toBeGreaterThan(-1);
    expect(cached, 'the boot-time tool list build was moved or renamed').toBeGreaterThan(-1);
    expect(created, 'GraphMemoryClient.create() must run before the tool list is built')
      .toBeLessThan(cached);
  });

  it('closes the graph client on shutdown', () => {
    // A worker thread outliving the orchestrator keeps the process alive; the
    // one-shot `ask` path depends on this to exit.
    const source = fs.readFileSync(path.join(SRC_ROOT, 'orchestrator', 'orchestrator.ts'), 'utf-8');
    const shutdown = source.slice(source.indexOf('async shutdown('));
    expect(shutdown, 'shutdown() never closes the graph client').toMatch(/_graphClient\.close\(\)/);
  });

  it('gives every NOT_REGISTERED exemption a rationale', () => {
    for (const entry of NOT_REGISTERED) {
      expect(entry.rationale.length, `${entry.fn} is exempt with no rationale`).toBeGreaterThan(40);
    }
  });
});

// ─── Behavioural: what the model is actually offered after a boot ────

/**
 * The structural checks above would have caught the MEM-34 bug, but they are
 * still assertions about source text. This boots a real Orchestrator and reads
 * back the tool list it hands to tasks, which is the thing that was actually
 * wrong: the list simply did not contain `graph_recall`.
 *
 * It is cheap — MockProvider, `skipChannels`, a temp base dir — and it is the
 * only check here that would survive a wholesale rewrite of `_buildCustomTools`.
 */
const testPolicy: ZoraPolicy = {
  filesystem: { allowed_paths: ['/tmp'], denied_paths: [], resolve_symlinks: false, follow_symlinks: false },
  shell: { mode: 'allowlist', allowed_commands: ['echo'], denied_commands: [], split_chained_commands: true, max_execution_time: '30s' },
  actions: { reversible: [], irreversible: [], always_flag: [] },
  network: { allowed_domains: [], denied_domains: [], max_request_size: '10MB' },
};

/** Boot, read the registered tool names, shut down. */
async function registeredToolNames(): Promise<string[]> {
  const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zora-tool-registration-'));
  const config = structuredClone(DEFAULT_CONFIG);
  config.agent.log_level = 'error';
  config.agent.workspace = path.join(baseDir, 'workspace');

  const orchestrator = new Orchestrator({
    config,
    policy: testPolicy,
    providers: [new MockProvider({ name: 'primary', rank: 1 })],
    baseDir,
    skipChannels: true,
  });

  try {
    await orchestrator.boot();
    const tools = (orchestrator as unknown as { _getCustomTools(): { name: string }[] })._getCustomTools();
    return tools.map(t => t.name);
  } finally {
    await orchestrator.shutdown().catch(() => { /* teardown is not under test */ });
    await fsp.rm(baseDir, { recursive: true, force: true }).catch(() => { /* temp dir */ });
  }
}

describe('MEM-34 — a booted Orchestrator offers the graph tool', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('registers graph_recall when the tier is enabled', async () => {
    vi.stubEnv('ZORA_GRAPH_MEMORY', '1');
    vi.stubEnv('ZORA_GRAPH_MEMORY_PATH', path.join(os.tmpdir(), `zora-graph-reg-${process.pid}.db`));

    const names = await registeredToolNames();
    expect(
      names,
      `graph_recall is not in the booted tool list — the model cannot call it. Got: ${names.join(', ')}`,
    ).toContain('graph_recall');
    // The pairing is the point: relational recall sits next to lexical recall.
    expect(names).toContain('memory_search');
  }, 40_000);

  it('omits graph_recall when the tier is off, rather than offering a dead tool', async () => {
    vi.stubEnv('ZORA_GRAPH_MEMORY', '');

    const names = await registeredToolNames();
    expect(names).not.toContain('graph_recall');
    // …and the rest of the surface is unaffected by the tier being absent.
    expect(names).toContain('memory_search');
  }, 40_000);
});
