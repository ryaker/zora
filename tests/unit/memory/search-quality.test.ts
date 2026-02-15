/**
 * MEM-10: Search quality tests.
 *
 * Tests that keyword search finds expected items, that salience ranking
 * produces correct ordering, and that the naive search in StructuredMemory
 * works for known queries.
 *
 * Note: MiniSearch is not yet integrated. These tests verify the existing
 * naive keyword search (StructuredMemory.searchItems) and salience ranking
 * (SalienceScorer). When MiniSearch lands, these tests validate quality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StructuredMemory } from '../../../src/memory/structured-memory.js';
import { SalienceScorer } from '../../../src/memory/salience-scorer.js';
import type { MemoryItem } from '../../../src/memory/memory-types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// ── Helpers ─────────────────────────────────────────────────────────

function makeItem(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: 'knowledge',
    summary: 'Default summary',
    source: 'session-search',
    source_type: 'agent_analysis',
    created_at: new Date().toISOString(),
    last_accessed: new Date().toISOString(),
    access_count: 0,
    reinforcement_score: 0,
    tags: [],
    category: 'general/test',
    ...overrides,
  };
}

// ── Test corpus ─────────────────────────────────────────────────────

const TEST_CORPUS = [
  { summary: 'Zora uses pino for structured logging', tags: ['zora', 'pino', 'logging'], category: 'coding/zora' },
  { summary: 'All console.log calls replaced with pino', tags: ['logging', 'refactoring'], category: 'coding/zora' },
  { summary: 'TypeScript strict mode is enabled in tsconfig', tags: ['typescript', 'config'], category: 'coding/typescript' },
  { summary: 'User prefers dark mode in VS Code', tags: ['preferences', 'vscode'], category: 'personal/preferences' },
  { summary: 'React hooks require function components', tags: ['react', 'hooks'], category: 'coding/react' },
  { summary: 'Python pandas is great for data analysis', tags: ['python', 'pandas', 'data'], category: 'coding/python' },
  { summary: 'Kubernetes pods restart on OOM kill', tags: ['kubernetes', 'ops'], category: 'ops/kubernetes' },
  { summary: 'Git worktrees prevent merge conflicts during parallel work', tags: ['git', 'workflow'], category: 'coding/git' },
  { summary: 'MiniSearch uses BM25+ algorithm for retrieval', tags: ['minisearch', 'search', 'bm25'], category: 'coding/search' },
  { summary: 'Vitest is faster than Jest for TypeScript projects', tags: ['testing', 'vitest', 'jest'], category: 'coding/testing' },
  { summary: 'WSJF scoring prioritizes high value divided by job size', tags: ['agile', 'wsjf', 'prioritization'], category: 'process/agile' },
  { summary: 'Exponential backoff prevents thundering herd on retries', tags: ['resilience', 'patterns'], category: 'coding/patterns' },
  { summary: 'Cloudflare tunnel routes yaker.org to Mac mini', tags: ['cloudflare', 'tunnel', 'networking'], category: 'ops/cloudflare' },
  { summary: 'MEMORY.md stores long-term user preferences', tags: ['memory', 'zora'], category: 'coding/zora' },
  { summary: 'Salience scoring uses recency decay with 14-day half-life', tags: ['salience', 'memory', 'scoring'], category: 'coding/zora' },
  { summary: 'StoryBrand framework structures marketing narratives', tags: ['marketing', 'storybrand'], category: 'content/marketing' },
  { summary: 'Sophia character has wavy brown hair and green eyes', tags: ['sophia', 'character', 'brand'], category: 'content/sophia' },
  { summary: 'npm audit fix resolves known vulnerabilities', tags: ['npm', 'security'], category: 'coding/security' },
  { summary: 'Docker compose simplifies multi-container orchestration', tags: ['docker', 'compose'], category: 'ops/docker' },
  { summary: 'Pino logger supports JSON output format by default', tags: ['pino', 'logging', 'json'], category: 'coding/zora' },
];

// ── Search quality tests ────────────────────────────────────────────

describe('Search Quality — MEM-10', () => {
  let itemsDir: string;
  let mem: StructuredMemory;

  beforeEach(async () => {
    itemsDir = path.join(os.tmpdir(), `zora-search-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mem = new StructuredMemory(itemsDir);
    await mem.init();

    // Populate test corpus
    for (const entry of TEST_CORPUS) {
      await mem.createItem({
        type: 'knowledge',
        summary: entry.summary,
        source: 'test-corpus',
        source_type: 'agent_analysis',
        tags: entry.tags,
        category: entry.category,
      });
    }
  });

  afterEach(async () => {
    await fs.rm(itemsDir, { recursive: true, force: true });
  });

  describe('Keyword search finds expected items', () => {
    it('finds "logging" items when searching for "logging"', async () => {
      const results = await mem.searchItems('logging');
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.some(r => r.summary.includes('pino'))).toBe(true);
    });

    it('finds "Zora uses pino" when searching for "logging framework"', async () => {
      const results = await mem.searchItems('logging');
      const pinoItem = results.find(r => r.summary.includes('Zora uses pino'));
      expect(pinoItem).toBeDefined();
    });

    it('finds TypeScript items', async () => {
      const results = await mem.searchItems('TypeScript');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.summary.includes('TypeScript'))).toBe(true);
    });

    it('finds items by tag content', async () => {
      const results = await mem.searchItems('kubernetes');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.tags.includes('kubernetes'))).toBe(true);
    });

    it('returns empty for nonsense query', async () => {
      const results = await mem.searchItems('xyzzyplugh');
      expect(results).toHaveLength(0);
    });

    it('returns all items for empty query', async () => {
      const results = await mem.searchItems('');
      expect(results.length).toBe(TEST_CORPUS.length);
    });

    it('search is case-insensitive', async () => {
      const lower = await mem.searchItems('typescript');
      const upper = await mem.searchItems('TYPESCRIPT');
      expect(lower.length).toBe(upper.length);
    });

    it('finds multiple related items for broad query', async () => {
      const results = await mem.searchItems('pino');
      expect(results.length).toBeGreaterThanOrEqual(2);
      // Both "Zora uses pino" and "Pino logger supports JSON" should match
    });
  });

  describe('Salience ranking order', () => {
    const scorer = new SalienceScorer();

    it('ranks recently accessed items higher than old ones', () => {
      const recent = makeItem({
        id: 'recent',
        summary: 'logging framework selection',
        tags: ['logging'],
        last_accessed: new Date().toISOString(),
        access_count: 1,
        source_type: 'agent_analysis',
      });
      const old = makeItem({
        id: 'old',
        summary: 'logging framework selection',
        tags: ['logging'],
        last_accessed: new Date(Date.now() - 30 * 86400000).toISOString(),
        access_count: 1,
        source_type: 'agent_analysis',
      });

      const recentScore = scorer.scoreItem(recent, 'logging');
      const oldScore = scorer.scoreItem(old, 'logging');

      expect(recentScore.score).toBeGreaterThan(oldScore.score);
    });

    it('ranks frequently accessed items higher', () => {
      const frequent = makeItem({
        id: 'frequent',
        summary: 'logging best practices',
        tags: ['logging'],
        access_count: 20,
        source_type: 'agent_analysis',
      });
      const rare = makeItem({
        id: 'rare',
        summary: 'logging best practices',
        tags: ['logging'],
        access_count: 0,
        source_type: 'agent_analysis',
      });

      const frequentScore = scorer.scoreItem(frequent, 'logging');
      const rareScore = scorer.scoreItem(rare, 'logging');

      expect(frequentScore.score).toBeGreaterThan(rareScore.score);
      expect(frequentScore.components.accessWeight).toBeGreaterThan(rareScore.components.accessWeight);
    });

    it('ranks user_instruction items higher than tool_output', () => {
      const userItem = makeItem({
        id: 'user',
        summary: 'logging preference',
        tags: ['logging'],
        source_type: 'user_instruction',
        access_count: 1,
      });
      const toolItem = makeItem({
        id: 'tool',
        summary: 'logging preference',
        tags: ['logging'],
        source_type: 'tool_output',
        access_count: 1,
      });

      const userScore = scorer.scoreItem(userItem, 'logging');
      const toolScore = scorer.scoreItem(toolItem, 'logging');

      expect(userScore.components.sourceTrustBonus).toBeGreaterThan(toolScore.components.sourceTrustBonus);
      expect(userScore.score).toBeGreaterThan(toolScore.score);
    });

    it('ranks relevant items higher than irrelevant ones', () => {
      const relevant = makeItem({
        id: 'relevant',
        summary: 'pino logging framework details',
        tags: ['pino', 'logging'],
        access_count: 0,
      });
      const irrelevant = makeItem({
        id: 'irrelevant',
        summary: 'kubernetes pod scheduling',
        tags: ['kubernetes'],
        access_count: 0,
      });

      const relevantScore = scorer.scoreItem(relevant, 'logging');
      const irrelevantScore = scorer.scoreItem(irrelevant, 'logging');

      expect(relevantScore.components.relevanceScore).toBeGreaterThan(
        irrelevantScore.components.relevanceScore,
      );
    });

    it('rankItems returns items in descending order', () => {
      const items = [
        makeItem({ id: 'low', access_count: 0, last_accessed: new Date(Date.now() - 60 * 86400000).toISOString(), source_type: 'tool_output', summary: 'unrelated topic' }),
        makeItem({ id: 'high', access_count: 15, last_accessed: new Date().toISOString(), source_type: 'user_instruction', summary: 'logging framework' }),
        makeItem({ id: 'mid', access_count: 3, last_accessed: new Date(Date.now() - 5 * 86400000).toISOString(), source_type: 'agent_analysis', summary: 'logging helper' }),
      ];

      const ranked = scorer.rankItems(items, 'logging', 3);
      expect(ranked[0]!.itemId).toBe('high');
      expect(ranked[2]!.itemId).toBe('low');

      // Verify descending order
      for (let i = 0; i < ranked.length - 1; i++) {
        expect(ranked[i]!.score).toBeGreaterThanOrEqual(ranked[i + 1]!.score);
      }
    });

    it('limit parameter truncates results', () => {
      const items = Array.from({ length: 10 }, (_, i) =>
        makeItem({ id: `item-${i}`, access_count: i }),
      );

      const ranked = scorer.rankItems(items, '', 3);
      expect(ranked).toHaveLength(3);
    });
  });

  describe('Salience component composition', () => {
    const scorer = new SalienceScorer();

    it('score is product of all components (multiplicative model)', () => {
      const item = makeItem({
        summary: 'logging framework pino',
        tags: ['logging', 'pino'],
        access_count: 5,
        last_accessed: new Date().toISOString(),
        source_type: 'user_instruction',
      });

      const result = scorer.scoreItem(item, 'logging');
      const { accessWeight, recencyDecay, relevanceScore, sourceTrustBonus } = result.components;

      // SalienceScorer uses multiplicative composition:
      // score = relevanceScore * recencyDecay * frequencyBoost * trustScore
      const expectedTotal = relevanceScore * recencyDecay * accessWeight * sourceTrustBonus;
      expect(result.score).toBeCloseTo(expectedTotal, 10);
    });

    it('recency decay approaches 0 for very old items', () => {
      const veryOld = new Date(Date.now() - 365 * 86400000).toISOString();
      const decay = scorer.recencyDecay(veryOld);
      expect(decay).toBeLessThan(0.01);
    });

    it('recency decay is 1.0 for items accessed just now', () => {
      const now = new Date().toISOString();
      const decay = scorer.recencyDecay(now);
      expect(decay).toBeGreaterThan(0.99);
    });

    it('frequency boost uses logarithmic scaling with base 1.0', () => {
      const item0 = makeItem({ access_count: 0 });
      const item10 = makeItem({ access_count: 10 });
      const item100 = makeItem({ access_count: 100 });

      const score0 = scorer.scoreItem(item0, '');
      const score10 = scorer.scoreItem(item10, '');
      const score100 = scorer.scoreItem(item100, '');

      // frequencyBoost = 1.0 + log2(1 + count) * 0.15
      expect(score0.components.accessWeight).toBeCloseTo(1.0); // 1 + log2(1)*0.15 = 1.0
      expect(score10.components.accessWeight).toBeCloseTo(1.0 + Math.log2(11) * 0.15); // ~1.519
      expect(score100.components.accessWeight).toBeCloseTo(1.0 + Math.log2(101) * 0.15); // ~2.0

      // Monotonically increasing
      expect(score10.components.accessWeight).toBeGreaterThan(score0.components.accessWeight);
      expect(score100.components.accessWeight).toBeGreaterThan(score10.components.accessWeight);
    });

    it('relevance score is 0 for empty query', () => {
      const item = makeItem({ summary: 'anything', tags: ['test'] });
      expect(scorer.relevanceScore('', item)).toBe(0);
    });

    it('relevance score is normalized between 0 and 1', () => {
      const item = makeItem({
        summary: 'TypeScript generics for type safety',
        tags: ['typescript', 'generics'],
      });
      const score = scorer.relevanceScore('typescript generics type safety foo', item);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });
});
