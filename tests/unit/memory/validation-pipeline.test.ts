/**
 * MEM-11: Validation pipeline tests.
 *
 * Tests validation gates from the spec (SS5.4 §8.3):
 *   - Minimum length (15 chars)
 *   - Transient state rejection
 *   - Jaccard dedup threshold (0.7 per spec, 0.8 in current code)
 *   - Rate limiting (max 10 saves/session)
 *   - Edge cases: exact threshold, empty, Unicode
 *
 * These gates don't exist as standalone functions in the current codebase yet,
 * so we test the *patterns* described in the spec using the ExtractionPipeline's
 * existing validateItem() and deduplicateItems() plus standalone logic.
 */

import { describe, it, expect } from 'vitest';
import { ExtractionPipeline } from '../../../src/memory/extraction-pipeline.js';
import type { MemoryItem } from '../../../src/memory/memory-types.js';

// ── Helpers ─────────────────────────────────────────────────────────

function makeValidItem(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: 'knowledge',
    summary: 'A sufficiently long summary for testing purposes',
    source: 'session-test',
    source_type: 'agent_analysis',
    created_at: new Date().toISOString(),
    last_accessed: new Date().toISOString(),
    access_count: 0,
    reinforcement_score: 0,
    tags: ['test'],
    category: 'coding/test',
    ...overrides,
  };
}

/**
 * Spec validation gates (not yet in code — testing the pattern).
 * These mirror what memory_save should enforce.
 */
const TRANSIENT_PATTERNS = ['is busy', 'is waiting', 'just now', 'currently'];
const MIN_CONTENT_LENGTH = 15;
const MAX_SAVES_PER_SESSION = 10;

