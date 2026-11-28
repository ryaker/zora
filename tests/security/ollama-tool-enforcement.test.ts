/**
 * #254 — the Ollama tool loop carries the same enforcement chain as the SDK.
 *
 * Before #254 OllamaProvider sent no tools, so an Ollama primary could not act
 * and there was nothing to enforce. Now it executes tool calls itself, which
 * makes it a second place where "does a denial really stop the tool?" can go
 * wrong. These tests drive the provider against a scripted /api/chat and assert,
 * with the real PolicyEngine and the real built-in hooks, that:
 *
 *   - a canUseTool denial prevents execution (the file is never written),
 *   - a PreToolUse hook denial prevents execution and short-circuits canUseTool,
 *   - a hook argument rewrite is what actually executes,
 *   - no canUseTool means no tool runs (fail closed),
 *   - policy-banned tools are never offered to the model,
 *   - Zora tools reach the chain under their SDK (MCP-qualified) name.
 *
 * Like tool-enforcement.test.ts, these must not be weakened.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import { OllamaProvider } from '../../src/providers/ollama-provider.js';
import { ClaudeProvider } from '../../src/providers/claude-provider.js';
import { PolicyEngine } from '../../src/security/policy-engine.js';
import { ToolHookRunner, type ToolHook } from '../../src/hooks/tool-hook-runner.js';
import { buildSdkHooks } from '../../src/hooks/sdk-hook-bridge.js';
import { ShellSafetyHook } from '../../src/hooks/built-in/shell-safety.js';
import { SensitiveFileGuardHook } from '../../src/hooks/built-in/sensitive-file-guard.js';
import { globToRegExp } from '../../src/tools/local-builtin-tools.js';
import type { TaskContext, AgentEvent, ProviderConfig, ZoraPolicy } from '../../src/types.js';

// ─── Scripted Ollama ─────────────────────────────────────────────────

type Turn = { content?: string; tool_calls?: Array<{ function: { name: string; arguments: unknown } }> };

/** Stub fetch: each /api/chat call pops the next scripted turn; bodies are recorded. */
function scriptOllama(turns: Turn[], opts: { rejectTools?: boolean } = {}) {
  const bodies: Array<Record<string, unknown>> = [];
  const queue = [...turns];
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    bodies.push(body);
    if (opts.rejectTools && body['tools']) {
      return new Response('{"error":"registry.ollama.ai/library/x does not support tools"}', { status: 400 });
    }
    const turn = queue.shift() ?? { content: 'done' };
    const lines = [
      JSON.stringify({ model: 'm', message: { role: 'assistant', content: turn.content ?? '', tool_calls: turn.tool_calls }, done: false }),
      JSON.stringify({ model: 'm', message: { role: 'assistant', content: '' }, done: true, eval_count: 3 }),
    ];
    return new Response(lines.join('\n') + '\n', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { bodies, fetchMock };
}

const call = (name: string, args: unknown) => ({ tool_calls: [{ function: { name, arguments: args } }] });

// ─── Fixtures ────────────────────────────────────────────────────────

let dir: string;

const config: ProviderConfig = {
  name: 'ollama', type: 'ollama', rank: 1, capabilities: ['reasoning'],
  cost_tier: 'free', enabled: true, model: 'test-model', endpoint: 'http://ollama.test',
};

function makePolicy(overrides: Partial<ZoraPolicy> = {}): ZoraPolicy {
  return {
    filesystem: { allowed_paths: [dir], denied_paths: [path.join(dir, 'secret')], resolve_symlinks: false, follow_symlinks: false },
    shell: { mode: 'allowlist', allowed_commands: ['echo', 'ls'], denied_commands: ['rm'], split_chained_commands: true, max_execution_time: '1m' },
    actions: { reversible: [], irreversible: [], always_flag: [] },
    network: { allowed_domains: [], denied_domains: [], max_request_size: '1mb' },
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    jobId: 'job-1', task: 'do it', requiredCapabilities: [], complexity: 'simple',
    resourceType: 'reasoning', systemPrompt: '', memoryContext: [], history: [], ...overrides,
  };
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function toolMessages(body: Record<string, unknown>): Array<{ tool_name: string; content: string }> {
  return (body['messages'] as Array<{ role: string; tool_name: string; content: string }>).filter(m => m.role === 'tool');
}

function offeredTools(body: Record<string, unknown>): string[] {
  return ((body['tools'] as Array<{ function: { name: string } }> | undefined) ?? []).map(t => t.function.name);
}

beforeEach(async () => {
  dir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'zora-ollama-tools-')));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fsp.rm(dir, { recursive: true, force: true });
});

