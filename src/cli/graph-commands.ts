/**
 * `zora-agent memory graph …` — read-only inspection of the auto-ontology (#242).
 *
 * Exists so the ontology can be validated by looking at it, not only through
 * unit tests. Nothing here writes. It opens the graph store the same way the
 * daemon does, so it only works while no other Zora process holds the database
 * (the store refuses a second writer) and only when ZORA_GRAPH_MEMORY=1 and
 * ZORA_GRAPH_ONTOLOGY=1 are set.
 *
 * What it exposes, and to whom: entity names, relations between them and the
 * IDs of the memories they were extracted from — i.e. a derived view of your
 * memory contents. It runs as the local user against a file under ~/.zora and
 * adds no network surface; anyone who can already read that file can see this.
 */

import type { Command } from 'commander';
import type { AssertionResult, EntityRecord, ProvenanceResult } from '../memory/graph/graph-types.js';
import { GraphMemoryClient } from '../memory/graph/graph-memory-worker.js';
import { graphConfigFromEnv } from '../memory/graph/graph-types.js';

/** The slice of GraphMemoryClient this command uses (kept narrow so tests can fake it). */
export interface GraphInspectClient {
  readonly available: boolean;
  readonly ontologyEnabled: boolean;
  readonly unavailableReason: string | null;
  ontologyEntities(limit?: number): Promise<EntityRecord[]>;
  ontologyAssertions(limit?: number): Promise<AssertionResult[]>;
  memoryProvenance(memId: string, limit?: number): Promise<ProvenanceResult>;
  close(): Promise<void>;
}

const ent = (e: EntityRecord): string => `${e.name} (${e.kind})`;
const when = (ts: number | null): string => (ts === null ? '?' : new Date(ts).toISOString());

/** Why nothing can be shown, or null when the ontology is readable. */
export function inspectUnavailable(client: GraphInspectClient): string | null {
  if (!client.available) {
    return `Graph memory is not available: ${client.unavailableReason ?? 'unknown reason'}. ` +
      'Set ZORA_GRAPH_MEMORY=1 and stop any running Zora daemon (the database allows one process).';
  }
  if (!client.ontologyEnabled) return 'Ontology is off. Set ZORA_GRAPH_ONTOLOGY=1 to inspect it.';
  return null;
}

export async function listEntities(client: GraphInspectClient, limit: number): Promise<string[]> {
  const why = inspectUnavailable(client);
  if (why) return [why];
  const entities = await client.ontologyEntities(limit);
  if (entities.length === 0) return ['No ontology entities.'];
  return [`${entities.length} entit${entities.length === 1 ? 'y' : 'ies'}:`, ...entities.map(e => `  ${ent(e)}`)];
}

export async function listAssertions(client: GraphInspectClient, limit: number): Promise<string[]> {
  const why = inspectUnavailable(client);
  if (why) return [why];
  const rows = await client.ontologyAssertions(limit);
  if (rows.length === 0) return ['No ontology assertions.'];
  return [
    `${rows.length} assertion${rows.length === 1 ? '' : 's'}:`,
    ...rows.map(a => `  ${ent(a.from)} -[${a.predicate}]-> ${ent(a.to)}   from memory ${a.memId} @ ${when(a.ts)}`),
  ];
}

export async function showProvenance(client: GraphInspectClient, memId: string, limit: number): Promise<string[]> {
  const why = inspectUnavailable(client);
  if (why) return [why];
  const p = await client.memoryProvenance(memId, limit);
  if (p.entities.length === 0 && p.assertions.length === 0) {
    return [`Nothing in the ontology was derived from memory ${memId}.`];
  }
  return [
    `Derived from memory ${p.memId}:`,
    `  entities (${p.entities.length}):`,
    ...p.entities.map(e => `    ${ent(e)}`),
    `  assertions (${p.assertions.length}):`,
    ...p.assertions.map(a => `    ${ent(a.from)} -[${a.predicate}]-> ${ent(a.to)}`),
  ];
}

export function registerGraphInspectCommands(
  memory: Command,
  makeClient: () => Promise<GraphInspectClient> = () => GraphMemoryClient.create(graphConfigFromEnv()),
  out: (line: string) => void = console.log,
): void {
  const graph = memory.command('graph').description('Inspect the auto-ontology (read-only; needs ZORA_GRAPH_MEMORY=1 ZORA_GRAPH_ONTOLOGY=1)');

  const run = async (fn: (c: GraphInspectClient) => Promise<string[]>): Promise<void> => {
    const client = await makeClient();
    try {
      for (const line of await fn(client)) out(line);
    } finally {
      await client.close();
    }
  };
  const limitOf = (v: string): number => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : 50;
  };

  graph.command('entities').description('List extracted entities')
    .option('-n, --limit <n>', 'Max rows', '50')
    .action((o: { limit: string }) => run(c => listEntities(c, limitOf(o.limit))));
  graph.command('assertions').description('List extracted relations')
    .option('-n, --limit <n>', 'Max rows', '50')
    .action((o: { limit: string }) => run(c => listAssertions(c, limitOf(o.limit))));
  graph.command('provenance <memId>').description('Show what the ontology derived from one memory')
    .option('-n, --limit <n>', 'Max rows', '50')
    .action((memId: string, o: { limit: string }) => run(c => showProvenance(c, memId, limitOf(o.limit))));
}
