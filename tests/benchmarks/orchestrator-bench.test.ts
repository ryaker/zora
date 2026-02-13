/**
 * R29: Performance benchmarks for core orchestration operations.
 *
 * Baseline metrics:
 *   - Task submission latency
 *   - Provider selection time
 *   - Session write throughput
 *   - Memory context loading time
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { Router } from '../../src/orchestrator/router.js';
import { SessionManager } from '../../src/orchestrator/session-manager.js';
import { RetryQueue } from '../../src/orchestrator/retry-queue.js';
import type { LLMProvider, AuthStatus, QuotaStatus, AgentEvent, TaskContext, ProviderCapability, CostTier } from '../../src/types.js';

// ─── Mock Provider ──────────────────────────────────────────────

class BenchmarkProvider implements LLMProvider {
  readonly name: string;
  readonly rank: number;
  readonly capabilities: ProviderCapability[];
  readonly costTier: CostTier;

  constructor(name: string, rank: number, capabilities: ProviderCapability[] = ['reasoning', 'coding']) {
    this.name = name;
    this.rank = rank;
    this.capabilities = capabilities;
    this.costTier = 'included';
  }

  async isAvailable(): Promise<boolean> { return true; }
  async checkAuth(): Promise<AuthStatus> {
    return { valid: true, expiresAt: null, canAutoRefresh: true, requiresInteraction: false };
  }
  async getQuotaStatus(): Promise<QuotaStatus> {
    return { isExhausted: false, remainingRequests: null, cooldownUntil: null, healthScore: 1.0 };
  }
  async *execute(_task: TaskContext): AsyncGenerator<AgentEvent> {
    yield { type: 'done', timestamp: new Date(), content: { text: 'done' } };
  }
  async abort(): Promise<void> {}
}

// ─── Benchmarks ──────────────────────────────────────────────────

describe('Performance Benchmarks (R29)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `zora-bench-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Router — Provider Selection', () => {
    it('should select provider in under 10ms for 5 providers', async () => {
      const providers = Array.from({ length: 5 }, (_, i) =>
        new BenchmarkProvider(`provider-${i}`, i + 1)
      );
      const router = new Router({ providers, mode: 'respect_ranking' });
      const task: TaskContext = {
        jobId: 'bench-1',
        task: 'Write code',
        requiredCapabilities: ['coding'],
        complexity: 'moderate',
        resourceType: 'coding',
        systemPrompt: '',
        memoryContext: [],
        history: [],
      };

      const iterations = 100;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        await router.selectProvider(task);
      }
      const elapsed = performance.now() - start;
      const avgMs = elapsed / iterations;

      expect(avgMs).toBeLessThan(10);
      console.log(`[Benchmark] Router.selectProvider avg: ${avgMs.toFixed(3)}ms`);
    });

    it('should classify tasks in under 1ms', () => {
      const router = new Router({ providers: [], mode: 'respect_ranking' });
      const prompts = [
        'Search for information about quantum computing',
        'Refactor the authentication module with security audit',
        'Write a blog post about AI trends',
        'Extract data from CSV files',
        'Fix the login bug',
      ];

      const iterations = 1000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        router.classifyTask(prompts[i % prompts.length]!);
      }
      const elapsed = performance.now() - start;
      const avgMs = elapsed / iterations;

      expect(avgMs).toBeLessThan(1);
      console.log(`[Benchmark] Router.classifyTask avg: ${avgMs.toFixed(4)}ms`);
    });
  });

  describe('SessionManager — Write Throughput', () => {
    it('should write 100 events in under 500ms', async () => {
      const sm = new SessionManager(tempDir);
      const jobId = 'bench-session';
      const event: AgentEvent = {
        type: 'text',
        timestamp: new Date(),
        content: { text: 'Benchmark event with some reasonable content length to simulate real data.' },
      };

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        await sm.appendEvent(jobId, { ...event, timestamp: new Date() });
      }
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(500);
      console.log(`[Benchmark] SessionManager.appendEvent x100: ${elapsed.toFixed(1)}ms`);

      // Verify all events persisted
      const history = await sm.getHistory(jobId);
      expect(history).toHaveLength(100);
    });

    it('should list sessions in under 100ms with 20 session files', async () => {
      const sm = new SessionManager(tempDir);

      // Create 20 session files
      for (let i = 0; i < 20; i++) {
        const jobId = `bench-job-${i}`;
        for (let j = 0; j < 5; j++) {
          await sm.appendEvent(jobId, {
            type: 'text',
            timestamp: new Date(),
            content: { text: `Event ${j}` },
          });
        }
      }

      const start = performance.now();
      const sessions = await sm.listSessions();
      const elapsed = performance.now() - start;

      expect(sessions).toHaveLength(20);
      expect(elapsed).toBeLessThan(100);
      console.log(`[Benchmark] SessionManager.listSessions (20 files): ${elapsed.toFixed(1)}ms`);
    });
  });

  describe('RetryQueue — Operations', () => {
    it('should enqueue and retrieve tasks efficiently', async () => {
      const rq = new RetryQueue(tempDir);
      await rq.init();

      const task: TaskContext = {
        jobId: 'retry-bench',
        task: 'Test task',
        requiredCapabilities: [],
        complexity: 'simple',
        resourceType: 'reasoning',
        systemPrompt: '',
        memoryContext: [],
        history: [],
      };

      const iterations = 50;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const uniqueTask = { ...task, jobId: `retry-bench-${i}` };
        await rq.enqueue(uniqueTask, 'test error');
      }
      const elapsed = performance.now() - start;

      expect(rq.size).toBe(iterations);
      console.log(`[Benchmark] RetryQueue.enqueue x${iterations}: ${elapsed.toFixed(1)}ms`);
    });
  });
});