// ─── Tests ───────────────────────────────────────────────────────────

describe('#254 — Ollama tool calls execute only through the chain', () => {
  it('executes an allowed call and feeds the result back to the model', async () => {
    const file = path.join(dir, 'note.txt');
    await fsp.writeFile(file, 'hello from disk');
    const { bodies } = scriptOllama([call('Read', { file_path: file }), { content: 'It says hello.' }]);
    const policy = makePolicy();
    const provider = new OllamaProvider({ config, policy, cwd: dir });

    const events = await collect(provider.execute(makeTask({ canUseTool: new PolicyEngine(policy).createCanUseTool() })));

    expect(bodies).toHaveLength(2);
    expect(toolMessages(bodies[1]!)[0]!.content).toContain('hello from disk');
    const done = events.find(e => e.type === 'done');
    expect((done!.content as { text: string }).text).toContain('It says hello.');
  });

  it('a canUseTool (PolicyEngine) denial prevents execution', async () => {
    const outside = path.join(os.tmpdir(), `zora-outside-${Date.now()}.txt`);
    const { bodies } = scriptOllama([call('Write', { file_path: outside, content: 'x' }), { content: 'ok' }]);
    const policy = makePolicy();
    const provider = new OllamaProvider({ config, policy, cwd: dir });

    const events = await collect(provider.execute(makeTask({ canUseTool: new PolicyEngine(policy).createCanUseTool() })));

    await expect(fsp.access(outside)).rejects.toThrow();
    expect(toolMessages(bodies[1]!)[0]!.content).toMatch(/^Denied:/);
    const result = events.find(e => e.type === 'tool_result');
    expect((result!.content as { error?: string }).error).toBeTruthy();
  });

  it('a PreToolUse hook denial (ShellSafetyHook) prevents execution and skips canUseTool', async () => {
    const marker = path.join(dir, 'pwned');
    scriptOllama([call('Bash', { command: `rm -rf / ; touch ${marker}` }), { content: 'ok' }]);
    const runner = new ToolHookRunner();
    runner.register(ShellSafetyHook);
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }));
    const provider = new OllamaProvider({ config, policy: makePolicy(), cwd: dir });

    await collect(provider.execute(makeTask({ canUseTool, sdkHooks: buildSdkHooks(runner, () => 'job-1') })));

    expect(canUseTool).not.toHaveBeenCalled();
    await expect(fsp.access(marker)).rejects.toThrow();
  });

  it('SensitiveFileGuardHook blocks a Read of ~/.ssh on this path', async () => {
    const { bodies } = scriptOllama([call('Read', { file_path: '~/.ssh/id_rsa' }), { content: 'ok' }]);
    const runner = new ToolHookRunner();
    runner.register(SensitiveFileGuardHook);
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }));
    const provider = new OllamaProvider({ config, cwd: dir });

    await collect(provider.execute(makeTask({ canUseTool, sdkHooks: buildSdkHooks(runner, () => 'job-1') })));

    expect(canUseTool).not.toHaveBeenCalled();
    expect(toolMessages(bodies[1]!)[0]!.content).toMatch(/^Denied:/);
  });

  it('a hook argument rewrite is what actually executes', async () => {
    const { bodies } = scriptOllama([call('Bash', { command: 'echo sk-live-secret' }), { content: 'ok' }]);
    const rewrite: ToolHook = {
      name: 'test-rewrite', phase: 'before',
      async run(ctx) {
        return { allow: true, modifiedArgs: { command: String(ctx.arguments['command']).replace('sk-live-secret', '[REDACTED]') } };
      },
    };
    const runner = new ToolHookRunner();
    runner.register(rewrite);
    const seen: unknown[] = [];
    const canUseTool = vi.fn(async (_t: string, input: Record<string, unknown>) => {
      seen.push(input['command']);
      return { behavior: 'allow' as const };
    });
    const provider = new OllamaProvider({ config, cwd: dir });

    const events = await collect(provider.execute(makeTask({ canUseTool, sdkHooks: buildSdkHooks(runner, () => 'job-1') })));

    expect(seen).toEqual(['echo [REDACTED]']);
    const out = toolMessages(bodies[1]!)[0]!.content;
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('sk-live-secret');
    // The observed tool_call carries the redacted arguments, not the model's.
    const observed = events.find(e => e.type === 'tool_call');
    expect(JSON.stringify(observed!.content)).not.toContain('sk-live-secret');
  });

  it('fails closed: with no canUseTool wired, no tool runs', async () => {
    const target = path.join(dir, 'written.txt');
    scriptOllama([call('Write', { file_path: target, content: 'x' }), { content: 'ok' }]);
    const provider = new OllamaProvider({ config, cwd: dir });

    await collect(provider.execute(makeTask()));

    await expect(fsp.access(target)).rejects.toThrow();
  });

  it('never offers policy-banned tools (shell deny_all)', async () => {
    const { bodies } = scriptOllama([{ content: 'hi' }]);
    const policy = makePolicy({ shell: { mode: 'deny_all', allowed_commands: [], denied_commands: [], split_chained_commands: true, max_execution_time: '1m' } });
    const provider = new OllamaProvider({ config, policy, cwd: dir });

    await collect(provider.execute(makeTask({ canUseTool: new PolicyEngine(policy).createCanUseTool() })));

    expect(offeredTools(bodies[0]!)).not.toContain('Bash');
    expect(offeredTools(bodies[0]!)).toContain('Read');
  });

  it('denies a banned tool the model calls anyway', async () => {
    const marker = path.join(dir, 'ran');
    scriptOllama([call('Bash', { command: `touch ${marker}` }), { content: 'ok' }]);
    const policy = makePolicy({ shell: { mode: 'deny_all', allowed_commands: [], denied_commands: [], split_chained_commands: true, max_execution_time: '1m' } });
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }));
    const provider = new OllamaProvider({ config, policy, cwd: dir });

    await collect(provider.execute(makeTask({ canUseTool })));

    await expect(fsp.access(marker)).rejects.toThrow();
  });

  it('presents Zora tools to the chain under their MCP-qualified SDK name', async () => {
    scriptOllama([call('memory_save', { text: 'remember this' }), { content: 'saved' }]);
    const handler = vi.fn(async () => ({ ok: true }));
    const names: string[] = [];
    const canUseTool = vi.fn(async (tool: string) => {
      names.push(tool);
      return { behavior: 'allow' as const };
    });
    const provider = new OllamaProvider({ config, cwd: dir });

    await collect(provider.execute(makeTask({
      canUseTool,
      customTools: [{ name: 'memory_save', description: 'save', input_schema: { type: 'object' }, handler }],
    })));

    expect(names).toEqual(['mcp__zora-tools__memory_save']);
    expect(handler).toHaveBeenCalledWith({ text: 'remember this' });
  });
});

