/**
 * ExtractionPipeline — Schema-guided memory extraction.
 *
 * Spec SS5.4 "Proactive Memory Extraction Pipeline":
 * Extracts structured MemoryItems from conversation messages,
 * validates against the schema, and deduplicates against existing items.
 */

import type { MemoryItem, MemoryItemType, SourceType, ExtractionResult } from './memory-types.js';

const VALID_TYPES: MemoryItemType[] = ['profile', 'event', 'knowledge', 'behavior', 'skill', 'tool'];
const VALID_SOURCE_TYPES: SourceType[] = ['user_instruction', 'agent_analysis', 'tool_output'];
const MAX_RETRIES = 2;
const DEDUP_THRESHOLD = 0.8;

export class ExtractionPipeline {
  private readonly _extractFn: (prompt: string) => Promise<string>;

  constructor(extractFn: (prompt: string) => Promise<string>) {
    this._extractFn = extractFn;
  }

  async extract(messages: string[], existingCategories: string[]): Promise<ExtractionResult> {
    const errors: string[] = [];
    let retries = 0;
    let lastErrors: string[] = [];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const prompt = this._buildPrompt(messages, existingCategories, lastErrors);
      let raw: string;

      try {
        raw = await this._extractFn(prompt);
      } catch (err) {
        errors.push(`Extraction call failed: ${String(err)}`);
        retries++;
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const parseErr = 'Response is not valid JSON';
        errors.push(parseErr);
        lastErrors = [parseErr];
        retries++;
        continue;
      }

      if (!Array.isArray(parsed)) {
        const arrErr = 'Response is not a JSON array';
        errors.push(arrErr);
        lastErrors = [arrErr];
        retries++;
        continue;
      }

      const validItems: MemoryItem[] = [];
      const itemErrors: string[] = [];

      for (const raw of parsed) {
        const result = this.validateItem(raw);
        if (result.valid) {
          validItems.push(raw as MemoryItem);
        } else {
          itemErrors.push(...result.errors);
        }
      }

      if (itemErrors.length > 0 && validItems.length === 0 && attempt < MAX_RETRIES) {
        errors.push(...itemErrors);
        lastErrors = itemErrors;
        retries++;
        continue;
      }

      errors.push(...itemErrors);
      return { items: validItems, errors, retries };
    }

    return { items: [], errors, retries };
  }

  validateItem(item: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (typeof item !== 'object' || item === null) {
      return { valid: false, errors: ['Item is not an object'] };
    }

    const obj = item as Record<string, unknown>;

    const stringFields = ['id', 'summary', 'source', 'created_at', 'last_accessed', 'category'] as const;
    for (const field of stringFields) {
      if (typeof obj[field] !== 'string' || (obj[field] as string).length === 0) {
        errors.push(`Missing or invalid field: ${field}`);
      }
    }

    if (typeof obj['type'] !== 'string' || !VALID_TYPES.includes(obj['type'] as MemoryItemType)) {
      errors.push(`Invalid type: ${String(obj['type'])}. Must be one of: ${VALID_TYPES.join(', ')}`);
    }

    if (typeof obj['source_type'] !== 'string' || !VALID_SOURCE_TYPES.includes(obj['source_type'] as SourceType)) {
      errors.push(`Invalid source_type: ${String(obj['source_type'])}. Must be one of: ${VALID_SOURCE_TYPES.join(', ')}`);
    }

    if (typeof obj['access_count'] !== 'number') {
      errors.push('Missing or invalid field: access_count');
    }

    if (typeof obj['reinforcement_score'] !== 'number') {
      errors.push('Missing or invalid field: reinforcement_score');
    }

    if (!Array.isArray(obj['tags'])) {
      errors.push('Missing or invalid field: tags (must be array)');
    }

    return { valid: errors.length === 0, errors };
  }

  deduplicateItems(newItems: MemoryItem[], existingItems: MemoryItem[]): MemoryItem[] {
    return newItems.filter(newItem => {
      const newWords = this._wordSet(newItem.summary);
      return !existingItems.some(existing => {
        const existingWords = this._wordSet(existing.summary);
        return this._jaccardSimilarity(newWords, existingWords) > DEDUP_THRESHOLD;
      });
    });
  }

  // ── Private helpers ──────────────────────────────────────────────

  private _buildPrompt(
    messages: string[],
    existingCategories: string[],
    previousErrors: string[],
  ): string {
    const conversationBlock = messages.map((m, i) => `[${i + 1}] ${m}`).join('\n');
    const categoriesBlock = existingCategories.length > 0
      ? `Existing categories: ${existingCategories.join(', ')}`
      : 'No existing categories yet.';

    let errorBlock = '';
    if (previousErrors.length > 0) {
      errorBlock = `\nPrevious attempt had these errors. Please fix them:\n${previousErrors.join('\n')}\n`;
    }

    return `Extract structured memory items from the following conversation.
Return a JSON array of objects with these required fields:
- id (string): unique identifier
- type (string): one of: profile, event, knowledge, behavior, skill, tool
- summary (string): concise description
- source (string): session or job ID
- source_type (string): one of: user_instruction, agent_analysis, tool_output
- created_at (string): ISO 8601 timestamp
- last_accessed (string): ISO 8601 timestamp
- access_count (number): initial 0
- reinforcement_score (number): initial 0
- tags (string[]): relevant tags
- category (string): e.g. "coding/my-web-app"

${categoriesBlock}
${errorBlock}
Conversation:
${conversationBlock}

Respond with ONLY a JSON array. No markdown fences, no explanation.`;
  }

  private _wordSet(text: string): Set<string> {
    return new Set(
      text.toLowerCase().split(/\W+/).filter(w => w.length > 0),
    );
  }

  private _jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1;
    let intersection = 0;
    for (const word of a) {
      if (b.has(word)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }
}
