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
import type { MemoryItemType, SourceType } from '../memory/memory-types.js';

const VALID_TYPES: MemoryItemType[] = ['profile', 'event', 'knowledge', 'behavior', 'skill', 'tool'];
const VALID_SOURCE_TYPES: SourceType[] = ['user_instruction', 'agent_analysis', 'tool_output'];

/**
 * Creates the three memory tool definitions wired to a MemoryManager instance.
 */
export function createMemoryTools(
  memoryManager: MemoryManager,
  validationPipeline: ValidationPipeline,
): CustomToolDefinition[] {
  const structuredMemory = memoryManager.structuredMemory;

  return [
    createMemorySaveTool(structuredMemory, validationPipeline),
    createMemorySearchTool(memoryManager),
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

function createMemorySearchTool(memoryManager: MemoryManager): CustomToolDefinition {
  return {
    name: 'memory_search',
    description:
      'Search long-term memory for relevant facts. Returns results ranked by relevance, recency, and trust. ' +
      'Use this before making assumptions — check if you already know something.',
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
      },
    },
    handler: async (input: Record<string, unknown>): Promise<unknown> => {
      const query = input.query as string;
      const limit = (input.limit as number) ?? 5;
      const typeFilter = input.type as MemoryItemType | undefined;
      const minScore = input.min_score as number | undefined;

      let scores = await memoryManager.searchMemory(query, limit * 2); // fetch extra for filtering

      // Apply type filter if specified
      if (typeFilter) {
        const allItems = await memoryManager.structuredMemory.listItems();
        const itemMap = new Map(allItems.map(i => [i.id, i]));
        scores = scores.filter(s => {
          const item = itemMap.get(s.itemId);
          return item && item.type === typeFilter;
        });
      }

      // Apply min_score filter
      if (minScore !== undefined) {
        scores = scores.filter(s => s.score >= minScore);
      }

      // Trim to limit
      scores = scores.slice(0, limit);

      if (scores.length === 0) {
        return { results: [], message: 'No matching memories found.' };
      }

      // Fetch full items for results
      const allItems = await memoryManager.structuredMemory.listItems();
      const itemMap = new Map(allItems.map(i => [i.id, i]));

      const results = scores.map(s => {
        const item = itemMap.get(s.itemId);
        return item
          ? {
              id: item.id,
              content: item.summary,
              type: item.type,
              tags: item.tags,
              score: Number(s.score.toFixed(3)),
              created: item.created_at,
            }
          : null;
      }).filter(Boolean);

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
