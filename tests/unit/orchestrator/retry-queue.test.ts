import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RetryQueue } from '../../../src/orchestrator/retry-queue.js';
import type { TaskContext } from '../../../src/types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('RetryQueue', () => {
  const testDir = path.join(os.tmpdir(), 'zora-retry-test');
  let queue: RetryQueue;

  beforeEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
    queue = new RetryQueue(testDir);
    await queue.init();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  const task: TaskContext = {
    jobId: 'retry-job-1',
    task: 'test',
    requiredCapabilities: [],
    complexity: 'simple',
    resourceType: 'mixed',
    systemPrompt: '',
    memoryContext: [],
    history: [],
  };

  it('enqueues a task and persists it', async () => {
    await queue.enqueue(task, 'Quota exceeded');
    expect(queue.size).toBe(1);

    const stateContent = await fs.readFile(path.join(testDir, 'state', 'retry-queue.json'), 'utf8');
    const state = JSON.parse(stateContent);
    expect(state[0].task.jobId).toBe('retry-job-1');
    expect(state[0].retryCount).toBe(1);
  });

  it('implements exponential backoff', async () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await queue.enqueue(task, '429');
    // First retry: 1^2 = 1 minute delay
    const firstRetry = (queue as any)._queue[0].nextRunAt.getTime();
    expect(firstRetry).toBe(now + 60 * 1000);

    await queue.enqueue(task, '429');
    // Second retry: 2^2 = 4 minutes delay
    const secondRetry = (queue as any)._queue[0].nextRunAt.getTime();
    expect(secondRetry).toBe(now + 4 * 60 * 1000);

    vi.useRealTimers();
  });

  it('identifies ready tasks', async () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await queue.enqueue(task, '429');
    expect(queue.getReadyTasks()).toHaveLength(0);

    // Fast forward 61 seconds
    vi.setSystemTime(now + 61 * 1000);
    expect(queue.getReadyTasks()).toHaveLength(1);
    expect(queue.getReadyTasks()[0]!.jobId).toBe('retry-job-1');

    vi.useRealTimers();
  });

  it('throws and removes after max retries', async () => {
    await queue.enqueue(task, 'err', 1);
    await expect(queue.enqueue(task, 'err', 1)).rejects.toThrow('Max retries exceeded');
    expect(queue.size).toBe(0);
  });
});
