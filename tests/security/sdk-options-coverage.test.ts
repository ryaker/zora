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
 *   1. A **registry check**. Every file in `src/` that *acquires* the SDK's
 *      execution entry point — imports `query`, dynamically imports the SDK
 *      module, or constructs an `ExecutionLoop` — must be listed below with a
 *      rationale. A new file that does fails immediately with a message
 *      pointing at `buildEnforcedSdkOptions()`. This is the test that breaks on
 *      drift: the failure is triggered by the *existence* of an unregistered
 *      site, so it cannot be satisfied by the new path being carefully written.
 *      See `SDK_ACQUISITION` below for why this scans acquisition and not call
 *      shape — the first version of this guard scanned call shape and the
 *      property in the previous sentence was not actually true of it.
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

const SDK_MODULE = String.raw`@anthropic-ai/claude-agent-sdk`;

/**
 * How a file can come to hold the SDK's execution entry point.
 *
 * This guard originally matched *call shapes* — `query({`, `queryFn({`,
 * `new ExecutionLoop(`. That was unsound, and the comment above claiming the
 * failure could not be dodged by writing the new path carefully was false of
 * it. All three patterns required an inline object literal at the call site,
 * so hoisting the options to a variable walked straight past them:
 *
 *     const enforced = buildEnforcedSdkOptions({ … });
 *     query(enforced);                    // ← invisible to the old guard
 *
 * That is not an adversarial shape; it is this codebase's own idiom, in
 * `claude-provider.ts`. Aliased imports (`query as sdkQuery`), namespace
 * imports, member calls (`this.sdk.query({`) and dynamic imports evaded it
 * too — and the last of those is how the **main task path** acquires the SDK
 * (`claude-provider.ts` `_resolveQueryFn`). The reference implementation for
 * "how Zora calls the SDK" was matched only incidentally, by an unrelated
 * `queryFn({` elsewhere in the same file. A new provider modeled on it — the
 * natural way to add one — would have been registered nowhere and caught by
 * nothing. That is the SEC-23 shape exactly: not a missing check, but a new
 * path quietly picking its own defenses while nothing is looking.
 *
 * Matching call syntax is unbounded — every pattern added invites the next
 * shape. Acquisition is not. A file cannot call the SDK without first
 * obtaining it, and there are only three ways to obtain it. So the scan gates
 * on the capability, not on how it is spelled at the point of use.
 *
 * The precision matters in the other direction too: 18 files under `src/`
 * mention the SDK or `execution-loop`, and a naive "references the SDK" scan
 * would put 14 type-only importers into the registry and train everyone to
 * rubber-stamp entries — the exact failure the header warns about. So a
 * type-only import is not acquisition, and neither is importing
 * `createSdkMcpServer`/`tool`, which register tools but cannot run a turn.
 * `SDK_ACQUISITION_SHAPES` below pins both halves of that boundary.
 */