describe('#254 review — fixes', () => {
  it('Grep under an allowed root does not read a denied subtree', async () => {
    await fsp.mkdir(path.join(dir, 'secret'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'secret', 'key.txt'), 'PRIVATE-KEY-MATERIAL');
    await fsp.writeFile(path.join(dir, 'open.txt'), 'PRIVATE-KEY-MATERIAL in the open');
    const { bodies } = scriptOllama([call('Grep', { pattern: 'PRIVATE', path: dir }), { content: 'ok' }]);
    const policy = makePolicy();
    const provider = new OllamaProvider({ config, policy, cwd: dir });
    await collect(provider.execute(makeTask({ canUseTool: new PolicyEngine(policy).createCanUseTool() })));
    const out = toolMessages(bodies[1]!)[0]!.content;
    expect(out).toContain('open.txt');
    expect(out).not.toContain(path.join('secret', 'key.txt'));
  });

  it('Glob under an allowed root does not list sensitive files', async () => {
    await fsp.writeFile(path.join(dir, '.env'), 'X=1');
    await fsp.writeFile(path.join(dir, 'a.ts'), '');
    const { bodies } = scriptOllama([call('Glob', { pattern: '**/*', path: dir }), { content: 'ok' }]);
    const policy = makePolicy();
    const provider = new OllamaProvider({ config, policy, cwd: dir });
    await collect(provider.execute(makeTask({ canUseTool: new PolicyEngine(policy).createCanUseTool() })));
    const out = toolMessages(bodies[1]!)[0]!.content;
    expect(out).toContain('a.ts');
    expect(out).not.toContain('.env');
  });

  it('Write without content does not truncate the file', async () => {
    const file = path.join(dir, 'keep.txt');
    await fsp.writeFile(file, 'precious');
    scriptOllama([call('Write', { file_path: file }), { content: 'ok' }]);
    const provider = new OllamaProvider({ config, cwd: dir });
    await collect(provider.execute(makeTask({ canUseTool: async () => ({ behavior: 'allow' }) })));
    expect(await fsp.readFile(file, 'utf8')).toBe('precious');
  });

  it('the done text is the final answer, not every turn run together', async () => {
    const file = path.join(dir, 'n.txt');
    await fsp.writeFile(file, 'x');
    scriptOllama([{ content: 'Let me check.', ...call('Read', { file_path: file }) }, { content: 'It says x.' }]);
    const provider = new OllamaProvider({ config, cwd: dir });
    const events = await collect(provider.execute(makeTask({ canUseTool: async () => ({ behavior: 'allow' }) })));
    expect((events.find(e => e.type === 'done')!.content as { text: string }).text).toBe('It says x.');
  });

  it('globToRegExp expands wildcards inside braces', () => {
    expect(globToRegExp('**/{*.ts,*.tsx}').test('src/a.tsx')).toBe(true);
    expect(globToRegExp('src/{a?,b}').test('src/ax')).toBe(true);
  });
});

