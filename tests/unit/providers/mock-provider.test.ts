import { describe, it, expect, beforeEach } from 'vitest';
import { MockProvider } from '../../fixtures/mock-provider.js';
import type { TaskContext, AgentEvent } from '../../../src/types.js';

function makeTask(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    jobId: 'test-job-1',
    task: 'Write a test',
    requiredCapabilities: ['reasoning'],
    complexity: 'simple',
    resourceType: 'coding',
    systemPrompt: 'You are a test agent.',
    memoryContext: [],
    history: [],
    ...overrides,
  };
}

async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe('MockProvider', () => {
  let provider: MockProvider;

  beforeEach(() => {
    provider = new MockProvider({ name: 'test-mock', rank: 1 });
  });

  describe('interface compliance', () => {
    it('has required readonly properties', () => {
      expect(provider.name).toBe('test-mock');
      expect(provider.rank).toBe(1);
      expect(provider.capabilities).toEqual(['reasoning', 'coding']);
      expect(provider.costTier).toBe('free');
    });

    it('implements isAvailable', async () => {
      expect(await provider.isAvailable()).toBe(true);
      provider.setAvailable(false);
      expect(await provider.isAvailable()).toBe(false);
    });

    it('implements checkAuth', async () => {
      const auth = await provider.checkAuth();
      expect(auth.valid).toBe(true);
      expect(auth.expiresAt).toBeNull();
      expect(auth.canAutoRefresh).toBe(false);
      expect(auth.requiresInteraction).toBe(false);
    });

    it('implements getQuotaStatus', async () => {
      const quota = await provider.getQuotaStatus();
      expect(quota.isExhausted).toBe(false);
      expect(quota.healthScore).toBe(1.0);
    });

    it('implements abort', async () => {
      await provider.abort('job-123');
      expect(provider.abortCalls).toEqual(['job-123']);
    });
  });

  describe('execute', () => {
    it('yields thinking → text → done for successful execution', async () => {
      const events = await collectEvents(provider.execute(makeTask()));

      expect(events).toHaveLength(3);
      expect(events[0]!.type).toBe('thinking');
      expect(events[1]!.type).toBe('text');
      expect(events[2]!.type).toBe('done');
    });

    it('records task in executeCalls', async () => {
      const task = makeTask({ jobId: 'tracked-job' });
      await collectEvents(provider.execute(task));

      expect(provider.executeCalls).toHaveLength(1);
      expect(provider.executeCalls[0]!.jobId).toBe('tracked-job');
    });

    it('returns custom response text', async () => {
      const provider = new MockProvider({ responseText: 'Custom output' });
      const events = await collectEvents(provider.execute(makeTask()));

      const textEvent = events.find((e) => e.type === 'text');
      expect((textEvent!.content as Record<string, string>).text).toBe('Custom output');
    });

    it('yields error event when shouldFail is true', async () => {
      provider.setShouldFail(true);
      const events = await collectEvents(provider.execute(makeTask()));

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('error');
    });

    it('fails mid-execution at specified event count', async () => {
      const provider = new MockProvider({ failAfterEvents: 1 });
      const events = await collectEvents(provider.execute(makeTask()));

      expect(events).toHaveLength(2); // thinking + error
      expect(events[0]!.type).toBe('thinking');
      expect(events[1]!.type).toBe('error');
    });

    it('includes timestamps on all events', async () => {
      const events = await collectEvents(provider.execute(makeTask()));

      for (const event of events) {
        expect(event.timestamp).toBeInstanceOf(Date);
      }
    });
  });

  describe('auth state changes', () => {
    it('tracks auth check count', async () => {
      await provider.checkAuth();
      await provider.checkAuth();
      await provider.checkAuth();
      expect(provider.authCheckCount).toBe(3);
    });

    it('reflects auth state changes', async () => {
      expect((await provider.checkAuth()).valid).toBe(true);
      provider.setAuthValid(false);
      expect((await provider.checkAuth()).valid).toBe(false);
      expect((await provider.checkAuth()).requiresInteraction).toBe(true);
    });
  });

  describe('quota state changes', () => {
    it('tracks quota check count', async () => {
      await provider.getQuotaStatus();
      await provider.getQuotaStatus();
      expect(provider.quotaCheckCount).toBe(2);
    });

    it('reflects quota exhaustion', async () => {
      expect((await provider.getQuotaStatus()).isExhausted).toBe(false);
      provider.setQuotaExhausted(true);
      const status = await provider.getQuotaStatus();
      expect(status.isExhausted).toBe(true);
      expect(status.remainingRequests).toBe(0);
    });

    it('reflects health score changes', async () => {
      provider.setHealthScore(0.5);
      expect((await provider.getQuotaStatus()).healthScore).toBe(0.5);
    });
  });

  describe('reset', () => {
    it('clears all tracking state', async () => {
      await collectEvents(provider.execute(makeTask()));
      await provider.checkAuth();
      await provider.getQuotaStatus();
      await provider.abort('job-1');

      provider.reset();

      expect(provider.executeCalls).toEqual([]);
      expect(provider.abortCalls).toEqual([]);
      expect(provider.authCheckCount).toBe(0);
      expect(provider.quotaCheckCount).toBe(0);
    });
  });

  describe('custom capabilities', () => {
    it('supports standard capabilities', () => {
      const p = new MockProvider({ capabilities: ['reasoning', 'search', 'fast'] });
      expect(p.capabilities).toEqual(['reasoning', 'search', 'fast']);
    });

    it('supports custom capability strings', () => {
      const p = new MockProvider({ capabilities: ['reasoning', 'my-custom-cap'] });
      expect(p.capabilities).toContain('my-custom-cap');
    });
  });

  describe('cost tiers', () => {
    it.each(['free', 'included', 'metered', 'premium'] as const)(
      'accepts cost tier: %s',
      (tier) => {
        const p = new MockProvider({ costTier: tier });
        expect(p.costTier).toBe(tier);
      },
    );
  });
});
