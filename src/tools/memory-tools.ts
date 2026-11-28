/**
 * Memory Tools — Agent-facing tool definitions for memory operations.
 *
 * Three tools exposed to the LLM:
 *   - memory_save: Store a new memory item (with validation)
 *   - memory_search: Search memory with BM25+ and salience ranking
 *   - memory_forget: Soft-delete a memory item to archive
 */

import type { CustomToolDefinition } from '../orchestrator/execution-loop.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import type { StructuredMemory } from '../memory/structured-memory.js';
import type { ValidationPipeline } from '../memory/validation-pipeline.js';
import type { MemoryItem, MemoryItemType, SourceType } from '../memory/memory-types.js';
import type { GraphMemoryClient } from '../memory/graph/graph-memory-worker.js';
import { isEntityKind, type EntityRecord } from '../memory/graph/graph-types.js';

const VALID_TYPES: MemoryItemType[] = ['profile', 'event', 'knowledge', 'behavior', 'skill', 'tool'];
const VALID_SOURCE_TYPES: SourceType[] = ['user_instruction', 'agent_analysis', 'tool_output'];

/**
 * Creates the three memory tool definitions wired to a MemoryManager instance.
 */
export function createMemoryTools(
  memoryManager: MemoryManager,
  validationPipeline: ValidationPipeline,
  graph?: GraphMemoryClient | null,
): CustomToolDefinition[] {
  const structuredMemory = memoryManager.structuredMemory;

  return [
    createMemorySaveTool(structuredMemory, validationPipeline),
    createMemorySearchTool(memoryManager, graph ?? null),
    createMemoryForgetTool(memoryManager),
  ];
}

function createMemorySaveTool(
  structuredMemory: StructuredMemory,
  validationPipeline: ValidationPipeline,
): CustomToolDefinition {
  return {
    name: 'memory_save',
    description:
      'Save a fact or observation to long-term memory. Use this to remember important information across sessions. ' +
      'Each memory should be a single, specific statement — not a summary. ' +
      'Only save facts that would be useful in a DIFFERENT session.',
    input_schema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: {
          type: 'string',
          description: 'The fact to remember. Must be at least 15 characters. Be specific and concise.',
        },
        type: {
          type: 'string',
          enum: VALID_TYPES,
          description: 'Memory type: profile (user facts), event (things that happened), knowledge (project/world facts), behavior (preferences), skill (procedures), tool (tool-specific notes).',
          default: 'knowledge',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Categorization tags for the memory.',
          default: [],
        },
        entity: {
          type: 'string',
          description: 'Related entity (person, project, tool name).',
        },
        source_type: {
          type: 'string',
          enum: VALID_SOURCE_TYPES,
          description: 'How this fact was learned: user_instruction (user told you), agent_analysis (you inferred it), tool_output (from a tool result).',
          default: 'agent_analysis',
        },
      },
    },
    handler: async (input: Record<string, unknown>): Promise<unknown> => {
      const content = input.content as string;
      const type = (input.type as MemoryItemType) ?? 'knowledge';
      const tags = (input.tags as string[]) ?? [];
      const entity = input.entity as string | undefined;
      const sourceType = (input.source_type as SourceType) ?? 'agent_analysis';

      // Run validation gates
      // NOTE: listItems() reads all items for dedup/contradiction checking.
      // This is O(N) but acceptable for small-medium collections (<10k items).
      // For large scale, consider: Bloom filter, dedup index, or batch validation.
      const existingItems = await structuredMemory.listItems();
      const validation = validationPipeline.validate(content, tags, existingItems);

      if (!validation.valid) {
        return {
          success: false,
          reason: validation.reason,
          ...(validation.duplicateOf ? { duplicate_of: validation.duplicateOf } : {}),
          ...(validation.conflictsWith ? { conflicts_with: validation.conflictsWith } : {}),
        };
      }

      // Build category from entity + type
      const category = entity ? `${type}/${entity}` : type;

      const item = await structuredMemory.createItem({
        type,
        summary: content,
        source: 'agent_session',
        source_type: sourceType,
        tags,
        category,
      });

      return {
        success: true,
        id: item.id,
        message: `Saved to memory: "${content.slice(0, 60)}${content.length > 60 ? '...' : ''}"`,
      };
    },
  };
}

/** Cap on graph-expanded candidates per search, across entity + relation lookups (#194c). */
const MAX_GRAPH_CANDIDATES = 20;