describe('#254 review — no-tools prompts keep an empty surface on Claude fallback', () => {
  it('ClaudeProvider honours disableTools with toolSurface none and tools: []', async () => {
    let captured: Record<string, unknown> | undefined;
    const provider = new ClaudeProvider({
      config: { name: 'claude', type: 'claude-sdk', rank: 2, capabilities: ['reasoning'], cost_tier: 'metered', enabled: true },
      queryFn: ((args: { options: Record<string, unknown> }) => {
        captured = args.options;
        return (async function* () { /* no messages */ })() as unknown;
      }) as never,
    });
    await collect(provider.execute(makeTask({
      disableTools: true,
      canUseTool: async () => ({ behavior: 'allow' }),
      customTools: [{ name: 'memory_save', description: 's', input_schema: { type: 'object' }, handler: async () => ({}) }],
    })));
    expect(captured!['allowedTools']).toEqual([]);
    expect(captured!['tools']).toEqual([]);
    expect(captured!['strictMcpConfig']).toBe(true);
    expect(captured!['mcpServers']).toBeUndefined();
  });

  it('ProviderPromptRunner falls back to the next rank when the first fails before acting', async () => {
    const failing = new MockProvider({ name: 'ollama', rank: 1 });
    vi.spyOn(failing, 'execute').mockImplementation(async function* () {
      yield { type: 'error', timestamp: new Date(), source: 'ollama', content: { message: 'boom' } } as AgentEvent;
    });
    const backup = new MockProvider({ name: 'claude', rank: 2, responseText: 'from backup' });
    const runner = new ProviderPromptRunner({
      selectProvider: async () => failing,
      fallbackProviders: () => [failing, backup],
      systemPrompt: '', jobLabel: 'test', disableTools: true,
    });
    await runner.run('x');
    expect(backup.executeCalls).toHaveLength(1);
    expect(backup.executeCalls[0]!.disableTools).toBe(true);
  });

  it('does not retry elsewhere once a tool has run', async () => {
    const acted = new MockProvider({ name: 'ollama', rank: 1 });
    vi.spyOn(acted, 'execute').mockImplementation(async function* () {
      yield { type: 'tool_call', timestamp: new Date(), source: 'ollama', content: { toolCallId: 'c', tool: 'Bash', arguments: {} } } as AgentEvent;
      yield { type: 'error', timestamp: new Date(), source: 'ollama', content: { message: 'boom' } } as AgentEvent;
    });
    const backup = new MockProvider({ name: 'claude', rank: 2 });
    const runner = new ProviderPromptRunner({
      selectProvider: async () => acted, fallbackProviders: () => [acted, backup], systemPrompt: '', jobLabel: 'test',
    });
    await expect(runner.run('x')).rejects.toThrow('boom');
    expect(backup.executeCalls).toHaveLength(0);
  });
});

