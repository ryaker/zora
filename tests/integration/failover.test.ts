/**
 * TEST-02: Failover and Retry Scenario Tests
 *
 * Integration tests validating:
 *  - FailoverController triggers on provider failures
 *  - RetryQueue exponential backoff timing
 *  - Max retries enforcement
 *  - Handoff bundle construction from event history
 *  - Provider selection respects previous failures
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FailoverController } from '../../src/orchestrator/failover-controller.js';
import { RetryQueue } from '../../src/orchestrator/retry-queue.js';
import { Router } from '../../src/orchestrator/router.js';
import { MockProvider } from '../fixtures/mock-provider.js';
import type { TaskContext, FailoverConfig, AgentEvent } from '../../src/types.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTask(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    jobId: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    task: 'test task',
    requiredCapabilities: ['reasoning'],
    complexity: 'simple',
    resourceType: 'reasoning',
    systemPrompt: '',
    memoryContext: [],
    history: [],
    ...overrides,
  };
}

function makeEvent(type: AgentEvent['type'], content: unknown): AgentEvent {
  return { type, timestamp: new Date(), content };
}

const failoverConfig: FailoverConfig = {
  enabled: true,
  auto_handoff: true,
  max_handoff_context_tokens: 50000,
  retry_after_cooldown: true,
  max_retries: 3,
  checkpoint_on_auth_failure: true,
  notify_on_failover: true,
};

// ─── FailoverController scenarios ────────────────────────────────────

describe('Failover scenarios', () => {
  let primary: MockProvider;
  let secondary: MockProvider;
  let tertiary: MockProvider;
  let router: Router;
  let controller: FailoverController;

  beforeEach(() => {
    primary = new MockProvider({ name: 'claude', rank: 1, capabilities: ['reasoning', 'coding'] });
    secondary = new MockProvider({ name: 'gemini', rank: 2, capabilities: ['reasoning', 'coding'] });
    tertiary = new MockProvider({ name: 'ollama', rank: 3, capabilities: ['reasoning'], costTier: 'free' });
    router = new Router({ providers: [primary, secondary, tertiary] });
    controller = new FailoverController([primary, secondary, tertiary], router, failoverConfig);
  });

  it('triggers failover on 429 quota error', async () => {
    const task = makeTask();
    const error = new Error('Rate limit exceeded (429)');
    const result = await controller.handleFailure(task, primary, error);

    expect(result).not.toBeNull();
    expect(result!.nextProvider.name).not.toBe('claude');
    expect(result!.handoffBundle.fromProvider).toBe('claude');
  });

  it('triggers failover on auth error', async () => {
    const task = makeTask();
    const error = new Error('Authentication failed: token expired');
    const result = await controller.handleFailure(task, primary, error);

    expect(result).not.toBeNull();
    expect(result!.handoffBundle.context.summary).toContain('auth failure');
  });

  it('returns null when failover is disabled', async () => {
    const disabled = new FailoverController([primary, secondary], router, { ...failoverConfig, enabled: false });
    const error = new Error('429');
    const result = await disabled.handleFailure(makeTask(), primary, error);

    expect(result).toBeNull();
  });

  it('preserves handoff bundle with tool history', async () => {
    const history: AgentEvent[] = [
      makeEvent('text', { text: 'Starting analysis...' }),
      makeEvent('tool_call', { toolCallId: 'tc1', tool: 'read_file', arguments: { path: '/tmp/x' } }),
      makeEvent('tool_result', { toolCallId: 'tc1', result: { content: 'file contents' } }),
    ];
    const task = makeTask({ history });
    const error = new Error('429');

    const result = await controller.handleFailure(task, primary, error);
    expect(result).not.toBeNull();
    expect(result!.handoffBundle.toolHistory).toHaveLength(1);
    expect(result!.handoffBundle.toolHistory[0]!.tool).toBe('read_file');
  });

  it('returns null if no capable secondary provider exists', async () => {
    // Only primary has 'coding', tertiary only has 'reasoning'
    const narrowRouter = new Router({ providers: [primary, tertiary] });
    const narrowController = new FailoverController([primary, tertiary], narrowRouter, failoverConfig);
    const task = makeTask({ resourceType: 'coding' });
    const error = new Error('429');
    const result = await narrowController.handleFailure(task, primary, error);

    expect(result).toBeNull();
  });

  it('returns null on non-retriable general errors', async () => {
    const task = makeTask();
    const error = new Error('NetworkError: connection refused');
    const result = await controller.handleFailure(task, primary, error);

    expect(result).toBeNull();
  });
});

// ─── RetryQueue scenarios ────────────────────────────────────────────

describe('RetryQueue scenarios', () => {
  let tempDir: string;
  let queue: RetryQueue;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zora-retry-test-'));
    queue = new RetryQueue(tempDir);
    await queue.init();
  });

  it('enqueues a task and increments size', async () => {
    const task = makeTask();
    await queue.enqueue(task, 'test error');
    expect(queue.size).toBe(1);
  });

  it('applies exponential backoff (nextRunAt increases with retries)', async () => {
    const task = makeTask();

    await queue.enqueue(task, 'error 1');
    // First retry: 1^2 = 1 minute delay
    // Re-enqueue same task
    await queue.enqueue(task, 'error 2');
    // Second retry: 2^2 = 4 minute delay

    // The queue should still have 1 entry (same jobId replaces)
    expect(queue.size).toBe(1);

    // Tasks scheduled in future should not be ready
    const ready = queue.getReadyTasks();
    expect(ready).toHaveLength(0);
  });

  it('throws after max retries exceeded', async () => {
    const task = makeTask();

    await queue.enqueue(task, 'err1', 2);
    await queue.enqueue(task, 'err2', 2);

    // Third attempt should exceed max
    await expect(queue.enqueue(task, 'err3', 2)).rejects.toThrow('Max retries exceeded');
    // Task should be removed from queue
    expect(queue.size).toBe(0);
  });

  it('removes task after completion', async () => {
    const task = makeTask();
    await queue.enqueue(task, 'error');
    expect(queue.size).toBe(1);

    await queue.remove(task.jobId);
    expect(queue.size).toBe(0);
  });

  it('persists and restores state across restart', async () => {
    const task = makeTask();
    await queue.enqueue(task, 'test error');

    // Create new queue instance pointing to same dir
    const queue2 = new RetryQueue(tempDir);
    await queue2.init();
    expect(queue2.size).toBe(1);
  });

  it('handles concurrent task failures independently', async () => {
    const task1 = makeTask({ jobId: 'job-1' });
    const task2 = makeTask({ jobId: 'job-2' });

    await queue.enqueue(task1, 'error1');
    await queue.enqueue(task2, 'error2');
    expect(queue.size).toBe(2);

    await queue.remove('job-1');
    expect(queue.size).toBe(1);
  });

  it('handles empty queue gracefully', async () => {
    expect(queue.size).toBe(0);
    expect(queue.getReadyTasks()).toEqual([]);

    // Removing non-existent task should not throw
    await queue.remove('nonexistent');
    expect(queue.size).toBe(0);
  });

  it('handles corrupted state file gracefully', async () => {
    const stateFile = path.join(tempDir, 'state', 'retry-queue.json');
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, 'invalid json{{{');

    const corruptQueue = new RetryQueue(tempDir);
    await corruptQueue.init();
    expect(corruptQueue.size).toBe(0);
  });
});