/** Structured-memory identity shape; anything else from the graph is dropped (#194c). */
const MEMORY_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Lexical hits connected to the requested entity/relation are multiplied by this
 * (#194c). The ontology is a relevance signal, not a gate: retrieval never needs
 * a permission check, so there is no source-eligibility policy (Richard, #184 c).
 */
const GRAPH_BOOST = 1.25;

/**
 * Advisory abstain signal (#243): when the best returned score is below this, the
 * response carries `low_confidence: true` so the model can say "I don't know" or ask
 * instead of guessing. Purely advisory: results are never filtered or blocked by it
 * (ontology/ranking never gates retrieval, #230).
 */
export const LOW_CONFIDENCE_SCORE = 0.15;

/**
 * Relevance an ontology-validated match contributes when its text shares no query
 * words, so a positive `min_score` does not discard exactly the matches the graph
 * exists to find. Still scaled by recency/frequency/source trust; hits stay
 * provisional, not verified facts (#194c).
 */
const GRAPH_RELEVANCE_FLOOR = 0.5;

/** Case-insensitive mention check: re-validates against CURRENT item content. */
function mentions(item: MemoryItem, names: readonly string[]): boolean {
  const text = item.summary.toLowerCase();
  return names.some(n => text.includes(n.toLowerCase()));
}

/** Caller-supplied aliases per entity (#245): bounded so a long list cannot widen matching unboundedly. */
const MAX_ALIASES = 5;
const MAX_ALIAS_LENGTH = 100;

/**
 * Names that count as "this entity is still mentioned": the canonical name plus
 * optional aliases ("Sparrow" for SparrowDB). Aliases only widen the stale-evidence
 * check; the graph still finds candidates by the exact canonical (kind, name), so an
 * alias can never pull in a memory the graph did not already link to the entity.
 * Aliases shorter than 3 chars are ignored: they match too much text.
 */
function evidenceNames(raw: unknown, canonical: string): string[] {
  const out = [canonical];
  const aliases = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).aliases : undefined;
  if (Array.isArray(aliases)) {
    for (const a of aliases) {
      if (out.length > MAX_ALIASES) break;
      if (typeof a !== 'string') continue;
      const t = a.trim();
      if (t.length >= 3 && t.length <= MAX_ALIAS_LENGTH && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

function parseEntity(raw: unknown): EntityRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || r.name.trim() === '' || !isEntityKind(r.kind)) return null;
  return { name: r.name.trim(), kind: r.kind };
}

function createMemorySearchTool(
  memoryManager: MemoryManager,
  graph: GraphMemoryClient | null,
): CustomToolDefinition {
  return {
    name: 'memory_search',
    description:
      'Search long-term memory for relevant facts. Returns results ranked by relevance, recency, and trust. ' +
      'Use this before making assumptions — check if you already know something. ' +
      'If the response has low_confidence: true, the match is weak or absent: say you are unsure or ask rather than guessing (advisory; results are still returned).',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return.',
          default: 5,
        },
        type: {
          type: 'string',
          enum: VALID_TYPES,
          description: 'Filter results by memory type.',
        },
        min_score: {
          type: 'number',
          description: 'Minimum salience score threshold (0-1 range typical).',
        },
        entity: {
          type: 'object',
          description:
            'Optional (#194c): also return PROVISIONAL candidate memories linked to this entity, e.g. {"name":"Zora","kind":"project"}. ' +
            'Candidates are re-checked against current content but are not verified facts. Ignored unless ontology memory is enabled.',
          properties: {
            name: { type: 'string' },
            kind: { type: 'string', enum: ['person', 'project', 'tool', 'concept'] },
            aliases: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional other names the memory text may use for this entity (e.g. "Sparrow" for SparrowDB). Only widens the still-mentioned check.',
            },
          },
        },
        relation: {
          type: 'object',
          description:
            'Optional (#194c): also return PROVISIONAL candidate memories linked to this relation (both entities must appear in current content), e.g. ' +
            '{"from":{"name":"Zora","kind":"project"},"to":{"name":"SparrowDB","kind":"tool"},"predicate":"uses"}. ' +
            'Ignored unless ontology memory is enabled.',
          properties: {
            from: { type: 'object' },
            to: { type: 'object' },
            predicate: { type: 'string' },
          },
        },
      },
    },
    handler: async (input: Record<string, unknown>): Promise<unknown> => {
      const query = input.query as string;
      const limit = (input.limit as number) ?? 5;
      const typeFilter = input.type as MemoryItemType | undefined;
      const minScore = input.min_score as number | undefined;

      let scores = await memoryManager.searchMemory(query, limit * 2); // fetch extra for filtering

      // Build item map from read-only lookups (peekItem avoids inflating access_count
      // and triggering disk writes for each search result)
      const itemMap = new Map<string, MemoryItem>();
      for (const s of scores) {
        const item = await memoryManager.structuredMemory.peekItem(s.itemId);
        if (item) itemMap.set(item.id, item);
      }

      // Apply type filter if specified
      if (typeFilter) {
        scores = scores.filter(s => {
          const item = itemMap.get(s.itemId);
          return item && item.type === typeFilter;
        });
      }

      // #194c: entity/relation-aware ranking. The graph only proposes memory IDs; each
      // must resolve through the same read path as a lexical hit (peekItem: archived or
      // forgotten items don't resolve) and match the type filter. No visibility gate:
      // retrieval is not an authorization point (#184 c). Graph hits are provisional
      // relevance signals: lexical hits they connect to are boosted, graph-only hits are
      // scored like any item and compete for the same limit and min_score.
      // One shared candidate budget; any graph failure discards ALL graph candidates.
      const graphScored: Array<{ itemId: string; score: number }> = [];
      const graphIds = new Set<string>();
      if (graph?.ontologyEnabled) {
        const entity = parseEntity(input.entity);
        const rel = input.relation as Record<string, unknown> | undefined;
        const from = parseEntity(rel?.from);
        const to = parseEntity(rel?.to);
        const predicate = typeof rel?.predicate === 'string' ? rel.predicate.trim() : '';
        const cands: Array<{ id: string; names: string[][] }> = [];
        try {
          let budget = MAX_GRAPH_CANDIDATES;
          if (entity) {
            const ids = await graph.sourcesOfChecked(entity.name, entity.kind, budget);
            for (const id of ids.slice(0, budget)) cands.push({ id, names: [evidenceNames(input.entity, entity.name)] });
            budget -= Math.min(ids.length, budget);
          }
          if (from && to && predicate && budget > 0) {
            const ids = await graph.relationSourcesChecked(from, to, predicate, budget);
            for (const id of ids.slice(0, budget)) cands.push({ id, names: [evidenceNames(rel?.from, from.name), evidenceNames(rel?.to, to.name)] });
          }
        } catch {
          cands.length = 0; // partial failure => lexical-only, per documented fallback
        }
        const lexicalIds = new Set(scores.map(s => s.itemId));
        for (const { id, names } of cands) {
          if (typeof id !== 'string' || !MEMORY_ID_RE.test(id) || graphIds.has(id)) continue;
          // Lexical hits were already resolved above; others resolve via peekItem.
          const item = itemMap.get(id) ?? await memoryManager.structuredMemory.peekItem(id);
          if (!item) continue;
          if (typeFilter && item.type !== typeFilter) continue;
          if (!names.every(n => mentions(item, n))) continue; // stale-evidence guard
          graphIds.add(id);
          if (!lexicalIds.has(id)) {
            itemMap.set(id, item);
            graphScored.push({ itemId: id, score: memoryManager.scoreMemoryItem(item, query, GRAPH_RELEVANCE_FLOOR).score });
          }
        }
      }

      // Boost lexical hits connected to the requested entity/relation, add graph-only
      // hits, then apply min_score uniformly and enforce the single caller limit.
      const merged = [
        ...scores.map(s => ({ itemId: s.itemId, score: graphIds.has(s.itemId) ? s.score * GRAPH_BOOST : s.score })),
        ...graphScored,
      ];
      scores = merged
        .filter(s => minScore === undefined || s.score >= minScore)
        .sort((x, y) => y.score - x.score)
        .slice(0, limit) as typeof scores;

      if (scores.length === 0) {
        return {
          results: [],
          message: 'No matching memories found.',
          low_confidence: true,
          advice: 'Nothing relevant is stored; say you do not know or ask the user rather than guessing.',
        };
      }

      const results = scores.map(s => {
        const item = itemMap.get(s.itemId);
        if (!item) return null;
        const base: Record<string, unknown> = {
          id: item.id,
          content: item.summary,
          type: item.type,
          tags: item.tags,
          score: Number(s.score.toFixed(3)),
          created: item.created_at,
          // Source type is returned as data; tool_output is labelled, never excluded.
          source_type: item.source_type,
        };
        if (graphIds.has(item.id)) {
          base.via = 'graph';
          base.provisional = true; // relevance candidate; not a verified fact or citation grant
        }
        return base;
      }).filter(Boolean);

      const top = scores[0]?.score ?? 0;
      if (top < LOW_CONFIDENCE_SCORE) {
        return {
          results,
          count: results.length,
          low_confidence: true,
          advice: 'Best match is weak; treat these as hints, and say you are unsure or ask the user rather than asserting them.',
        };
      }
      return { results, count: results.length };
    },
  };
}

function createMemoryForgetTool(memoryManager: MemoryManager): CustomToolDefinition {
  return {
    name: 'memory_forget',
    description:
      'Remove a memory item. Performs a soft delete (moves to archive). ' +
      'Use this to clean up outdated, incorrect, or irrelevant memories.',
    input_schema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: {
          type: 'string',
          description: 'The memory item ID to forget (from memory_search results).',
        },
        reason: {
          type: 'string',
          description: 'Why this memory is being removed (logged for audit).',
        },
      },
    },
    handler: async (input: Record<string, unknown>): Promise<unknown> => {
      const id = input.id as string;
      const reason = (input.reason as string) ?? 'No reason provided';

      const deleted = await memoryManager.forgetItem(id, reason);

      return {
        success: deleted,
        message: deleted
          ? `Forgot memory "${id}".`
          : `Memory item "${id}" not found.`,
      };
    },
  };
}
