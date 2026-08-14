/**
 * Graph Tools — relational recall for the agent (MEM-30).
 *
 * `memory_search` (see memory-tools.ts) is BM25 over item summaries: it finds
 * memories whose *words* match the query. `graph_recall` answers a different
 * class of question — one about *connections* — that a lexical index provably
 * cannot answer at all:
 *
 *   - "what else touched this project?"        → neighbours
 *   - "what other work involved the same       → related_tasks (two hops)
 *      things as this job?"
 *   - "what did this decision replace,          → decision_chain
 *      and why?"
 *   - "has this tool failed like this before?" → tool_failures
 *
 * The two-hop case is the clearest example. Two tasks can share zero words and
 * still both be about the deploy pipeline; BM25 scores their similarity at
 * roughly zero, while a graph traversal returns one from the other in a single
 * query because they both point at the same `(:Entity)`.
 *
 * The tool is exposed only when the graph tier is live. When it is inert the
 * factory returns an empty array, so the model never sees a tool that always
 * answers "unavailable".
 */

import type { CustomToolDefinition } from '../orchestrator/execution-loop.js';
import type { GraphMemoryClient } from '../memory/graph/graph-memory-worker.js';

const MODES = ['neighbours', 'related_tasks', 'tasks_mentioning', 'decision_chain', 'tool_failures'] as const;
type Mode = (typeof MODES)[number];

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/**
 * Build the graph tool definitions for a client.
 *
 * @returns `[graph_recall]` when the tier is live, `[]` when it is inert.
 */
export function createGraphTools(client: GraphMemoryClient): CustomToolDefinition[] {
  if (!client.available) return [];
  return [createGraphRecallTool(client)];
}

function createGraphRecallTool(client: GraphMemoryClient): CustomToolDefinition {
  return {
    name: 'graph_recall',
    description:
      'Recall memory by RELATIONSHIP rather than by keyword. Use this when the question is about how things ' +
      'connect — what else involved this project, what earlier work touched the same things as the current job, ' +
      'what a decision replaced, or whether a tool has failed this way before. ' +
      'Prefer memory_search when you are looking for a fact by its wording; prefer graph_recall when you are ' +
      'looking for things linked to something you already know. ' +
      'Modes: ' +
      'neighbours (entities directly related to an entity); ' +
      'related_tasks (TWO-HOP — other tasks that mention any entity the given task mentions; keyword search ' +
      'cannot answer this because the summaries need share no words); ' +
      'tasks_mentioning (tasks that reference an entity); ' +
      'decision_chain (a decision and everything it superseded, in order); ' +
      'tool_failures (recorded failures for a tool, with hints).',
    input_schema: {
      type: 'object',
      required: ['mode', 'anchor'],
      properties: {
        mode: {
          type: 'string',
          enum: [...MODES],
          description:
            'Which traversal to run. neighbours | related_tasks | tasks_mentioning | decision_chain | tool_failures',
        },
        anchor: {
          type: 'string',
          description:
            'The thing to traverse from. An entity name for neighbours/tasks_mentioning, a job id for ' +
            'related_tasks, a decision summary for decision_chain, a tool name for tool_failures.',
        },
        limit: {
          type: 'number',
          description: `Maximum results to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
          default: DEFAULT_LIMIT,
        },
      },
    },
    handler: async (input: Record<string, unknown>): Promise<unknown> => {
      const mode = input.mode;
      const anchor = typeof input.anchor === 'string' ? input.anchor.trim() : '';
      const limit = clampLimit(input.limit);

      if (!isMode(mode)) {
        return { error: `Unknown mode. Expected one of: ${MODES.join(', ')}.` };
      }
      if (!anchor) {
        return { error: 'anchor is required and must be a non-empty string.' };
      }
      if (!client.available) {
        // The tier can go inert after the tool was registered (worker crash).
        return { results: [], count: 0, message: 'Graph memory is unavailable.' };
      }

      switch (mode) {
        case 'neighbours': {
          const neighbours = await client.neighbours(anchor, limit);
          return respond(
            mode,
            anchor,
            neighbours.map(n => ({
              entity: n.name,
              kind: n.kind,
              relation: n.relation,
              direction: n.direction,
            })),
            `No entities are linked to "${anchor}".`,
          );
        }

        case 'related_tasks': {
          const tasks = await client.relatedTasks(anchor, limit);
          return respond(
            mode,
            anchor,
            tasks.map(t => ({
              job_id: t.jobId,
              summary: t.summary,
              outcome: t.outcome,
              ts: t.ts,
              shared_entities: t.via ?? [],
            })),
            `No other tasks share entities with job "${anchor}".`,
          );
        }

        case 'tasks_mentioning': {
          const tasks = await client.tasksMentioning(anchor, limit);
          return respond(
            mode,
            anchor,
            tasks.map(t => ({ job_id: t.jobId, summary: t.summary, outcome: t.outcome, ts: t.ts })),
            `No tasks mention "${anchor}".`,
          );
        }

        case 'decision_chain': {
          const decisions = await client.decisionChain(anchor, limit);
          return respond(
            mode,
            anchor,
            decisions.map(d => ({
              summary: d.summary,
              rationale: d.rationale,
              ts: d.ts,
              depth: d.depth,
              superseded: d.depth > 0,
            })),
            `No decision recorded matching "${anchor}".`,
          );
        }

        case 'tool_failures': {
          const failures = await client.failuresForTool(anchor, limit);
          return respond(
            mode,
            anchor,
            failures.map(f => ({ tool: f.tool, signature: f.signature, hint: f.hint, ts: f.ts })),
            `No recorded failures for tool "${anchor}".`,
          );
        }
      }
    },
  };
}

function respond(
  mode: Mode,
  anchor: string,
  results: unknown[],
  emptyMessage: string,
): Record<string, unknown> {
  return results.length === 0
    ? { mode, anchor, results: [], count: 0, message: emptyMessage }
    : { mode, anchor, results, count: results.length };
}

function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(value)));
}
