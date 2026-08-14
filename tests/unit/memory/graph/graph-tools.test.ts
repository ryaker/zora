/**
 * graph_recall tool tests.
 *
 * The headline test is the two-hop one: it builds a corpus where the answer is
 * unreachable by lexical search, demonstrates that the project's own BM25 index
 * (MiniSearch, as used by MemoryManager) genuinely cannot find it, and then
 * shows `graph_recall` returning it. That contrast is the entire justification
 * for the graph tier — if lexical search could answer it, this tier should not
 * exist.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import MiniSearch from 'minisearch';
import { GraphMemoryClient } from '../../../../src/memory/graph/graph-memory-worker.js';
import { createGraphTools } from '../../../../src/tools/graph-tools.js';
import { loadSparrow } from '../../../../src/memory/graph/sparrow-loader.js';
import type { CustomToolDefinition } from '../../../../src/orchestrator/execution-loop.js';

const sparrowAvailable = (await loadSparrow()).available;
const describeIfNative = (): typeof describe | typeof describe.skip =>
  sparrowAvailable ? describe : describe.skip;

interface RecallResponse {
  mode?: string;
  anchor?: string;
  results?: Array<Record<string, unknown>>;
  count?: number;
  message?: string;
  error?: string;
}

/**
 * Three tasks. `job-1` and `job-2` both touch the `zora` project but share not
 * one content word; `job-3` shares vocabulary with `job-1` ("key", "signing")
 * while being about something else entirely.
 */
const CORPUS = [
  { jobId: 'job-1', summary: 'Rotated the signing key for release artifacts' },
  { jobId: 'job-2', summary: 'Bumped dependency versions and regenerated the lockfile' },
  { jobId: 'job-3', summary: 'Explained how a signing key works to a new contributor' },
];

