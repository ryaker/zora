/**
 * #194 PR 2: drives the real Orchestrator._runExtractionAsync with a mocked
 * ExecutionLoop, to pin ordering (persist first), the default-off gate, and
 * the bound on enrichment calls.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';
import type { TaskContext, ZoraPolicy } from '../../../src/types.js';

const loopCalls: Array<{ systemPrompt: string; allowedTools?: unknown }> = [];
let responder: (systemPrompt: string) => string = () => '[]';

vi.mock('../../../src/orchestrator/execution-loop.js', async orig => {
  const actual = await orig<typeof import('../../../src/orchestrator/execution-loop.js')>();
  class FakeLoop {
    constructor(private readonly opts: { systemPrompt: string; allowedTools?: unknown }) {}
    async run(): Promise<string> {
      loopCalls.push({ systemPrompt: this.opts.systemPrompt, allowedTools: this.opts.allowedTools });
      return responder(this.opts.systemPrompt);
    }
  }
  return { ...actual, ExecutionLoop: FakeLoop };
});

const { Orchestrator } = await import('../../../src/orchestrator/orchestrator.js');
const { MockProvider } = await import('../../fixtures/mock-provider.js');
const { ONTOLOGY_MAX_ITEMS_PER_RUN } = await import('../../../src/memory/graph/ontology-extractor.js');

const policy: ZoraPolicy = {
  filesystem: { allowed_paths: ['/tmp'], denied_paths: [], resolve_symlinks: false, follow_symlinks: false },
  shell: { mode: 'allowlist', allowed_commands: ['echo'], denied_commands: [], split_chained_commands: true, max_execution_time: '30s' },
  actions: { reversible: ['read_file'], irreversible: ['write_file'], always_flag: [] },
  network: { allowed_domains: [], denied_domains: [], max_request_size: '10MB' },
};

interface Internals {
  _runExtractionAsync(ctx: TaskContext): Promise<void>;
  _memoryManager: unknown;
  _graphClient: unknown;
  _policyEngine: unknown;
}

const ITEM_COUNT = ONTOLOGY_MAX_ITEMS_PER_RUN + 3;

function setup(ontologyEnabled: boolean | null) {
  const config = structuredClone(DEFAULT_CONFIG);
  config.agent.log_level = 'error';
  config.agent.workspace = path.join(os.tmpdir(), 'zora-onto-test');
  const orch = new Orchestrator({
    config,
    policy,
    providers: [new MockProvider({ name: 'primary', rank: 1 })],
    baseDir: path.join(os.tmpdir(), 'zora-onto-test'),
    skipChannels: true,
  });
  const events: string[] = [];
  const created: string[] = [];
  const recorded: Array<{ memId: string }> = [];
  const internals = orch as unknown as Internals;
  internals._policyEngine = { createCanUseTool: () => async () => ({ behavior: 'deny', message: 'n/a' }) };
  internals._memoryManager = {
    getCategories: async () => [],
    structuredMemory: {
      listItems: async () => [],
      createItem: async (i: { summary: string }) => {
        events.push('save');
        const id = `mem_${created.length}`;
        created.push(id);
        return { id, ...i };
      },
    },
    appendDailyNote: async () => {
      events.push('note');
    },
  };
  internals._graphClient =
    ontologyEnabled === null
      ? null
      : {
          ontologyEnabled,
          recordFacts: (f: { memId: string }) => {
            events.push('graph');
            recorded.push(f);
          },
        };
  return { internals, events, created, recorded };
}

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];
const now = new Date().toISOString();
// Distinct vocabularies so the pipeline's Jaccard dedup keeps every item.
const items = Array.from({ length: ITEM_COUNT }, (_, i) => ({
  id: `x${i}`,
  type: 'knowledge',
  summary: `Zora uses SparrowDB ${WORDS[i]} ${WORDS[(i + 1) % 10]} ${WORDS[(i + 2) % 10]} ${WORDS[(i + 3) % 10]}`,
  source: 'job-1',
  source_type: 'agent_analysis',
  created_at: now,
  last_accessed: now,
  access_count: 0,
  reinforcement_score: 0,
  tags: [],
  category: 'general',
}));

const ctx = {
  jobId: 'job-1',
  history: [{ type: 'text', content: { text: 'We talked about Zora and SparrowDB.' } }],
} as unknown as TaskContext;

beforeEach(() => {
  loopCalls.length = 0;
  responder = sys =>
    sys.includes('entities and relations')
      ? JSON.stringify({
          entities: [
            { name: 'Zora', kind: 'project' },
            { name: 'SparrowDB', kind: 'tool' },
            { name: 'Invented', kind: 'tool' },
          ],
          relations: [{ from: 'Zora', to: 'SparrowDB', predicate: 'uses' }],
        })
      : JSON.stringify(items);
});

describe('orchestrator ontology enrichment (#194)', () => {
  it('flag off: no ontology model call and nothing recorded', async () => {
    const { internals, recorded } = setup(false);
    await internals._runExtractionAsync(ctx);
    expect(loopCalls.map(c => c.systemPrompt).some(p => p.includes('entities and relations'))).toBe(false);
    expect(recorded).toHaveLength(0);
  });

  it('no graph client: ordinary extraction still persists', async () => {
    const { internals, created } = setup(null);
    await internals._runExtractionAsync(ctx);
    expect(created).toHaveLength(ITEM_COUNT);
  });

  it('flag on: every save and the daily note precede any graph write; calls are bounded; facts are grounded', async () => {
    const { internals, events, created, recorded } = setup(true);
    await internals._runExtractionAsync(ctx);

    expect(created).toHaveLength(ITEM_COUNT);
    const firstGraph = events.indexOf('graph');
    expect(firstGraph).toBeGreaterThan(events.lastIndexOf('save'));
    expect(firstGraph).toBeGreaterThan(events.indexOf('note'));

    const ontologyCalls = loopCalls.filter(c => c.systemPrompt.includes('entities and relations'));
    expect(ontologyCalls).toHaveLength(ONTOLOGY_MAX_ITEMS_PER_RUN);
    // Tool-less like the existing extraction call (toolSurface 'none').
    for (const c of loopCalls) expect(c.allowedTools).toEqual([]);

    expect(recorded.map(r => r.memId)).toEqual(created.slice(0, ONTOLOGY_MAX_ITEMS_PER_RUN));
    const facts = recorded[0] as unknown as { entities: Array<{ name: string }> };
    expect(facts.entities.map(e => e.name).sort()).toEqual(['SparrowDB', 'Zora']); // 'Invented' ungrounded
  });
});
