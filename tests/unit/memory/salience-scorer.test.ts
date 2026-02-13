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

  it('computes access weight as count * 0.3', () => {
    const item = makeItem({ access_count: 10 });
    const score = scorer.scoreItem(item, '');
    expect(score.components.accessWeight).toBeCloseTo(3.0);
  });

  it('computes recency decay — recent item near 1.0', () => {
    const item = makeItem({ last_accessed: new Date().toISOString() });
    const decay = scorer.recencyDecay(item.last_accessed);
    expect(decay).toBeGreaterThan(0.99);
    expect(decay).toBeLessThanOrEqual(1.0);
  });

  it('computes recency decay — 7-day-old item near 0.5', () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const decay = scorer.recencyDecay(sevenDaysAgo);
    expect(decay).toBeGreaterThan(0.45);
    expect(decay).toBeLessThan(0.55);
  });

  it('computes recency decay — 14-day-old item near 0.25', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const decay = scorer.recencyDecay(twoWeeksAgo);
    expect(decay).toBeGreaterThan(0.2);
    expect(decay).toBeLessThan(0.3);
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

  it('returns correct source trust bonuses', () => {
    expect(scorer.sourceTrustBonus('user_instruction')).toBe(0.2);
    expect(scorer.sourceTrustBonus('agent_analysis')).toBe(0.1);
    expect(scorer.sourceTrustBonus('tool_output')).toBe(0.0);
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
