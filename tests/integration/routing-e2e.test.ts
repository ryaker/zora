/**
 * Integration tests for model-aware routing.
 *
 * Verifies that the Router selects providers correctly based on
 * routing mode, capabilities, cost tier, and task context.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Router } from '../../src/orchestrator/router.js';
import type { LLMProvider, TaskContext, AgentEvent, AuthStatus, QuotaStatus } from '../../src/types.js';

function createMockProvider(overrides: Partial<LLMProvider> & { name: string }): LLMProvider {
  return {
    rank: 1,
    capabilities: ['reasoning'],
    costTier: 'metered',
    async isAvailable() { return true; },
    async checkAuth(): Promise<AuthStatus> {
      return { valid: true, expiresAt: null, canAutoRefresh: false, requiresInteraction: false };
    },
    async getQuotaStatus(): Promise<QuotaStatus> {
      return { isExhausted: false, remainingRequests: 100, cooldownUntil: null, healthScore: 1 };
    },
    async *execute(_task: TaskContext): AsyncGenerator<AgentEvent> {
      yield { type: 'done', timestamp: new Date(), content: 'mock' };
    },
    async abort(_jobId: string) {},
    ...overrides,
  };
}

function createTask(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    jobId: 'test-job',
    task: 'Test task',
    requiredCapabilities: ['reasoning'],
    complexity: 'moderate',
    resourceType: 'reasoning',
    systemPrompt: 'test',
    memoryContext: [],
    history: [],
    ...overrides,
  };
}

describe('routing-e2e', () => {
  let claudeProvider: LLMProvider;
  let geminiProvider: LLMProvider;

  beforeEach(() => {
    claudeProvider = createMockProvider({
      name: 'claude',
      rank: 1,
      capabilities: ['reasoning', 'coding', 'creative'],
      costTier: 'premium',
    });

    geminiProvider = createMockProvider({
      name: 'gemini',
      rank: 2,
      capabilities: ['reasoning', 'large-context', 'search', 'coding'],
      costTier: 'included',
    });
  });

  it('respect_ranking mode selects highest-ranked provider', async () => {
    const router = new Router({ providers: [claudeProvider, geminiProvider], mode: 'respect_ranking' });
    const task = createTask();
    const selected = await router.selectProvider(task);
    expect(selected.name).toBe('claude');
  });

  it('optimize_cost mode selects cheapest provider', async () => {
    const router = new Router({ providers: [claudeProvider, geminiProvider], mode: 'optimize_cost' });
    const task = createTask();
    const selected = await router.selectProvider(task);
    expect(selected.name).toBe('gemini');
  });

  it('capability matching filters out providers without required capabilities', async () => {
    const router = new Router({ providers: [claudeProvider, geminiProvider], mode: 'respect_ranking' });
    const task = createTask({ resourceType: 'creative', complexity: 'simple' });
    const selected = await router.selectProvider(task);
    // Only claude has 'creative' capability
    expect(selected.name).toBe('claude');
  });

  it('throws when no provider has required capabilities', async () => {
    const router = new Router({ providers: [claudeProvider, geminiProvider], mode: 'respect_ranking' });
    const task = createTask({ resourceType: 'data', complexity: 'simple' });
    // 'structured-data' capability — neither provider has it
    await expect(router.selectProvider(task)).rejects.toThrow(/No available provider found/);
  });

  it('provider_only mode selects the named provider', async () => {
    const router = new Router({
      providers: [claudeProvider, geminiProvider],
      mode: 'provider_only',
      providerOnlyName: 'gemini',
    });
    const task = createTask();
    const selected = await router.selectProvider(task);
    expect(selected.name).toBe('gemini');
  });

  it('modelPreference overrides routing mode', async () => {
    const router = new Router({ providers: [claudeProvider, geminiProvider], mode: 'respect_ranking' });
    const task = createTask({ modelPreference: 'gemini' });
    const selected = await router.selectProvider(task);
    expect(selected.name).toBe('gemini');
  });

  it('skips unavailable providers', async () => {
    const unavailableClaude = createMockProvider({
      name: 'claude',
      rank: 1,
      capabilities: ['reasoning', 'coding'],
      costTier: 'premium',
      async isAvailable() { return false; },
    });

    const router = new Router({ providers: [unavailableClaude, geminiProvider], mode: 'respect_ranking' });
    const task = createTask({ resourceType: 'coding' });
    const selected = await router.selectProvider(task);
    expect(selected.name).toBe('gemini');
  });

  it('maxCostTier constrains routing to cheaper providers', async () => {
    const router = new Router({ providers: [claudeProvider, geminiProvider], mode: 'respect_ranking' });
    // Claude is 'premium', Gemini is 'included' — maxCostTier='included' should filter out Claude
    const task = createTask({ maxCostTier: 'included', resourceType: 'reasoning' });
    const selected = await router.selectProvider(task);
    expect(selected.name).toBe('gemini');
  });

  it('maxCostTier falls through when it would eliminate all providers', async () => {
    const router = new Router({ providers: [claudeProvider], mode: 'respect_ranking' });
    // Only Claude available (premium), but maxCostTier='free' — should still select Claude
    const task = createTask({ maxCostTier: 'free', resourceType: 'reasoning' });
    const selected = await router.selectProvider(task);
    expect(selected.name).toBe('claude');
  });

  it('classifyTask returns expected complexity and resource type', () => {
    const router = new Router({ providers: [], mode: 'respect_ranking' });

    const result1 = router.classifyTask('search for best practices in security');
    expect(result1.resourceType).toBe('search');

    const result2 = router.classifyTask('refactor the authentication module');
    expect(result2.complexity).toBe('complex');
    expect(result2.resourceType).toBe('coding');

    const result3 = router.classifyTask('hi');
    expect(result3.complexity).toBe('simple');
  });
});
