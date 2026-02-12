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
});
