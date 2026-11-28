import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';
import {
  registerGraphInspectCommands,
  listEntities,
  listAssertions,
  showProvenance,
  inspectUnavailable,
  type GraphInspectClient,
} from '../../../src/cli/graph-commands.js';

function fake(over: Partial<GraphInspectClient> = {}): GraphInspectClient {
  return {
    available: true,
    ontologyEnabled: true,
    unavailableReason: null,
    ontologyEntities: vi.fn(async () => [{ name: 'Zora', kind: 'project' as const }]),
    ontologyAssertions: vi.fn(async () => [
      { from: { name: 'Ann', kind: 'person' as const }, predicate: 'owns', to: { name: 'Zora', kind: 'project' as const }, memId: 'm1', ts: 0 },
    ]),
    memoryProvenance: vi.fn(async (memId: string) => ({ memId, entities: [], assertions: [] })),
    close: vi.fn(async () => {}),
    ...over,
  };
}

describe('memory graph inspect (#242)', () => {
  it('lists entities and assertions with provenance memory id', async () => {
    expect(await listEntities(fake(), 10)).toEqual(['1 entity:', '  Zora (project)']);
    const a = await listAssertions(fake(), 10);
    expect(a[1]).toContain('Ann (person) -[owns]-> Zora (project)');
    expect(a[1]).toContain('memory m1');
  });

  it('explains why nothing is shown when the tier is off, locked or ontology-less', () => {
    expect(inspectUnavailable(fake({ available: false, unavailableReason: 'database locked' }))).toMatch(/database locked/);
    expect(inspectUnavailable(fake({ ontologyEnabled: false }))).toMatch(/ZORA_GRAPH_ONTOLOGY/);
    expect(inspectUnavailable(fake())).toBeNull();
  });

  it('reports an empty provenance clearly', async () => {
    expect((await showProvenance(fake(), 'mX', 5))[0]).toMatch(/Nothing in the ontology was derived from memory mX/);
  });

  it('the CLI is read-only wiring: runs the query and always closes the client', async () => {
    const client = fake();
    const lines: string[] = [];
    const program = new Command().exitOverride();
    registerGraphInspectCommands(program.command('memory'), async () => client, l => lines.push(l));
    await program.parseAsync(['node', 'x', 'memory', 'graph', 'provenance', 'm1']);
    expect(client.memoryProvenance).toHaveBeenCalledWith('m1', 50);
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(Object.keys(client).some(k => /^(record|forget|write|upsert)/.test(k))).toBe(false);
  });
});