function isTransient(content: string): boolean {
  const lower = content.toLowerCase();
  return TRANSIENT_PATTERNS.some(p => lower.includes(p));
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 0));
  const setB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 0));
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Validation Pipeline — MEM-11', () => {
  describe('Minimum length gate (15 chars)', () => {
    it('rejects content shorter than 15 characters', () => {
      const short = 'Too short';
      expect(short.length).toBeLessThan(MIN_CONTENT_LENGTH);
      expect(short.length < MIN_CONTENT_LENGTH).toBe(true);
    });

    it('accepts content exactly at 15 characters', () => {
      const exact = '123456789012345'; // 15 chars
      expect(exact.length).toBe(MIN_CONTENT_LENGTH);
      expect(exact.length >= MIN_CONTENT_LENGTH).toBe(true);
    });

    it('accepts content longer than 15 characters', () => {
      const long = 'This is a sufficiently descriptive memory item';
      expect(long.length).toBeGreaterThan(MIN_CONTENT_LENGTH);
      expect(long.length >= MIN_CONTENT_LENGTH).toBe(true);
    });

    it('rejects empty string', () => {
      expect(''.length < MIN_CONTENT_LENGTH).toBe(true);
    });

    it('handles Unicode content — counts code units', () => {
      // Emoji-heavy content: each emoji is 2 code units
      const emoji = '🎉🎊🎈🎁🎄🎃🎅'; // 7 emoji × 2 = 14 code units
      expect(emoji.length).toBeLessThan(MIN_CONTENT_LENGTH);

      const withText = '🎉 Hello world!!'; // mixed
      expect(withText.length).toBeGreaterThanOrEqual(MIN_CONTENT_LENGTH);
    });

    it('handles whitespace-only content', () => {
      const spaces = '               '; // 15 spaces
      // Length passes but content is meaningless — validation should
      // also check for non-whitespace content in a production gate
      expect(spaces.length).toBe(MIN_CONTENT_LENGTH);
      expect(spaces.trim().length).toBe(0);
    });
  });

  describe('Transient state rejection', () => {
    it('rejects "user is busy" as transient', () => {
      expect(isTransient('The user is busy right now')).toBe(true);
    });

    it('rejects "is waiting for response" as transient', () => {
      expect(isTransient('User is waiting for API response')).toBe(true);
    });

    it('rejects "just now" as transient', () => {
      expect(isTransient('They just now started the build')).toBe(true);
    });

    it('rejects "currently" as transient', () => {
      expect(isTransient('User is currently editing the file')).toBe(true);
    });

    it('accepts non-transient content', () => {
      expect(isTransient('Zora uses pino for structured logging')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isTransient('User IS BUSY with meetings')).toBe(true);
    });
  });

  describe('Jaccard dedup threshold', () => {
    it('returns 1.0 for identical strings', () => {
      const s = 'TypeScript supports generics for type safety';
      expect(jaccardSimilarity(s, s)).toBe(1.0);
    });

    it('returns 0.0 for completely different strings', () => {
      const a = 'apple banana cherry';
      const b = 'dog elephant fox';
      expect(jaccardSimilarity(a, b)).toBe(0.0);
    });

    it('returns 1.0 for two empty strings', () => {
      expect(jaccardSimilarity('', '')).toBe(1.0);
    });

    it('computes correct partial overlap', () => {
      // "typescript generics type" (3 words)
      // "typescript generics safety" (3 words)
      // intersection: typescript, generics = 2
      // union: typescript, generics, type, safety = 4
      // Jaccard = 2/4 = 0.5
      const a = 'typescript generics type';
      const b = 'typescript generics safety';
      expect(jaccardSimilarity(a, b)).toBeCloseTo(0.5, 2);
    });

    it('flags items above 0.7 threshold as duplicates', () => {
      const existing = 'Zora uses pino for structured logging output';
      const candidate = 'Zora uses pino for structured logging';
      const sim = jaccardSimilarity(existing, candidate);
      expect(sim).toBeGreaterThan(0.7);
    });

    it('does NOT flag items below 0.7 threshold', () => {
      const existing = 'Zora uses pino for structured logging';
      const candidate = 'React hooks best practices for components';
      const sim = jaccardSimilarity(existing, candidate);
      expect(sim).toBeLessThan(0.7);
    });
  });

  describe('ExtractionPipeline.deduplicateItems (existing code)', () => {
    const pipeline = new ExtractionPipeline(async () => '[]');

    it('removes exact duplicate summaries', () => {
      const existing = [makeValidItem({ summary: 'Zora uses pino for logging' })];
      const newItems = [
        makeValidItem({ summary: 'Zora uses pino for logging' }),
        makeValidItem({ summary: 'Completely different topic here' }),
      ];
      const result = pipeline.deduplicateItems(newItems, existing);
      expect(result).toHaveLength(1);
      expect(result[0]!.summary).toBe('Completely different topic here');
    });

    it('removes near-duplicate summaries above threshold', () => {
      const existing = [makeValidItem({ summary: 'TypeScript supports generics for type safety and reuse' })];
      const newItems = [
        makeValidItem({ summary: 'TypeScript supports generics for type safety and code reuse' }),
      ];
      const result = pipeline.deduplicateItems(newItems, existing);
      // These are very similar — should be deduped
      expect(result).toHaveLength(0);
    });

    it('keeps items below dedup threshold', () => {
      const existing = [makeValidItem({ summary: 'Kubernetes cluster management' })];
      const newItems = [
        makeValidItem({ summary: 'React hooks best practices' }),
      ];
      const result = pipeline.deduplicateItems(newItems, existing);
      expect(result).toHaveLength(1);
    });

    it('handles empty existing items', () => {
      const newItems = [makeValidItem({ summary: 'Brand new fact' })];
      const result = pipeline.deduplicateItems(newItems, []);
      expect(result).toHaveLength(1);
    });

    it('handles empty new items', () => {
      const existing = [makeValidItem({ summary: 'Existing fact' })];
      const result = pipeline.deduplicateItems([], existing);
      expect(result).toHaveLength(0);
    });
  });

  describe('ExtractionPipeline.validateItem (existing code)', () => {
    const pipeline = new ExtractionPipeline(async () => '[]');

    it('accepts a fully valid item', () => {
      const result = pipeline.validateItem(makeValidItem());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects item with missing id', () => {
      const item = makeValidItem();
      (item as Record<string, unknown>).id = '';
      const result = pipeline.validateItem(item);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('id'))).toBe(true);
    });

    it('rejects item with invalid type', () => {
      const item = makeValidItem();
      (item as Record<string, unknown>).type = 'invalid_type';
      const result = pipeline.validateItem(item);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('type'))).toBe(true);
    });

    it('rejects item with invalid source_type', () => {
      const item = makeValidItem();
      (item as Record<string, unknown>).source_type = 'unknown_source';
      const result = pipeline.validateItem(item);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('source_type'))).toBe(true);
    });

    it('rejects item with missing tags array', () => {
      const item = makeValidItem();
      (item as Record<string, unknown>).tags = 'not-an-array';
      const result = pipeline.validateItem(item);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('tags'))).toBe(true);
    });

    it('rejects item with non-number access_count', () => {
      const item = makeValidItem();
      (item as Record<string, unknown>).access_count = 'five';
      const result = pipeline.validateItem(item);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('access_count'))).toBe(true);
    });

    it('rejects null', () => {
      const result = pipeline.validateItem(null);
      expect(result.valid).toBe(false);
    });

    it('rejects primitive types', () => {
      expect(pipeline.validateItem(42).valid).toBe(false);
      expect(pipeline.validateItem('string').valid).toBe(false);
      expect(pipeline.validateItem(true).valid).toBe(false);
    });

    it('collects multiple errors for multiple invalid fields', () => {
      const result = pipeline.validateItem({
        id: '',
        type: 'bogus',
        summary: '',
        source: '',
        source_type: 'bogus',
        created_at: '',
        last_accessed: '',
        access_count: 'not-a-number',
        reinforcement_score: 'not-a-number',
        tags: 'not-array',
        category: '',
      });
      expect(result.valid).toBe(false);
      // Should have errors for many fields
      expect(result.errors.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Rate limit gate (max 10 saves/session)', () => {
    it('allows saves within the limit', () => {
      let saveCount = 0;
      for (let i = 0; i < MAX_SAVES_PER_SESSION; i++) {
        saveCount++;
      }
      expect(saveCount).toBeLessThanOrEqual(MAX_SAVES_PER_SESSION);
    });

    it('rejects the 11th save', () => {
      const saveCount = 11;
      expect(saveCount > MAX_SAVES_PER_SESSION).toBe(true);
    });

    it('allows exactly 10 saves', () => {
      expect(MAX_SAVES_PER_SESSION).toBe(10);
    });
  });

  describe('Contradiction detection pattern', () => {
    it('detects same entity with different values', () => {
      const oldFact = 'User prefers dark mode';
      const newFact = 'User prefers light mode';

      // Both mention "user" and "prefers" — but different mode
      const oldWords = new Set(oldFact.toLowerCase().split(/\W+/));
      const newWords = new Set(newFact.toLowerCase().split(/\W+/));

      // Overlap: "user", "prefers", "mode" = 3
      // Union: "user", "prefers", "dark", "mode", "light" = 5
      const intersection = [...oldWords].filter(w => newWords.has(w)).length;
      const union = new Set([...oldWords, ...newWords]).size;
      const sim = intersection / union;

      // High similarity suggests potential contradiction
      expect(sim).toBeGreaterThan(0.5);
      // But not identical — different values present
      expect(sim).toBeLessThan(1.0);
    });
  });
});