describe('#254 — Ollama loop mechanics', () => {
  it('accepts arguments sent as a JSON string', async () => {
    const file = path.join(dir, 'a.txt');
    await fsp.writeFile(file, 'stringly');
    const { bodies } = scriptOllama([call('Read', JSON.stringify({ file_path: file })), { content: 'ok' }]);
    const provider = new OllamaProvider({ config, cwd: dir });
    await collect(provider.execute(makeTask({ canUseTool: async () => ({ behavior: 'allow' }) })));
    expect(toolMessages(bodies[1]!)[0]!.content).toContain('stringly');
  });

  it('retries without tools when the model does not support them', async () => {
    const { bodies } = scriptOllama([{ content: 'plain answer' }], { rejectTools: true });
    const provider = new OllamaProvider({ config, cwd: dir });
    const events = await collect(provider.execute(makeTask()));
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!['tools']).toBeUndefined();
    expect((events.find(e => e.type === 'done')!.content as { text: string }).text).toBe('plain answer');
  });

  it('sends no tools when the task disables them', async () => {
    const { bodies } = scriptOllama([{ content: 'x' }]);
    const provider = new OllamaProvider({ config, cwd: dir });
    await collect(provider.execute(makeTask({ disableTools: true })));
    expect(bodies[0]!['tools']).toBeUndefined();
  });

  it('stops at the turn budget with an error', async () => {
    scriptOllama([call('Glob', { pattern: '*', path: dir }), call('Glob', { pattern: '*', path: dir })]);
    const provider = new OllamaProvider({ config, cwd: dir });
    const events = await collect(provider.execute(makeTask({ maxTurns: 2, canUseTool: async () => ({ behavior: 'allow' }) })));
    expect(events.some(e => e.type === 'error')).toBe(true);
    expect(events.some(e => e.type === 'done')).toBe(false);
  });

  it('globToRegExp handles ** and braces', () => {
    expect(globToRegExp('**/*.ts').test('src/a/b.ts')).toBe(true);
    expect(globToRegExp('**/*.ts').test('b.ts')).toBe(true);
    expect(globToRegExp('*.{ts,js}').test('x.js')).toBe(true);
    expect(globToRegExp('*.ts').test('a/b.ts')).toBe(false);
  });
});

// ─── Internal paths on an Ollama primary ─────────────────────────────

import { Orchestrator } from '../../src/orchestrator/orchestrator.js';
import { ProviderPromptRunner } from '../../src/orchestrator/provider-prompt-runner.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { MockProvider } from '../fixtures/mock-provider.js';
import type { ZoraConfig } from '../../src/types.js';

interface Internals {
  _buildHeartbeatLoop(cwd: string, streamTimeoutMs: number): { run(p: string): Promise<string> };
  _buildCompressFn(): (prompt: string) => Promise<string>;
}

describe('#254 — heartbeat and compression leave the Claude SDK on an Ollama primary', () => {
  let baseDir: string;
  let orchestrator: Orchestrator;
  let mock: MockProvider;

  beforeEach(async () => {
    baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zora-254-orch-'));
    const cfg: ZoraConfig = structuredClone(DEFAULT_CONFIG);
    cfg.agent.log_level = 'error';
    cfg.agent.workspace = path.join(baseDir, 'workspace');
    cfg.security.policy_file = path.join(baseDir, 'policy.toml');
    cfg.security.audit_log = path.join(baseDir, 'audit', 'audit.jsonl');
    cfg.steering.enabled = false;
    cfg.notifications.enabled = false;
    cfg.providers = [
      { name: 'ollama', type: 'ollama', rank: 1, capabilities: ['reasoning'], cost_tier: 'free', enabled: true },
      { name: 'claude', type: 'claude-sdk', rank: 2, capabilities: ['reasoning'], cost_tier: 'metered', enabled: true },
    ];
    mock = new MockProvider({ name: 'ollama', rank: 1, responseText: 'observed' });
    orchestrator = new Orchestrator({
      config: cfg, policy: makePolicy(), providers: [mock], baseDir, skipChannels: true,
    });
    await orchestrator.boot();
  }, 30_000);

  afterEach(async () => {
    if (orchestrator?.isBooted) await orchestrator.shutdown();
    vi.restoreAllMocks();
    await fsp.rm(baseDir, { recursive: true, force: true }).catch(() => {});
  });

  it('the heartbeat runs on the ranked provider and carries canUseTool + the hook bridge', async () => {
    const loop = (orchestrator as unknown as Internals)._buildHeartbeatLoop(baseDir, 5_000);
    expect(loop).toBeInstanceOf(ProviderPromptRunner);
    await loop.run('check the inbox');
    const task = mock.executeCalls.at(-1)!;
    expect(task.canUseTool).toBeTypeOf('function');
    expect(task.sdkHooks?.PreToolUse?.[0]?.hooks).toHaveLength(1);
    expect(task.sdkHooks?.PostToolUse?.[0]?.hooks).toHaveLength(1);
  });

  it('compression never reaches the SDK and has no tool surface', async () => {
    const mod = await import('../../src/orchestrator/execution-loop.js');
    const sdkRun = vi.spyOn(mod.ExecutionLoop.prototype, 'run');
    const out = await (orchestrator as unknown as Internals)._buildCompressFn()('summarise this');
    expect(sdkRun).not.toHaveBeenCalled();
    expect(out).toBeTypeOf('string');
    const task = mock.executeCalls.at(-1)!;
    expect(task.disableTools).toBe(true);
    expect(task.customTools).toBeUndefined();
  });
});
