/**
 * Tests for ORCH-16: maxInjectionLoops guard
 *
 * Tests the pattern of capping follow-up injection loops
 * from onTaskEnd hooks. The actual guard is in orchestrator.ts,
 * but we test the HookRunner behavior that feeds into it.
 */

import { describe, it, expect } from 'vitest';
import { HookRunner } from '../../../src/hooks/hook-runner.js';
import type { TaskContext } from '../../../src/types.js';

function makeTaskContext(overrides?: Partial<TaskContext>): TaskContext {
  return {
    jobId: 'test-job',
    task: 'test task',
    requiredCapabilities: [],
    complexity: 'simple',
    resourceType: 'reasoning',
    systemPrompt: 'You are a test agent.',
    memoryContext: [],
    history: [],
    ...overrides,
  };
}

describe('maxInjectionLoops guard — ORCH-16', () => {
  const MAX_INJECTION_LOOPS = 3; // Matches Orchestrator.MAX_INJECTION_LOOPS

  it('caps follow-up injection at MAX_INJECTION_LOOPS depth', async () => {
    const runner = new HookRunner();
    let callCount = 0;

    // Hook that always wants a follow-up
    runner.on('onTaskEnd', async () => {
      callCount++;
      return { followUp: `follow-up task ${callCount}` };
    });

    // Simulate the orchestrator's injection loop pattern
    let depth = 0;
    let currentResult = 'initial result';
    const ctx = makeTaskContext();

    while (depth < MAX_INJECTION_LOOPS + 2) {
      const endResult = await runner.runOnTaskEnd(ctx, currentResult);
      if (!endResult.followUp) break;

      if (depth >= MAX_INJECTION_LOOPS) {
        // Guard would cap here — follow-up is ignored
        break;
      }

      currentResult = `result from follow-up at depth ${depth + 1}`;
      depth++;
    }

    // Should have executed exactly MAX_INJECTION_LOOPS iterations before capping
    expect(depth).toBe(MAX_INJECTION_LOOPS);
    expect(callCount).toBe(MAX_INJECTION_LOOPS + 1); // one extra call that gets capped
  });

  it('does not cap when follow-ups terminate naturally', async () => {
    const runner = new HookRunner();
    let callCount = 0;

    // Hook that returns follow-up only twice
    runner.on('onTaskEnd', async () => {
      callCount++;
      if (callCount <= 2) {
        return { followUp: `follow-up ${callCount}` };
      }
      return {};
    });

    let depth = 0;
    const ctx = makeTaskContext();

    while (depth < MAX_INJECTION_LOOPS + 2) {
      const endResult = await runner.runOnTaskEnd(ctx, 'result');
      if (!endResult.followUp) break;

      if (depth >= MAX_INJECTION_LOOPS) break;
      depth++;
    }

    expect(depth).toBe(2); // Terminated naturally before cap
    expect(callCount).toBe(3); // 2 follow-ups + 1 terminating call
  });

  it('single follow-up does not trigger guard', async () => {
    const runner = new HookRunner();
    let callCount = 0;

    runner.on('onTaskEnd', async () => {
      callCount++;
      if (callCount === 1) return { followUp: 'one more' };
      return {};
    });

    const ctx = makeTaskContext();

    // First call: returns follow-up
    const result1 = await runner.runOnTaskEnd(ctx, 'result');
    expect(result1.followUp).toBe('one more');

    // Second call: no follow-up
    const result2 = await runner.runOnTaskEnd(ctx, 'result');
    expect(result2.followUp).toBeUndefined();
    expect(callCount).toBe(2);
  });

  it('zero follow-ups never triggers guard', async () => {
    const runner = new HookRunner();
    runner.on('onTaskEnd', async () => ({}));

    const ctx = makeTaskContext();
    const result = await runner.runOnTaskEnd(ctx, 'result');
    expect(result).toEqual({});
  });
});
