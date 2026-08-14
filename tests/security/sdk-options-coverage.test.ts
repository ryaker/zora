/**
 * SDK option coverage — SEC-23.
 *
 * `tool-enforcement.test.ts` proves that the paths we know about are gated.
 * This file exists for the paths we *don't* know about yet.
 *
 * The root cause of SEC-23 was never a missing check. It was that Zora had four
 * separate places that hand-assemble the Claude Agent SDK's option object, each
 * deciding independently which defenses to pass, and no force keeping them
 * aligned. Wave 1 fixed the main task path. The three `ExecutionLoop` paths kept
 * the old, weaker shape — and nothing failed, because nothing was looking. The
 * heartbeat loop ran unattended scheduled routines for a release with the
 * weakest tool gate in the system.
 *
 * So the deliverable is not "gate the fourth path", it is "make a fifth path
 * impossible to add quietly". These tests are the thing that notices:
 *
 *   1. A **registry check**. Every construction site in `src/` — every
 *      `new ExecutionLoop(...)` and every direct `query({...})` / `queryFn({...})`
 *      into the SDK — must be listed below with a rationale. A new file that
 *      constructs one fails immediately with a message pointing at
 *      `buildEnforcedSdkOptions()`. This is the test that breaks on drift:
 *      the failure is triggered by the *existence* of an unregistered site, so
 *      it cannot be satisfied by the new path being carefully written.
 *
 *   2. A **spread check**. Every registered `new ExecutionLoop({...})` literal
 *      must actually spread `buildEnforcedSdkOptions(...)` (or be registered as
 *      a deliberate no-tool-surface site). Registering a path is not enough;
 *      it has to route through the shared builder.
 *
 *   3. **Behavioural checks**. What the SDK is really handed, on each path,
 *      carries every key in `ENFORCEMENT_OPTION_KEYS`.
 *
 * Do not "fix" a failure here by adding the new file to the registry without
 * routing it through `buildEnforcedSdkOptions()`. The registry is a list of
 * paths that have been *reasoned about*, not a mute button.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENFORCEMENT_OPTION_KEYS,
  buildEnforcedSdkOptions,
} from '../../src/security/enforced-sdk-options.js';
import type { ZoraPolicy } from '../../src/types.js';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

// ─── The registry ────────────────────────────────────────────────────

type SurfaceKind =
  /** Builds SDK options for a path the model can call tools on. Must spread the builder. */
  | 'enforced'
  /** Deliberately has no tool surface at all; the empty allowlist is the enforcement. */
  | 'no-tool-surface';

interface RegisteredSite {
  /** Path relative to `src/`. */
  file: string;
  kind: SurfaceKind;
  /** Why this site exists and how it is gated. Written for whoever reads a failure. */
  rationale: string;
}

/**
 * Every place in `src/` that hands options to the Claude Agent SDK.
 *
 * Adding an entry here is a deliberate act: it means someone decided how the
 * new path is gated and wrote it down.
 */
const REGISTERED_SITES: RegisteredSite[] = [
  {
    file: 'orchestrator/orchestrator.ts',
    kind: 'enforced',
    rationale:
      'Three ExecutionLoop sites: the heartbeat loop (full chain — this is the ' +
      'least-supervised path in the system) and the extraction/compression loops ' +
      "(maxTurns:1 text calls, toolSurface 'none'). All three spread " +
      'buildEnforcedSdkOptions().',
  },
  {
    file: 'orchestrator/execution-loop.ts',
    kind: 'enforced',
    rationale:
      'The ExecutionLoop itself — the query() call. It forwards permissionMode, ' +
      'canUseTool, hooks, allowedTools and disallowedTools from the options its ' +
      'caller built via buildEnforcedSdkOptions().',
  },
  {
    file: 'providers/claude-provider.ts',
    kind: 'enforced',
    rationale:
      'The main task path. Builds its enforcement half via buildEnforcedSdkOptions() ' +
      'from the per-task canUseTool + sdkHooks and the policy handed in by the CLI ' +
      'factories.',
  },
  {
    file: 'channels/quarantine-processor.ts',
    kind: 'no-tool-surface',
    rationale:
      'INVARIANT-4: the CaMeL-style quarantine LLM reads untrusted channel message ' +
      'content and must never hold a tool. It passes allowedTools: [] directly — an ' +
      'empty tool surface is a stronger statement than any gate over a non-empty one, ' +
      'so it does not need the chain.',
  },
];

// ─── Source scanning ─────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // The dashboard's React frontend is a browser bundle, not an agent path.
      if (entry.name === 'node_modules' || entry.name === 'frontend') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Text that looks like a construction of an SDK execution.
 *
 * `query({` / `queryFn({` catches a direct SDK entry; `new ExecutionLoop(`
 * catches Zora's wrapper. Deliberately textual: the point is to notice a *new
 * file* doing this, and a type-level or runtime registry would only see paths
 * that already imported the right thing.
 */