const SDK_ACQUISITION: { reason: string; test: (code: string) => boolean }[] = [
  {
    reason: 'imports query from the SDK',
    test: code => {
      // A value import (not `import type`) whose specifiers include `query`,
      // or which takes the whole namespace/default and so includes it.
      const re = new RegExp(String.raw`import\s+(?!type\s)([\s\S]{0,400}?)from\s*['"]${SDK_MODULE}['"]`, 'g');
      for (const match of code.matchAll(re)) {
        const clause = match[1];
        if (/\*\s+as\s+[\w$]+/.test(clause)) return true;   // import * as sdk
        if (/^\s*[\w$]+\s*(,|\s*$)/.test(clause)) return true; // default import
        const named = clause.match(/\{([\s\S]*)\}/)?.[1] ?? '';
        const acquiresQuery = named
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
          // `{ type Options, query }` — inline type specifiers are not values.
          .some(s => !/^type\s/.test(s) && /^query\b/.test(s));
        if (acquiresQuery) return true;
      }
      return false;
    },
  },
  {
    reason: 'dynamically imports the SDK',
    // Hands back the whole namespace, `query` included. This is the main task
    // path, and the shape the old call-site scan could not see.
    test: code => new RegExp(String.raw`import\s*\(\s*['"]${SDK_MODULE}['"]\s*\)`).test(code),
  },
  {
    reason: 'constructs an ExecutionLoop',
    // Zora's own wrapper. Importing the class without constructing one is not
    // acquisition — the construction is what runs a turn, wherever it happens.
    test: code => /\bnew\s+ExecutionLoop\s*\(/.test(code),
  },
];

/** Strip comments so prose about `query({ … })` is not mistaken for code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function acquisitionReasons(code: string): string[] {
  return SDK_ACQUISITION.filter(rule => rule.test(code)).map(rule => rule.reason);
}

/** Every file in `src/` that holds the SDK's execution entry point, and why. */
function findConstructionSites(): { file: string; reasons: string[] }[] {
  const hits: { file: string; reasons: string[] }[] = [];
  for (const file of walk(SRC_ROOT)) {
    const reasons = acquisitionReasons(stripComments(fs.readFileSync(file, 'utf-8')));
    if (reasons.length > 0) {
      hits.push({ file: path.relative(SRC_ROOT, file).split(path.sep).join('/'), reasons });
    }
  }
  return hits.sort((a, b) => a.file.localeCompare(b.file));
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
    const unregistered = found.filter(f => !registered.has(f.file));

    expect(
      unregistered.map(f => f.file),
      unregistered.length === 0
        ? ''
        : `SEC-23: these files hold the Claude Agent SDK's execution entry point but ` +
          `are not in REGISTERED_SITES in tests/security/sdk-options-coverage.test.ts:\n` +
          unregistered.map(f => `  src/${f.file} — ${f.reasons.join(', ')}`).join('\n') +
          `\n\nA new execution path must get the same gate as the others. Route its ` +
          `options through buildEnforcedSdkOptions() in src/security/enforced-sdk-options.ts ` +
          `— that is what supplies permissionMode, canUseTool, hooks, allowedTools and ` +
          `disallowedTools — then add it here with a rationale. Do not add it here alone: ` +
          `the last time these drifted, the heartbeat loop shipped with no hook chain.`,
    ).toEqual([]);
  });

  // This check carries a second duty that is easy to mistake for bookkeeping:
  // it is what protects the *existing* sites against evasion. If a registered
  // file is refactored into a shape the scanner cannot see, it drops out of
  // `found` and fails here as stale — so an evasion of the scan is loud even
  // though the scan itself went quiet. Do not "simplify" this away as
  // redundant with the registry check above; the two cover different
  // populations (this one existing files, that one new ones).
  it('has no stale registry entry — a removed path should be de-registered', () => {
    const found = new Set(findConstructionSites().map(f => f.file));
    const stale = REGISTERED_SITES.filter(s => !found.has(s.file)).map(s => s.file);
    expect(stale, `registered but no longer constructing SDK options: ${stale.join(', ')}`).toEqual([]);
  });

  it('gives every registered site a rationale someone can act on', () => {
    for (const site of REGISTERED_SITES) {
      expect(site.rationale.length, `${site.file} has no rationale`).toBeGreaterThan(40);
    }
  });
});

// ─── 1b. The guard's own claimed property, asserted ──────────────────

/**
 * A drift guard is only worth its line count if it actually has the property
 * it claims. The first version of this file claimed in prose that the failure
 * "cannot be satisfied by the new path being carefully written" — and that was
 * untrue of it, which nothing noticed because the claim lived in a comment
 * instead of an assertion. The five shapes marked below as previously-missed
 * are the ones that walked past it.
 *
 * So the property is a test now. Each row is a file the scanner is shown
 * directly; `caught: true` means it must be flagged for registration.
 */
