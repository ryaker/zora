import { describe, it, expect, beforeEach } from 'vitest';
import { Router } from '../../../src/orchestrator/router.js';
import { MockProvider } from '../../fixtures/mock-provider.js';
import type { TaskContext } from '../../../src/types.js';

describe('Router', () => {
  let p1: MockProvider;
  let p2: MockProvider;
  let router: Router;

  beforeEach(() => {
    // High rank, Reasoning/Coding, Metered (expensive)
    p1 = new MockProvider({
      name: 'claude',
      rank: 1,
      capabilities: ['reasoning', 'coding', 'creative'],
      costTier: 'metered',
    });

    // Lower rank, Search/Data, Free
    p2 = new MockProvider({
      name: 'gemini',
      rank: 2,
      capabilities: ['search', 'structured-data', 'large-context'],
      costTier: 'free',
    });

    router = new Router({ providers: [p1, p2] });
  });

  function makeTask(overrides: Partial<TaskContext>): TaskContext {
    return {
      jobId: 'j1',
      task: 'task',
      requiredCapabilities: [],
      complexity: 'simple',
      resourceType: 'reasoning',
      systemPrompt: '',
      memoryContext: [],
      history: [],
      ...overrides,
    };
  }

  describe('classifyTask', () => {
    it('classifies search tasks correctly', () => {
      const { complexity, resourceType } = router.classifyTask('research the history of AI');
      expect(resourceType).toBe('search');
      expect(complexity).toBe('moderate');
    });

    it('classifies simple coding tasks correctly', () => {
      const { complexity, resourceType } = router.classifyTask('fix bug');
      expect(resourceType).toBe('coding');
      expect(complexity).toBe('simple');
    });

    it('classifies complex architecting tasks correctly', () => {
      const { complexity, resourceType } = router.classifyTask('architect a new security system');
      expect(resourceType).toBe('reasoning');
      expect(complexity).toBe('complex');
    });

    it('routes analytical code tasks to reasoning, not coding (ORCH-05)', () => {
      // "Analyze how this code performs" should be reasoning, not coding
      const { resourceType } = router.classifyTask('Analyze how this code performs under load');
      expect(resourceType).toBe('reasoning');
    });

    it('routes "explain this code" to reasoning', () => {
      const { resourceType } = router.classifyTask('Explain what this code does and why');
      expect(resourceType).toBe('reasoning');
    });

    it('routes pure coding tasks to coding', () => {
      const { resourceType } = router.classifyTask('implement a function to sort an array');
      expect(resourceType).toBe('coding');
    });

    it('classifies creative tasks correctly', () => {
      const { resourceType } = router.classifyTask('write a blog post about productivity');
      expect(resourceType).toBe('creative');
    });

    it('classifies data tasks correctly', () => {
      const { resourceType } = router.classifyTask('parse this json and extract the values');
      expect(resourceType).toBe('data');
    });

    it('marks multi-domain tasks as complex', () => {
      // Touches reasoning + coding + search → complex
      const { complexity } = router.classifyTask(
        'research best practices, analyze the code, and implement a fix for the bug'
      );
      expect(complexity).toBe('complex');
    });

    it('marks short tasks as simple', () => {
      const { complexity } = router.classifyTask('hello');
      expect(complexity).toBe('simple');
    });
  });

  describe('selectProvider', () => {
    it('respects user rank by default (respect_ranking)', async () => {
      const task = makeTask({ complexity: 'simple', resourceType: 'reasoning' });
      // p1 is rank 1, p2 is rank 2. Even if p2 is free, p1 wins in respect_ranking mode.
      const selected = await router.selectProvider(task);
      expect(selected.name).toBe('claude');
    });

    it('prioritizes cost in optimize_cost mode', async () => {
      router = new Router({ providers: [p1, p2], mode: 'optimize_cost' });
      
      // Task requires capabilities p2 has
      const task = makeTask({ complexity: 'simple', resourceType: 'search' });
      const selected = await router.selectProvider(task);
      expect(selected.name).toBe('gemini'); // Gemini is free, Claude is metered
    });

    it('skips unavailable providers', async () => {
      p1.setAvailable(false);
      const task = makeTask({ complexity: 'simple', resourceType: 'reasoning' });
      
      // p1 is unavailable, but wait — p2 doesn't have 'reasoning'.
      // Let's add reasoning to p2 for this test.
      const p3 = new MockProvider({ name: 'p3', rank: 3, capabilities: ['reasoning'] });
      router = new Router({ providers: [p1, p3] });
      
      const selected = await router.selectProvider(task);
      expect(selected.name).toBe('p3');
    });

    it('respects modelPreference override', async () => {
      const task = makeTask({ modelPreference: 'gemini', resourceType: 'reasoning' });
      // p2 (gemini) doesn't normally have reasoning, but override wins if it exists and is available
      const selected = await router.selectProvider(task);
      expect(selected.name).toBe('gemini');
    });

    it('throws error if no capable provider found', async () => {
      const task = makeTask({ resourceType: 'search' });
      // Remove search capable providers
      router = new Router({ providers: [p1] });

      await expect(router.selectProvider(task)).rejects.toThrow('No available provider found');
    });
  });

  describe('round-robin mode (ORCH-11)', () => {
    it('cycles through providers deterministically', async () => {
      const a = new MockProvider({ name: 'a', rank: 1, capabilities: ['reasoning'] });
      const b = new MockProvider({ name: 'b', rank: 2, capabilities: ['reasoning'] });
      const c = new MockProvider({ name: 'c', rank: 3, capabilities: ['reasoning'] });
      const rr = new Router({ providers: [a, b, c], mode: 'round_robin' });

      const task = makeTask({ resourceType: 'reasoning' });
      const results = [];
      for (let i = 0; i < 7; i++) {
        const selected = await rr.selectProvider(task);
        results.push(selected.name);
      }
      // Should cycle: a, b, c, a, b, c, a
      expect(results).toEqual(['a', 'b', 'c', 'a', 'b', 'c', 'a']);
    });

    it('does not use random selection', async () => {
      const a = new MockProvider({ name: 'a', rank: 1, capabilities: ['reasoning'] });
      const b = new MockProvider({ name: 'b', rank: 2, capabilities: ['reasoning'] });
      const rr = new Router({ providers: [a, b], mode: 'round_robin' });

      const task = makeTask({ resourceType: 'reasoning' });

      // Run 20 times — with random, we'd almost certainly see non-alternating
      const results = [];
      for (let i = 0; i < 20; i++) {
        const selected = await rr.selectProvider(task);
        results.push(selected.name);
      }
      // Every even index should be 'a', every odd should be 'b'
      for (let i = 0; i < 20; i++) {
        expect(results[i]).toBe(i % 2 === 0 ? 'a' : 'b');
      }
    });
  });

  describe('maxCostTier filtering', () => {
    it('filters providers by cost ceiling', async () => {
      const cheap = new MockProvider({
        name: 'haiku',
        rank: 2,
        capabilities: ['reasoning'],
        costTier: 'free',
      });
      const expensive = new MockProvider({
        name: 'opus',
        rank: 1,
        capabilities: ['reasoning'],
        costTier: 'premium',
      });
      const r = new Router({ providers: [expensive, cheap] });

      const task = makeTask({ maxCostTier: 'included', resourceType: 'reasoning' });
      const selected = await r.selectProvider(task);
      expect(selected.name).toBe('haiku');
    });

    it('falls through to all candidates if cost filter eliminates everyone', async () => {
      const expensive = new MockProvider({
        name: 'opus',
        rank: 1,
        capabilities: ['reasoning'],
        costTier: 'premium',
      });
      const r = new Router({ providers: [expensive] });

      const task = makeTask({ maxCostTier: 'free', resourceType: 'reasoning' });
      // Should NOT throw — falls through to unfiltered list
      const selected = await r.selectProvider(task);
      expect(selected.name).toBe('opus');
    });

    it('modelPreference bypasses cost ceiling', async () => {
      const expensive = new MockProvider({
        name: 'opus',
        rank: 1,
        capabilities: ['reasoning'],
        costTier: 'premium',
      });
      const cheap = new MockProvider({
        name: 'haiku',
        rank: 2,
        capabilities: ['reasoning'],
        costTier: 'free',
      });
      const r = new Router({ providers: [expensive, cheap] });

      // modelPreference takes priority over maxCostTier
      const task = makeTask({ modelPreference: 'opus', maxCostTier: 'free', resourceType: 'reasoning' });
      const selected = await r.selectProvider(task);
      expect(selected.name).toBe('opus');
    });

    it('respects cost ceiling with optimize_cost mode', async () => {
      const mid = new MockProvider({
        name: 'sonnet',
        rank: 2,
        capabilities: ['reasoning'],
        costTier: 'included',
      });
      const cheap = new MockProvider({
        name: 'haiku',
        rank: 3,
        capabilities: ['reasoning'],
        costTier: 'free',
      });
      const expensive = new MockProvider({
        name: 'opus',
        rank: 1,
        capabilities: ['reasoning'],
        costTier: 'premium',
      });
      const r = new Router({ providers: [expensive, mid, cheap], mode: 'optimize_cost' });

      const task = makeTask({ maxCostTier: 'included', resourceType: 'reasoning' });
      const selected = await r.selectProvider(task);
      // haiku is cheapest within the ceiling
      expect(selected.name).toBe('haiku');
    });
  });
});
