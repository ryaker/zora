import { describe, it, expect } from 'vitest';
import { SalienceScorer } from '../../../src/memory/salience-scorer.js';
import type { MemoryItem } from '../../../src/memory/memory-types.js';

function makeItem(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 'mem_test_001',
    type: 'knowledge',
    summary: 'TypeScript supports generics for type safety',
    source: 'session-1',
    source_type: 'agent_analysis',
    created_at: new Date().toISOString(),
    last_accessed: new Date().toISOString(),
    access_count: 5,
    reinforcement_score: 0,
    tags: ['typescript', 'generics'],
    category: 'coding/typescript',
    ...overrides,
  };
}

describe('SalienceScorer', () => {
  const scorer = new SalienceScorer();

  it('computes frequency boost with logarithmic scaling', () => {
    const item = makeItem({ access_count: 10 });
    const score = scorer.scoreItem(item, '');
    // frequencyBoost = 1.0 + log2(1 + 10) * 0.15 ≈ 1.519
    expect(score.components.accessWeight).toBeCloseTo(1.519, 2);
  });

  it('computes recency decay — recent item near 1.0', () => {
    const item = makeItem({ last_accessed: new Date().toISOString() });
    const decay = scorer.recencyDecay(item.last_accessed);
    expect(decay).toBeGreaterThan(0.99);
    expect(decay).toBeLessThanOrEqual(1.0);
  });

  it('computes recency decay — 7-day-old item near 0.707 (14-day half-life)', () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const decay = scorer.recencyDecay(sevenDaysAgo);
    // 14-day half-life: at 7 days = sqrt(0.5) ≈ 0.707
    expect(decay).toBeGreaterThan(0.68);
    expect(decay).toBeLessThan(0.73);
  });

  it('computes recency decay — 14-day-old item near 0.5 (14-day half-life)', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const decay = scorer.recencyDecay(twoWeeksAgo);
    // 14-day half-life: at 14 days = 0.5
    expect(decay).toBeGreaterThan(0.45);
    expect(decay).toBeLessThan(0.55);
  });

  it('computes relevance score with keyword overlap', () => {
    const item = makeItem({ summary: 'TypeScript generics for type safety', tags: ['typescript', 'generics'] });
    const score = scorer.relevanceScore('typescript type', item);
    // "typescript" and "type" both appear in the item's text
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('returns 0 relevance for unrelated query', () => {
    const item = makeItem({ summary: 'Python data analysis', tags: ['python'] });
    const score = scorer.relevanceScore('kubernetes deployment', item);
    expect(score).toBe(0);
  });

  it('returns 0 relevance for empty query', () => {
    const item = makeItem();
    const score = scorer.relevanceScore('', item);
    expect(score).toBe(0);
  });

  it('returns correct trust scores (multiplicative)', () => {
    expect(scorer.trustScore('user_instruction')).toBe(1.0);
    expect(scorer.trustScore('agent_analysis')).toBe(0.7);
    expect(scorer.trustScore('tool_output')).toBe(0.3);
    // sourceTrustBonus delegates to trustScore
    expect(scorer.sourceTrustBonus('user_instruction')).toBe(1.0);
  });

  it('ranks items in descending salience order', () => {
    const items: MemoryItem[] = [
      makeItem({ id: 'low', access_count: 0, last_accessed: new Date(Date.now() - 30 * 86400000).toISOString(), source_type: 'tool_output' }),
      makeItem({ id: 'high', access_count: 20, last_accessed: new Date().toISOString(), source_type: 'user_instruction' }),
      makeItem({ id: 'mid', access_count: 5, last_accessed: new Date(Date.now() - 3 * 86400000).toISOString(), source_type: 'agent_analysis' }),
    ];

    const ranked = scorer.rankItems(items, 'typescript', 3);
    expect(ranked).toHaveLength(3);
    expect(ranked[0]!.itemId).toBe('high');
    expect(ranked[2]!.itemId).toBe('low');
  });

  it('respects limit parameter in ranking', () => {
    const items: MemoryItem[] = [
      makeItem({ id: 'a', access_count: 10 }),
      makeItem({ id: 'b', access_count: 5 }),
      makeItem({ id: 'c', access_count: 1 }),
    ];

    const ranked = scorer.rankItems(items, '', 2);
    expect(ranked).toHaveLength(2);
  });
});