const SDK_ACQUISITION_SHAPES: { name: string; caught: boolean; source: string; note?: string }[] = [
  {
    name: 'inline object literal at the call site',
    caught: true,
    source: `import { query } from '${'@anthropic-ai/claude-agent-sdk'}';\nquery({ prompt, options });`,
  },
  {
    name: 'options hoisted to a variable',
    caught: true,
    note: 'previously missed — a routine refactor, not an attack',
    source: `import { query } from '${'@anthropic-ai/claude-agent-sdk'}';\nconst opts = { prompt };\nquery(opts);`,
  },
  {
    name: 'options from buildEnforcedSdkOptions() into a variable',
    caught: true,
    note: "previously missed — and this is claude-provider.ts's own idiom",
    source: `import { query } from '${'@anthropic-ai/claude-agent-sdk'}';\nconst enforced = buildEnforcedSdkOptions({ policy });\nquery(enforced);`,
  },
  {
    name: 'aliased import',
    caught: true,
    note: 'previously missed',
    source: `import { query as sdkQuery } from '${'@anthropic-ai/claude-agent-sdk'}';\nsdkQuery({ prompt });`,
  },
  {
    name: 'namespace import',
    caught: true,
    note: 'previously missed',
    source: `import * as sdk from '${'@anthropic-ai/claude-agent-sdk'}';\nsdk.query({ prompt });`,
  },
  {
    name: 'member call on a stored handle',
    caught: true,
    note: 'previously missed',
    source: `import { query } from '${'@anthropic-ai/claude-agent-sdk'}';\nthis._sdk = { query };\nthis._sdk.query({ prompt });`,
  },
  {
    name: 'dynamic import',
    caught: true,
    note: 'previously missed — and it is how the main task path acquires the SDK',
    source: `const m = await import('${'@anthropic-ai/claude-agent-sdk'}');\nconst q = m.query;\nq({ prompt });`,
  },
  {
    name: 'ExecutionLoop construction',
    caught: true,
    source: `new ExecutionLoop({ systemPrompt: 'x' });`,
  },
  // The other half of the boundary. These must stay clean, or the registry
  // fills with files nobody needed to reason about and entries get
  // rubber-stamped — which defeats the whole mechanism.
  {
    name: 'type-only import of SDK types',
    caught: false,
    source: `import type { Options } from '${'@anthropic-ai/claude-agent-sdk'}';\nconst o: Options = {};`,
  },
  {
    name: 'inline type specifier',
    caught: false,
    source: `import { type Options, type HookInput } from '${'@anthropic-ai/claude-agent-sdk'}';`,
  },
  {
    name: 'MCP registration helpers — cannot run a turn',
    caught: false,
    source: `import { createSdkMcpServer, tool } from '${'@anthropic-ai/claude-agent-sdk'}';`,
  },
  {
    name: 'type-only import from execution-loop',
    caught: false,
    source: `import type { ExecutionLoopOptions } from '../orchestrator/execution-loop.js';`,
  },
  {
    name: 'prose in a comment mentioning query({ … })',
    caught: false,
    source: `/** Calls query({ prompt, options }) eventually. */\nexport const x = 1;`,
  },
];

describe('SEC-23 — the guard detects acquisition, not call shape', () => {
  it.each(SDK_ACQUISITION_SHAPES)('$name', ({ caught, source, note }) => {
    const reasons = acquisitionReasons(stripComments(source));
    expect(
      reasons.length > 0,
      caught
        ? `this shape acquires the SDK but the scanner does not see it${note ? ` (${note})` : ''} — ` +
          `a file written this way would be registered nowhere and gated by nothing`
        : `this shape does not acquire the SDK but the scanner flags it — ` +
          `false positives push type-only importers into REGISTERED_SITES and turn ` +
          `registration into a rubber stamp`,
    ).toBe(caught);
  });

  it('sees the main task path on its own terms, not incidentally', () => {
    // claude-provider.ts acquires the SDK by dynamic import in _resolveQueryFn.
    // Under the old call-shape scan it was matched only because an unrelated
    // `queryFn({` literal happened to sit elsewhere in the file — delete that
    // literal and the reference implementation for calling the SDK went dark.
    const provider = findConstructionSites().find(f => f.file === 'providers/claude-provider.ts');
    expect(provider, 'claude-provider.ts is no longer detected at all').toBeDefined();
    expect(provider!.reasons).toContain('dynamically imports the SDK');
  });

  it('does not inflate the registry with files that merely reference the SDK', () => {
    // 18 files under src/ mention the SDK or execution-loop; only the ones that
    // can actually run a turn belong in the registry. If this number climbs,
    // the scan has gone broad and entries will start getting rubber-stamped.
    expect(findConstructionSites().length).toBeLessThanOrEqual(REGISTERED_SITES.length);
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
