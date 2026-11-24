/**
 * #194: pins the options that actually reach the SDK `query()` for the optional
 * ontology enrichment call. A fake ExecutionLoop cannot prove this: `allowedTools: []`
 * only filters permissions, the SDK `tools: []` option is what disables built-ins.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';
import type { TaskContext, ZoraPolicy } from '../../../src/types.js';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, query: queryMock };
});

const { Orchestrator } = await import('../../../src/orchestrator/orchestrator.js');
const { MockProvider } = await import('../../fixtures/mock-provider.js');

const policy: ZoraPolicy = {
  filesystem: { allowed_paths: ['/tmp'], denied_paths: [], resolve_symlinks: false, follow_symlinks: false },
  shell: { mode: 'allowlist', allowed_commands: ['echo'], denied_commands: [], split_chained_commands: true, max_execution_time: '30s' },
  actions: { reversible: ['read_file'], irreversible: ['write_file'], always_flag: [] },
  network: { allowed_domains: [], denied_domains: [], max_request_size: '10MB' },
};

const NOW = new Date().toISOString();
const ITEM = 'Zora uses SparrowDB for graph memory storage';
const ctx = {
  jobId: 'job-1',
  history: [{ type: 'text', content: { text: 'We talked about Zora and SparrowDB.' } }],
} as unknown as TaskContext;

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(({ options }: { options: Record<string, unknown> }) =>
    (async function* () {
      const sys = String(options['systemPrompt']);
      yield {
        type: 'result',
        result: sys.includes('entities and relations')
          ? JSON.stringify({ entities: [{ name: 'Zora', kind: 'project' }], relations: [] })
          : JSON.stringify([{ id: 'x0', type: 'knowledge', summary: ITEM, source: 'job-1', source_type: 'agent_analysis', created_at: NOW, last_accessed: NOW, access_count: 0, reinforcement_score: 0, tags: [], category: 'general' }]),
      };
    })(),
  );
});

describe('ontology enrichment SDK options (#194)', () => {
  it('disables built-in tools and inherited MCP only for the ontology call', async () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.agent.log_level = 'error';
    config.agent.workspace = path.join(os.tmpdir(), 'zora-onto-sdk-test');
    const orch = new Orchestrator({
      config,
      policy,
      providers: [new MockProvider({ name: 'primary', rank: 1 })],
      baseDir: path.join(os.tmpdir(), 'zora-onto-sdk-test'),
      skipChannels: true,
    });
    const i = orch as unknown as Record<string, unknown> & { _runExtractionAsync(c: TaskContext): Promise<void> };
    i['_policyEngine'] = { createCanUseTool: () => async () => ({ behavior: 'deny', message: 'n/a' }) };
    i['_memoryManager'] = {
      getCategories: async () => [],
      structuredMemory: {
        listItems: async () => [],
        createItem: async (x: Record<string, unknown>) => ({ id: 'mem_0', ...x, created_at: '2026-01-02T03:04:05.000Z' }),
      },
      appendDailyNote: async () => {},
    };
    i['_graphClient'] = { ontologyEnabled: true, recordFacts: () => {} };

    await i._runExtractionAsync(ctx);

    const calls = queryMock.mock.calls.map(c => (c[0] as { options: Record<string, unknown> }).options);
    const onto = calls.filter(o => String(o['systemPrompt']).includes('entities and relations'));
    const ordinary = calls.filter(o => !String(o['systemPrompt']).includes('entities and relations'));
    expect(onto).toHaveLength(1);
    expect(onto[0]!['tools']).toEqual([]);
    expect(onto[0]!['allowedTools']).toEqual([]);
    expect(onto[0]!['strictMcpConfig']).toBe(true);
    expect(onto[0]!['permissionMode']).toBe('default');
    expect(typeof onto[0]!['canUseTool']).toBe('function');
    expect(onto[0]!['hooks']).toBeDefined();
    // Other loops are untouched: the keys are not forwarded at all.
    expect(ordinary).toHaveLength(1);
    expect('tools' in ordinary[0]!).toBe(false);
    expect('strictMcpConfig' in ordinary[0]!).toBe(false);
  });
});
