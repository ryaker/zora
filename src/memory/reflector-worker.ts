/**
 * ReflectorWorker — Condenses session observations into cross-session memory.
 *
 * When session-tier observations exceed their token budget, the Reflector:
 *   1. Extracts persistent facts worth remembering across sessions
 *   2. Condenses remaining observations (merge related, drop stale)
 *   3. Feeds extracted facts into StructuredMemory as new MemoryItems
 *
 * Also runs on session end to capture any remaining valuable observations.
 */

import type { MemoryManager } from './memory-manager.js';
import { ObservationStore, type ObservationBlock } from './observation-store.js';
import type { CompressFn } from './observer-worker.js';
import type { MemoryItemType } from './memory-types.js';
import { estimateTokens } from './token-estimator.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('reflector-worker');

const VALID_TYPES: MemoryItemType[] = ['profile', 'event', 'knowledge', 'behavior', 'skill', 'tool'];

interface ExtractedFact {
  summary: string;
  type: string;
  tags: string[];
}

export interface ReflectionResult {
  itemsCreated: number;
  condensedObservations: string;
  condensedTokens: number;
}

/**
 * Build the reflector prompt.
 */
function buildReflectorPrompt(observations: string): string {
  return `You are a memory reflector. Review these session observations and produce TWO sections:

## SECTION 1: PERSISTENT FACTS
Extract facts worth remembering across sessions. These are things like:
- User preferences, habits, or identity facts
- Project decisions that affect future work
- Important configurations, paths, or environment details
- Skills or procedures the agent learned
- Recurring patterns or behaviors

Output as a JSON array on a SINGLE line after the header "FACTS:":
FACTS: [{"summary": "...", "type": "knowledge|behavior|profile|event|skill|tool", "tags": ["tag1", "tag2"]}]

If no persistent facts, output: FACTS: []

## SECTION 2: CONDENSED OBSERVATIONS
Condense the remaining observations:
- Merge related entries
- Drop anything no longer relevant (completed tasks, resolved errors)
- Keep CRITICAL items verbatim
- Preserve exact names, paths, IDs

Output the condensed observations in the same dated format after the header "CONDENSED:"

Observations to reflect on:
${observations}`;
}

export class ReflectorWorker {
  private readonly _compressFn: CompressFn;
  private readonly _memoryManager: MemoryManager;

  constructor(compressFn: CompressFn, memoryManager: MemoryManager) {
    this._compressFn = compressFn;
    this._memoryManager = memoryManager;
  }

  /**
   * Reflect on session observations: extract persistent facts and condense.
   *
   * @param observations The session-tier observation text to reflect on
   * @param sessionId The session ID (used as source for created items)
   */
  async reflect(observations: string, sessionId: string): Promise<ReflectionResult> {
    if (!observations.trim()) {
      return { itemsCreated: 0, condensedObservations: '', condensedTokens: 0 };
    }

    const prompt = buildReflectorPrompt(observations);

    let response: string;
    try {
      response = await this._compressFn(prompt);
    } catch (err) {
      log.error({ err }, 'Reflector compression call failed');
      // On failure, return observations unchanged
      return {
        itemsCreated: 0,
        condensedObservations: observations,
        condensedTokens: estimateTokens(observations),
      };
    }

    // Parse the response into facts + condensed observations
    const { facts, condensed } = this._parseReflectorResponse(response);

    // Create memory items from extracted facts
    let itemsCreated = 0;
    for (const fact of facts) {
      try {
        const itemType = VALID_TYPES.includes(fact.type as MemoryItemType)
          ? (fact.type as MemoryItemType)
          : 'knowledge';

        await this._memoryManager.structuredMemory.createItem({
          type: itemType,
          summary: fact.summary,
          source: sessionId,
          source_type: 'agent_analysis',
          tags: fact.tags,
          category: `${itemType}/reflected`,
        });
        itemsCreated++;
      } catch (err) {
        log.debug({ err, fact: fact.summary }, 'Failed to create reflected memory item');
      }
    }

    // Invalidate memory index since we added items
    if (itemsCreated > 0) {
      this._memoryManager.invalidateIndex();
    }

    const condensedTokens = estimateTokens(condensed);

    log.info(
      {
        sessionId,
        factsExtracted: facts.length,
        itemsCreated,
        inputTokens: estimateTokens(observations),
        condensedTokens,
      },
      'Reflection complete',
    );

    return { itemsCreated, condensedObservations: condensed, condensedTokens };
  }

  /**
   * Run reflection and persist condensed observations as a cross-session block.
   */
  async reflectAndPersist(
    observations: string,
    sessionId: string,
    store: ObservationStore,
  ): Promise<ReflectionResult> {
    const result = await this.reflect(observations, sessionId);

    if (result.condensedObservations.trim()) {
      const block: ObservationBlock = {
        id: ObservationStore.generateId(),
        sessionId,
        createdAt: new Date().toISOString(),
        tier: 'cross-session',
        observations: result.condensedObservations,
        sourceMessageRange: [0, 0], // Not applicable for cross-session
        estimatedTokens: result.condensedTokens,
      };
      await store.append(block);
    }

    return result;
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Parse the reflector's response into facts and condensed observations.
   * Handles malformed responses gracefully.
   */
  private _parseReflectorResponse(response: string): { facts: ExtractedFact[]; condensed: string } {
    let facts: ExtractedFact[] = [];
    let condensed = '';

    // Extract FACTS line
    const factsMatch = response.match(/FACTS:\s*(\[[\s\S]*?\])\s*(?:\n|CONDENSED:|$)/);
    if (factsMatch?.[1]) {
      try {
        const parsed = JSON.parse(factsMatch[1]);
        if (Array.isArray(parsed)) {
          facts = parsed.filter(
            (f): f is ExtractedFact =>
              typeof f === 'object' &&
              f !== null &&
              typeof f.summary === 'string' &&
              f.summary.length > 0,
          ).map(f => ({
            summary: f.summary,
            type: typeof f.type === 'string' ? f.type : 'knowledge',
            tags: Array.isArray(f.tags) ? f.tags.filter((t: unknown) => typeof t === 'string') : [],
          }));
        }
      } catch {
        log.debug('Failed to parse FACTS JSON from reflector response');
      }
    }

    // Extract CONDENSED section (everything after "CONDENSED:")
    const condensedMatch = response.match(/CONDENSED:\s*([\s\S]*)/);
    if (condensedMatch?.[1]) {
      condensed = condensedMatch[1].trim();
    } else {
      // Fallback: if no CONDENSED marker, use the part after FACTS
      const afterFacts = response.replace(/FACTS:.*?\]/s, '').trim();
      if (afterFacts) {
        condensed = afterFacts;
      }
    }

    return { facts, condensed };
  }
}