const CONSTRUCTION_PATTERNS: RegExp[] = [
  /\bnew\s+ExecutionLoop\s*\(/,
  /(?<![.\w])query\s*\(\s*\{/,
  /\bqueryFn\s*\(\s*\{/,
];

function findConstructionSites(): string[] {
  const hits: string[] = [];
  for (const file of walk(SRC_ROOT)) {
    const source = fs.readFileSync(file, 'utf-8');
    // Strip block comments so a doc-comment mentioning `query({ prompt, options })`
    // is not mistaken for a call site.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '');
    if (CONSTRUCTION_PATTERNS.some(p => p.test(code))) {
      hits.push(path.relative(SRC_ROOT, file).split(path.sep).join('/'));
    }
  }
  return hits.sort();
}

/** Extract the `{ ... }` object literal that follows each `new ExecutionLoop(`. */
function executionLoopLiterals(source: string): string[] {
  const literals: string[] = [];
  const re = /\bnew\s+ExecutionLoop\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const open = source.indexOf('{', match.index);
    if (open === -1) continue;
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i++) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end !== -1) literals.push(source.slice(open, end + 1));
  }
  return literals;
}

// ─── 1. Registry: a new path cannot appear unnoticed ─────────────────

describe('SEC-23 — every SDK construction site is registered', () => {
  it('finds no construction site outside the registry', () => {
    const found = findConstructionSites();
    const registered = new Set(REGISTERED_SITES.map(s => s.file));
    const unregistered = found.filter(f => !registered.has(f));

    expect(
      unregistered,
      unregistered.length === 0
        ? ''
        : `SEC-23: these files build Claude Agent SDK options but are not in ` +
          `REGISTERED_SITES in tests/security/sdk-options-coverage.test.ts:\n` +
          unregistered.map(f => `  src/${f}`).join('\n') +
          `\n\nA new execution path must get the same gate as the others. Route its ` +
          `options through buildEnforcedSdkOptions() in src/security/enforced-sdk-options.ts ` +
          `— that is what supplies permissionMode, canUseTool, hooks, allowedTools and ` +
          `disallowedTools — then add it here with a rationale. Do not add it here alone: ` +
          `the last time these drifted, the heartbeat loop shipped with no hook chain.`,
    ).toEqual([]);
  });

  it('has no stale registry entry — a removed path should be de-registered', () => {
    const found = new Set(findConstructionSites());
    const stale = REGISTERED_SITES.filter(s => !found.has(s.file)).map(s => s.file);
    expect(stale, `registered but no longer constructing SDK options: ${stale.join(', ')}`).toEqual([]);
  });

  it('gives every registered site a rationale someone can act on', () => {
    for (const site of REGISTERED_SITES) {
      expect(site.rationale.length, `${site.file} has no rationale`).toBeGreaterThan(40);
    }
  });
});

// ─── 2. Spread check: registration alone is not enough ───────────────

describe('SEC-23 — every ExecutionLoop literal routes through the shared builder', () => {
  it('spreads buildEnforcedSdkOptions() at every construction site', () => {
    const offenders: string[] = [];

    for (const site of REGISTERED_SITES) {
      const full = path.join(SRC_ROOT, site.file);
      if (!fs.existsSync(full)) continue;
      const source = fs.readFileSync(full, 'utf-8');
      executionLoopLiterals(source).forEach((literal, i) => {
        if (!literal.includes('...buildEnforcedSdkOptions(')) {
          offenders.push(`src/${site.file} — ExecutionLoop literal #${i + 1}`);
        }
      });
    }

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `SEC-23: these ExecutionLoop constructions do not spread ` +
          `buildEnforcedSdkOptions(), so they are choosing their own defenses:\n` +
          offenders.map(o => `  ${o}`).join('\n') +
          `\n\nHand-picking which of permissionMode / canUseTool / hooks / allowedTools / ` +
          `disallowedTools to pass is exactly how the heartbeat path ended up with only ` +
          `canUseTool. Spread the builder instead.`,
    ).toEqual([]);
  });

  it('finds the three orchestrator loops it expects — the count is itself a tripwire', () => {
    const source = fs.readFileSync(path.join(SRC_ROOT, 'orchestrator', 'orchestrator.ts'), 'utf-8');
    // heartbeat, extraction, compression. A fourth appearing without a matching
    // update here means someone added an execution path in passing.
    expect(executionLoopLiterals(source)).toHaveLength(3);
  });

  it('keeps the two single-shot memory loops on an empty tool surface', () => {
    const source = fs.readFileSync(path.join(SRC_ROOT, 'orchestrator', 'orchestrator.ts'), 'utf-8');
    const singleShot = executionLoopLiterals(source).filter(l => l.includes('maxTurns: 1'));
    expect(singleShot).toHaveLength(2);
    for (const literal of singleShot) {
      expect(literal).toContain("toolSurface: 'none'");
    }
  });

  it('keeps the no-tool-surface sites at an empty allowlist', () => {
    for (const site of REGISTERED_SITES.filter(s => s.kind === 'no-tool-surface')) {
      const source = fs.readFileSync(path.join(SRC_ROOT, site.file), 'utf-8');
      expect(source, `${site.file} is registered as no-tool-surface but sets no empty allowlist`)
        .toMatch(/allowedTools:\s*\[\]/);
    }
  });

  it('never reintroduces a permission mode that skips canUseTool', () => {
    // The CLAUDE.md invariant, asserted rather than documented.
    for (const file of walk(SRC_ROOT)) {
      const source = fs.readFileSync(file, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(source, `${file} mentions bypassPermissions`).not.toMatch(/bypassPermissions/);
    }
  });
});

// ─── 3. Behavioural: what the SDK is actually handed ─────────────────

const testPolicy: ZoraPolicy = {
  filesystem: { allowed_paths: ['/tmp'], denied_paths: [], resolve_symlinks: false, follow_symlinks: false },
  shell: { mode: 'deny_all', allowed_commands: [], denied_commands: ['*'], split_chained_commands: true, max_execution_time: '0s' },
  actions: { reversible: [], irreversible: [], always_flag: [] },
  network: { allowed_domains: [], denied_domains: [], max_request_size: '1mb' },
};

describe('SEC-23 — the options reaching the SDK carry the full enforcement set', () => {
  let capturedOptions: Record<string, unknown> | undefined;

  beforeEach(() => {
    capturedOptions = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('ExecutionLoop forwards every enforcement key into query()', async () => {
    vi.resetModules();
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: (params: { prompt: string; options: Record<string, unknown> }) => {
        capturedOptions = params.options;
        return (async function* () { /* no messages */ })();
      },
      createSdkMcpServer: () => ({ type: 'sdk', name: 'zora-tools', instance: {} }),
      tool: (name: string) => ({ name }),
    }));

    const { ExecutionLoop } = await import('../../src/orchestrator/execution-loop.js');
    const loop = new ExecutionLoop({
      ...buildEnforcedSdkOptions({
        policy: testPolicy,
        canUseTool: async () => ({ behavior: 'allow' as const, updatedInput: {} }),
        hooks: { PreToolUse: [{ hooks: [async () => ({})] }] },
      }),
      systemPrompt: 'test',
    });
    await loop.run('hello');

    expect(capturedOptions, 'ExecutionLoop never called query()').toBeDefined();
    for (const key of ENFORCEMENT_OPTION_KEYS) {
      expect(capturedOptions!, `ExecutionLoop dropped '${key}' before query()`).toHaveProperty(key);
    }
    expect(capturedOptions!['permissionMode']).toBe('default');
    // deny_all shell policy → the shell tools are gone from the model's context.
    expect(capturedOptions!['disallowedTools']).toContain('Bash');
  });

  it('ClaudeProvider forwards every enforcement key into query()', async () => {
    const { ClaudeProvider } = await import('../../src/providers/claude-provider.js');
    let captured: Record<string, unknown> | undefined;

    const provider = new ClaudeProvider({
      config: {
        name: 'claude-test', type: 'claude-sdk', rank: 1,
        capabilities: ['reasoning'], cost_tier: 'metered', enabled: true,
      },
      permissionMode: 'default',
      policy: testPolicy,
      queryFn: (params) => {
        captured = params.options;
        return (async function* () { /* no messages */ })() as never;
      },
    });

    const events = provider.execute({
      jobId: 'coverage-1',
      task: 'x',
      requiredCapabilities: [],
      complexity: 'simple',
      resourceType: 'general',
      systemPrompt: 's',
      memoryContext: [],
      history: [],
      canUseTool: async () => ({ behavior: 'allow' as const }),
      sdkHooks: { PreToolUse: [{ hooks: [async () => ({})] }] },
    });
    for await (const _ of events) { /* drain */ }

    expect(captured, 'ClaudeProvider never called the SDK').toBeDefined();
    for (const key of ENFORCEMENT_OPTION_KEYS) {
      // `allowedTools` is legitimately absent when there is no allowlist — an
      // allowlist is a filter, not a registry — so it is the one key checked by
      // meaning rather than presence.
      if (key === 'allowedTools') continue;
      expect(captured!, `ClaudeProvider dropped '${key}' before query()`).toHaveProperty(key);
    }
    expect(captured!['permissionMode']).toBe('default');
    expect(captured!['disallowedTools']).toContain('Bash');
    expect(captured!['canUseTool']).toBeTypeOf('function');
    expect(captured!['hooks']).toBeDefined();
  });

  it('both CLI factories hand the policy to the provider', () => {
    // Without a policy the provider still runs, but with no static bans — a
    // quiet weakening that only shows up as a missing argument.
    for (const file of ['cli/index.ts', 'cli/daemon.ts']) {
      const source = fs.readFileSync(path.join(SRC_ROOT, file), 'utf-8');
      const construction = source.match(/new ClaudeProvider\(\{[^}]*\}\)/);
      expect(construction, `${file} does not construct a ClaudeProvider`).toBeTruthy();
      expect(construction![0], `${file} constructs ClaudeProvider without a policy`).toContain('policy');
      expect(construction![0], `${file} does not pin permissionMode`).toContain("permissionMode: 'default'");
    }
  });
});