describeIfNative()('graph_recall', () => {
  let tmpDir: string;
  let client: GraphMemoryClient;
  let tool: CustomToolDefinition;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zora-graph-tools-'));
    client = await GraphMemoryClient.create({
      enabled: true,
      path: path.join(tmpDir, 'graph.db'),
    });
    const tools = createGraphTools(client);
    expect(tools).toHaveLength(1);
    tool = tools[0]!;
  });

  afterEach(async () => {
    await client.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const call = async (input: Record<string, unknown>): Promise<RecallResponse> =>
    (await tool.handler(input)) as RecallResponse;

  it('is named and described for relational recall', () => {
    expect(tool.name).toBe('graph_recall');
    expect(tool.description).toContain('RELATIONSHIP');
    const schema = tool.input_schema as { required?: string[] };
    expect(schema.required).toEqual(['mode', 'anchor']);
  });

  it('answers "what other tasks mention entities this task mentions" — which BM25 cannot', async () => {
    // ── Part 1: prove the lexical index cannot answer it. ───────────────
    // Same engine and tokenizer StructuredMemory uses for memory_search.
    const index = new MiniSearch({
      fields: ['summary'],
      storeFields: ['jobId'],
      idField: 'jobId',
      tokenize: text => text.toLowerCase().split(/[\s\-_./]+/).filter(t => t.length > 0),
    });
    index.addAll(CORPUS);

    const anchor = CORPUS[0]!;
    const lexical = index.search(anchor.summary).filter(r => r.id !== anchor.jobId);

    // BM25 gets the ordering exactly backwards. job-3 ranks first because it
    // reuses "signing key" while being about something else; job-2 — the task
    // that actually shares context — ranks last.
    expect(lexical.map(r => r.id)).toEqual(['job-3', 'job-2']);

    // And job-2's rank is an artifact, not signal: the only token it shares
    // with the anchor is the stopword "the". There is no lexical evidence
    // connecting these two tasks for any ranking function to find.
    const tokens = (s: string): Set<string> => new Set(s.toLowerCase().split(/\s+/));
    const shared = [...tokens(anchor.summary)].filter(t => tokens(CORPUS[1]!.summary).has(t));
    expect(shared).toEqual(['the']);

    // So the top lexical answer — the one a `limit: 1` retrieval would use — is
    // the wrong task.
    expect(lexical[0]!.id).toBe('job-3');

    // ── Part 2: the graph answers it. ──────────────────────────────────
    // Both job-1 and job-2 touched the `zora` project; job-3 did not.
    client.recordTask({ ...anchor, outcome: 'success', ts: 1 }, [{ name: 'zora', kind: 'project' }]);
    client.recordTask({ ...CORPUS[1]!, outcome: 'success', ts: 2 }, [
      { name: 'zora', kind: 'project' },
    ]);
    client.recordTask({ ...CORPUS[2]!, outcome: 'success', ts: 3 }, [
      { name: 'onboarding', kind: 'concept' },
    ]);

    const response = await call({ mode: 'related_tasks', anchor: 'job-1' });

    expect(response.count).toBe(1);
    expect(response.results?.[0]).toMatchObject({
      job_id: 'job-2',
      summary: CORPUS[1]!.summary,
      shared_entities: ['zora'],
    });
    // The lexically-similar-but-unrelated task is correctly absent.
    expect(response.results?.map(r => r.job_id)).not.toContain('job-3');
  });

  it('returns neighbours of an entity with direction and relation', async () => {
    client.relateEntities(
      { name: 'alice', kind: 'person' },
      { name: 'zora', kind: 'project' },
      'maintains',
    );
    const response = await call({ mode: 'neighbours', anchor: 'alice' });
    expect(response.count).toBe(1);
    expect(response.results?.[0]).toMatchObject({
      entity: 'zora',
      kind: 'project',
      relation: 'maintains',
      direction: 'out',
    });
  });

  it('returns tasks mentioning an entity', async () => {
    client.recordTask({ jobId: 'job-1', summary: 's1', outcome: 'ok', ts: 1 }, [
      { name: 'zora', kind: 'project' },
    ]);
    const response = await call({ mode: 'tasks_mentioning', anchor: 'zora' });
    expect(response.results?.[0]).toMatchObject({ job_id: 'job-1', summary: 's1' });
  });

  it('returns a decision-supersession chain in order, flagging what was replaced', async () => {
    client.recordDecision({ summary: 'Store memory in flat files', rationale: 'simplest', ts: 1 });
    client.recordDecision(
      { summary: 'Store memory in SQLite', rationale: 'needs queries', ts: 2 },
      undefined,
      'Store memory in flat files',
    );
    client.recordDecision(
      { summary: 'Store memory in a graph', rationale: 'needs traversal', ts: 3 },
      undefined,
      'Store memory in SQLite',
    );

    const response = await call({ mode: 'decision_chain', anchor: 'Store memory in a graph' });
    expect(response.results?.map(r => r.summary)).toEqual([
      'Store memory in a graph',
      'Store memory in SQLite',
      'Store memory in flat files',
    ]);
    expect(response.results?.map(r => r.superseded)).toEqual([false, true, true]);
    expect(response.results?.[1]).toMatchObject({ rationale: 'needs queries', depth: 1 });
  });

  it('returns recorded failures for a tool, with the hint', async () => {
    client.recordFailure(
      { tool: 'Bash', signature: 'ENOENT: no such file', hint: 'check the cwd', ts: 1 },
      undefined,
    );
    const response = await call({ mode: 'tool_failures', anchor: 'Bash' });
    expect(response.results?.[0]).toMatchObject({
      tool: 'Bash',
      signature: 'ENOENT: no such file',
      hint: 'check the cwd',
    });
  });

  it('returns an explanatory message rather than an empty array for a miss', async () => {
    const response = await call({ mode: 'neighbours', anchor: 'nobody' });
    expect(response.count).toBe(0);
    expect(response.message).toContain('nobody');
  });

  it('rejects an unknown mode', async () => {
    const response = await call({ mode: 'telepathy', anchor: 'x' });
    expect(response.error).toContain('Unknown mode');
  });

  it('rejects a blank anchor', async () => {
    expect((await call({ mode: 'neighbours', anchor: '   ' })).error).toContain('anchor is required');
    expect((await call({ mode: 'neighbours', anchor: 42 })).error).toContain('anchor is required');
  });

  it('clamps the limit rather than trusting the model', async () => {
    const entity = { name: 'zora', kind: 'project' } as const;
    for (let i = 0; i < 8; i++) {
      client.recordTask({ jobId: `job-${i}`, summary: `s${i}`, outcome: 'ok', ts: i }, [entity]);
    }
    expect((await call({ mode: 'tasks_mentioning', anchor: 'zora', limit: 3 })).count).toBe(3);
    expect((await call({ mode: 'tasks_mentioning', anchor: 'zora', limit: 0 })).count).toBe(1);
    expect((await call({ mode: 'tasks_mentioning', anchor: 'zora', limit: 9999 })).count).toBe(8);
    expect((await call({ mode: 'tasks_mentioning', anchor: 'zora', limit: 'lots' })).count).toBe(8);
  });

  it('handles a hostile anchor without corrupting the graph', async () => {
    client.recordTask({ jobId: 'job-1', summary: 's', outcome: 'ok', ts: 1 }, [
      { name: 'zora', kind: 'project' },
    ]);
    const response = await call({
      mode: 'tasks_mentioning',
      anchor: "zora'}) DETACH DELETE t MATCH (e:Entity {name:'zora",
    });
    expect(response.count).toBe(0);
    // The graph is untouched.
    expect(await client.stats()).toMatchObject({ tasks: 1, entities: 1 });
  });

  it('degrades to a message if the tier goes inert after registration', async () => {
    await client.close();
    const response = await call({ mode: 'neighbours', anchor: 'zora' });
    expect(response.count).toBe(0);
    expect(response.message).toContain('unavailable');
  });
});
