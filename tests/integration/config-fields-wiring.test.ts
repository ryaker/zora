/**
 * Config Fields Wiring Tests (PR #161)
 *
 * Proves that when a config field has a value, the component that should
 * consume it actually receives/uses it at runtime. Covers:
 *   - failover.auto_handoff
 *   - steering.poll_interval (passed as debounce window to SteeringManager)
 *   - steering.auto_approve_low_risk → ApprovalQueue.setSessionBlanketAllow()
 *   - config.hooks array → HookRunner registrations
 *
 * If a field is NOT actually wired, we document it here as it.todo() so the
 * gap is visible rather than hidden.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FailoverController } from '../../src/orchestrator/failover-controller.js';
import { Router } from '../../src/orchestrator/router.js';
import { ApprovalQueue, DEFAULT_APPROVAL_CONFIG } from '../../src/core/approval-queue.js';
import { HookRunner } from '../../src/hooks/hook-runner.js';
import { MockProvider } from '../fixtures/mock-provider.js';
import { SteeringManager } from '../../src/steering/steering-manager.js';
import type { TaskContext, FailoverConfig } from '../../src/types.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    jobId: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    task: 'wiring test task',
    requiredCapabilities: ['reasoning'],
    complexity: 'simple',
    resourceType: 'reasoning',
    systemPrompt: '',
    memoryContext: [],
    history: [],
    ...overrides,
  };
}

// ─── Test 1: failover.auto_handoff: false skips handoff ──────────────────────

describe('failover.auto_handoff config field wiring', () => {
  it('auto_handoff: true performs handoff on quota error', async () => {
    const primary = new MockProvider({ name: 'claude', rank: 1, capabilities: ['reasoning'] });
    const secondary = new MockProvider({ name: 'gemini', rank: 2, capabilities: ['reasoning'] });
    const router = new Router({ providers: [primary, secondary] });

    const config: FailoverConfig = {
      enabled: true,
      auto_handoff: true,
      max_handoff_context_tokens: 50000,
      retry_after_cooldown: true,
      max_retries: 3,
      checkpoint_on_auth_failure: false,
      notify_on_failover: false,
    };

    const controller = new FailoverController([primary, secondary], router, config);
    const error = new Error('429 rate limit exceeded');
    const result = await controller.handleFailure(makeTask(), primary, error);

    expect(result).not.toBeNull();
    expect(result!.nextProvider.name).toBe('gemini');
  });

  it('auto_handoff: false suppresses handoff — job stays on original provider', async () => {
    const primary = new MockProvider({ name: 'claude', rank: 1, capabilities: ['reasoning'] });
    const secondary = new MockProvider({ name: 'gemini', rank: 2, capabilities: ['reasoning'] });
    const router = new Router({ providers: [primary, secondary] });

    const config: FailoverConfig = {
      enabled: true,
      auto_handoff: false,      // <── the field under test
      max_handoff_context_tokens: 50000,
      retry_after_cooldown: true,
      max_retries: 3,
      checkpoint_on_auth_failure: false,
      notify_on_failover: false,
    };

    const handoffCallback = vi.fn();
    const controller = new FailoverController([primary, secondary], router, config, {
      onCheckpoint: handoffCallback,
    });

    // Trigger a quota error — auto_handoff: false must suppress the failover
    const error = new Error('429 rate limit exceeded');
    const result = await controller.handleFailure(makeTask(), primary, error);

    // No handoff bundle returned — caller should NOT switch providers
    expect(result).toBeNull();
  });

  it('auto_handoff: false also suppresses handoff on auth errors', async () => {
    const primary = new MockProvider({ name: 'claude', rank: 1, capabilities: ['reasoning'] });
    const secondary = new MockProvider({ name: 'gemini', rank: 2, capabilities: ['reasoning'] });
    const router = new Router({ providers: [primary, secondary] });

    const config: FailoverConfig = {
      enabled: true,
      auto_handoff: false,
      max_handoff_context_tokens: 50000,
      retry_after_cooldown: true,
      max_retries: 3,
      checkpoint_on_auth_failure: false,
      notify_on_failover: false,
    };

    const controller = new FailoverController([primary, secondary], router, config);
    const error = new Error('Authentication failed: invalid API key');
    const result = await controller.handleFailure(makeTask(), primary, error);

    expect(result).toBeNull();
  });

  it('notify_on_failover: true calls onNotify callback when handoff occurs', async () => {
    const primary = new MockProvider({ name: 'claude', rank: 1, capabilities: ['reasoning'] });
    const secondary = new MockProvider({ name: 'gemini', rank: 2, capabilities: ['reasoning'] });
    const router = new Router({ providers: [primary, secondary] });

    const config: FailoverConfig = {
      enabled: true,
      auto_handoff: true,
      max_handoff_context_tokens: 50000,
      retry_after_cooldown: true,
      max_retries: 3,
      checkpoint_on_auth_failure: false,
      notify_on_failover: true,   // <── the field under test
    };

    const notifySpy = vi.fn().mockResolvedValue(undefined);
    const controller = new FailoverController([primary, secondary], router, config, {
      onNotify: notifySpy,
    });

    const error = new Error('429 rate limit exceeded');
    await controller.handleFailure(makeTask(), primary, error);

    // Poll for the fire-and-forget notification rather than using a fixed sleep,
    // which is flaky under event-loop pressure on slow CI machines.
    await vi.waitUntil(() => notifySpy.mock.calls.length > 0, { timeout: 2000, interval: 20 });

    expect(notifySpy).toHaveBeenCalledOnce();
    expect(notifySpy.mock.calls[0]![0]).toContain('claude');
    expect(notifySpy.mock.calls[0]![0]).toContain('gemini');
  });

  it('notify_on_failover: false does NOT call onNotify', async () => {
    const primary = new MockProvider({ name: 'claude', rank: 1, capabilities: ['reasoning'] });
    const secondary = new MockProvider({ name: 'gemini', rank: 2, capabilities: ['reasoning'] });
    const router = new Router({ providers: [primary, secondary] });

    const config: FailoverConfig = {
      enabled: true,
      auto_handoff: true,
      max_handoff_context_tokens: 50000,
      retry_after_cooldown: true,
      max_retries: 3,
      checkpoint_on_auth_failure: false,
      notify_on_failover: false,   // <── the field under test
    };

    const notifySpy = vi.fn().mockResolvedValue(undefined);
    const controller = new FailoverController([primary, secondary], router, config, {
      onNotify: notifySpy,
    });

    const error = new Error('429 rate limit exceeded');
    await controller.handleFailure(makeTask(), primary, error);
    // Drain the microtask queue — if notify fires synchronously or in the next tick
    // we want to catch it, but we should not wait for an event that must NOT occur.
    await Promise.resolve();

    expect(notifySpy).not.toHaveBeenCalled();
  });
});

// ─── Test 2: steering.poll_interval wires through ─────────────────────────────

describe('steering.poll_interval config field wiring', () => {
  /**
   * steering.poll_interval is consumed inside Orchestrator.submitTask() as:
   *
   *   const steerPollMs = this._parseIntervalMs(this._config.steering.poll_interval ?? '5s');
   *   const pendingMessages = await this._steeringManager.cachedGetPendingMessages(
   *     taskContext.jobId, steerPollMs  // <── used as the maxAgeMs debounce window
   *   );
   *
   * The SteeringManager itself is not aware of config — it receives the value at
   * call-site as the `maxAgeMs` parameter. We verify the SteeringManager honours
   * the maxAgeMs window and that a short window bypasses the cache (simulating a
   * short poll_interval) while a long window serves from cache.
   *
   * NOTE: Full end-to-end verification of "config value reaches cachedGetPendingMessages"
   * requires booting the full Orchestrator (which needs a real .zora dir, providers,
   * security audit, etc.). That is covered by the orchestrator-e2e.test.ts suite.
   * The test here validates the component-level contract that the wired value governs.
   */

  let tempDir: string;
  let steeringManager: SteeringManager;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zora-steer-test-'));
    steeringManager = new SteeringManager(tempDir);
    await steeringManager.init();
  });

  it('maxAgeMs=0 always re-reads from disk (simulates very short poll_interval)', async () => {
    const jobId = 'job_wiring_test_001';

    // First call — no messages, populates cache
    const first = await steeringManager.cachedGetPendingMessages(jobId, 0);
    expect(first).toHaveLength(0);

    // Inject a message directly to disk
    await steeringManager.injectMessage({
      jobId,
      type: 'steer',
      message: 'turn left',
      source: 'test',
      author: 'tester',
      timestamp: new Date().toISOString(),
    });

    // maxAgeMs=0 means the cache is always stale → fresh read picks up the message
    const second = await steeringManager.cachedGetPendingMessages(jobId, 0);
    expect(second).toHaveLength(1);
    expect(second[0]!.message).toBe('turn left');
  });

  it('maxAgeMs=60000 serves from cache within the window (simulates long poll_interval)', async () => {
    const jobId = 'job_wiring_test_002';

    // Prime the cache with empty result
    await steeringManager.cachedGetPendingMessages(jobId, 60_000);

    // Inject a message to disk
    await steeringManager.injectMessage({
      jobId,
      type: 'steer',
      message: 'do not read me yet',
      source: 'test',
      author: 'tester',
      timestamp: new Date().toISOString(),
    });

    // With a 60 second window, the cache is still fresh → message NOT visible
    const cached = await steeringManager.cachedGetPendingMessages(jobId, 60_000);
    expect(cached).toHaveLength(0);

    // After invalidation, fresh read returns the new message
    steeringManager.invalidatePendingCache(jobId);
    const fresh = await steeringManager.cachedGetPendingMessages(jobId, 60_000);
    expect(fresh).toHaveLength(1);
  });

  it.todo('steering.poll_interval config value reaches SteeringManager.cachedGetPendingMessages as maxAgeMs in full Orchestrator boot — needs orchestrator-e2e harness');
});

// ─── Test 3: ApprovalQueue.setSessionBlanketAllow() honours auto_approve_low_risk ──

describe('ApprovalQueue.setSessionBlanketAllow() wiring (auto_approve_low_risk)', () => {
  /**
   * daemon.ts wires steering.auto_approve_low_risk like this:
   *
   *   if (config.steering.auto_approve_low_risk && approvalQueue.isEnabled()) {
   *     const flagThreshold = (policy.actions?.thresholds?.flag as number | undefined) ?? 65;
   *     approvalQueue.setSessionBlanketAllow(flagThreshold);
   *   }
   *
   * We test ApprovalQueue.setSessionBlanketAllow() directly — verifying that calling
   * it with a maxScore causes low-scoring requests to be auto-approved without
   * requiring a send handler (i.e., no interactive approval round-trip needed).
   */

  it('setSessionBlanketAllow(30) auto-approves requests with score < 30 without a send handler', async () => {
    const queue = new ApprovalQueue({
      ...DEFAULT_APPROVAL_CONFIG,
      enabled: true,
      timeoutMs: 5_000,
    });

    // Pre-activate the session blanket — mirrors what daemon.ts does with flagThreshold
    queue.setSessionBlanketAllow(30);

    // No send handler registered — without blanket allow, request() would auto-deny
    // With blanket allow covering score < 30, it should auto-approve
    const approved = await queue.request({
      action: 'read a config file',
      score: 20,        // below the blanket threshold of 30
      jobId: 'job_blanket_test',
      tool: 'read_file',
    });

    expect(approved).toBe(true);
  });

  it('setSessionBlanketAllow(30) does NOT cover requests with score >= 30', async () => {
    const queue = new ApprovalQueue({
      ...DEFAULT_APPROVAL_CONFIG,
      enabled: true,
      timeoutMs: 100,   // short timeout for test speed
    });

    queue.setSessionBlanketAllow(30);

    // Score = 30 is NOT below the threshold (condition is `score < blanketMaxScore`)
    // No send handler → auto-deny after timeout
    const approved = await queue.request({
      action: 'delete a production database',
      score: 30,        // at the boundary — not covered
      jobId: 'job_blanket_boundary',
      tool: 'bash',
    });

    expect(approved).toBe(false);
  });

  it('without setSessionBlanketAllow, request without send handler auto-denies', async () => {
    const queue = new ApprovalQueue({
      ...DEFAULT_APPROVAL_CONFIG,
      enabled: true,
      timeoutMs: 100,
    });

    // No blanket allow, no send handler → should auto-deny immediately
    const approved = await queue.request({
      action: 'read a file',
      score: 10,
      jobId: 'job_no_blanket',
      tool: 'read_file',
    });

    expect(approved).toBe(false);
  });

  it('setSessionBlanketAllow persists for the session — multiple requests are all covered', async () => {
    const queue = new ApprovalQueue({
      ...DEFAULT_APPROVAL_CONFIG,
      enabled: true,
      timeoutMs: 5_000,
    });

    queue.setSessionBlanketAllow(50);

    const results = await Promise.all([
      queue.request({ action: 'action-a', score: 10, jobId: 'j1', tool: 'read_file' }),
      queue.request({ action: 'action-b', score: 25, jobId: 'j2', tool: 'list_dir' }),
      queue.request({ action: 'action-c', score: 49, jobId: 'j3', tool: 'read_file' }),
    ]);

    expect(results).toEqual([true, true, true]);
  });
});

// ─── Test 4: HookRunner receives config.hooks registrations ──────────────────

describe('HookRunner config.hooks registration wiring', () => {
  /**
   * Orchestrator.boot() iterates config.hooks and calls hookRunner.on(event, handler)
   * for each entry. These tests exercise the HookRunner API directly at the same
   * call sites that orchestrator.ts uses — verifying that registered hooks fire.
   *
   * We do NOT boot Orchestrator here (that requires a full daemon environment).
   * Instead we mirror exactly what orchestrator.ts does: call hookRunner.on() and
   * then assert the hook fires when the corresponding run* method is called.
   */

  let hookRunner: HookRunner;

  beforeEach(() => {
    hookRunner = new HookRunner();
  });

  it('onTaskStart hook registered via on() is called by runOnTaskStart()', async () => {
    const fired = vi.fn((ctx: TaskContext) => Promise.resolve(ctx));

    // Mirror: orchestrator.ts → hookRunner.on('onTaskStart', async (ctx) => { ... return ctx; })
    hookRunner.on('onTaskStart', fired);

    const task = makeTask({ task: 'test task for hook' });
    await hookRunner.runOnTaskStart(task);

    expect(fired).toHaveBeenCalledOnce();
    expect(fired).toHaveBeenCalledWith(task);
  });

  it('onTaskEnd hook registered via on() is called by runOnTaskEnd()', async () => {
    const fired = vi.fn((_ctx: TaskContext, _result: string) => Promise.resolve({}));

    hookRunner.on('onTaskEnd', fired);

    const task = makeTask();
    await hookRunner.runOnTaskEnd(task, 'task completed');

    expect(fired).toHaveBeenCalledOnce();
  });

  it('beforeToolExecute hook registered via on() fires before tool calls', async () => {
    const fired = vi.fn((_toolName: string, args: Record<string, unknown>) =>
      Promise.resolve({ allow: true, args })
    );

    hookRunner.on('beforeToolExecute', fired);

    const result = await hookRunner.runBeforeToolExecute('bash', { command: 'ls' });

    expect(fired).toHaveBeenCalledOnce();
    expect(fired).toHaveBeenCalledWith('bash', { command: 'ls' });
    expect(result.allow).toBe(true);
  });

  it('afterToolExecute hook registered via on() fires after tool calls', async () => {
    const fired = vi.fn((_toolName: string, result: unknown) =>
      Promise.resolve(result)
    );

    hookRunner.on('afterToolExecute', fired);

    const toolResult = { output: 'file contents' };
    await hookRunner.runAfterToolExecute('read_file', toolResult);

    expect(fired).toHaveBeenCalledOnce();
    expect(fired).toHaveBeenCalledWith('read_file', toolResult);
  });

  it('multiple hooks registered for the same event all fire in order', async () => {
    const callOrder: number[] = [];

    hookRunner.on('onTaskStart', async (ctx) => { callOrder.push(1); return ctx; });
    hookRunner.on('onTaskStart', async (ctx) => { callOrder.push(2); return ctx; });
    hookRunner.on('onTaskStart', async (ctx) => { callOrder.push(3); return ctx; });

    await hookRunner.runOnTaskStart(makeTask());

    expect(callOrder).toEqual([1, 2, 3]);
  });

  it('hookRunner.count() reflects registrations matching what orchestrator wires', () => {
    // Before any registration
    expect(hookRunner.count('onTaskStart')).toBe(0);

    hookRunner.on('onTaskStart', async (ctx) => ctx);
    hookRunner.on('onTaskStart', async (ctx) => ctx);

    expect(hookRunner.count('onTaskStart')).toBe(2);
  });

  it('beforeToolExecute hook with match pattern only fires for matching tools (mirrors orchestrator config.hooks match field)', async () => {
    const fired = vi.fn((_toolName: string, args: Record<string, unknown>) =>
      Promise.resolve({ allow: true, args })
    );

    // Simulate orchestrator.ts match pattern wiring:
    //   const matchPattern = match ? new RegExp(match) : null;
    //   hookRunner.on('beforeToolExecute', async (toolName, args) => {
    //     if (matchPattern && !matchPattern.test(toolName)) return { allow: true };
    //     ...call fired...
    //   });
    const matchPattern = new RegExp('bash');
    hookRunner.on('beforeToolExecute', async (toolName, args) => {
      if (!matchPattern.test(toolName)) return { allow: true };
      return fired(toolName, args);
    });

    // 'bash' matches — hook should fire
    await hookRunner.runBeforeToolExecute('bash', { command: 'ls' });
    expect(fired).toHaveBeenCalledOnce();

    // 'read_file' does not match — hook should NOT fire
    await hookRunner.runBeforeToolExecute('read_file', { path: '/tmp' });
    expect(fired).toHaveBeenCalledOnce(); // still only once
  });

  it.todo('config.hooks entries in config.toml reach HookRunner.on() during Orchestrator.boot() — needs orchestrator-e2e harness with real config.toml containing [[hooks]] entries');
});

// ─── Wiring Gap Documentation ─────────────────────────────────────────────────

describe('Wiring gaps discovered during PR #161 review', () => {
  it.todo(
    'memory.auto_extract_interval: scheduling verified via log.info call in orchestrator.ts but ' +
    'no unit-testable accessor exists on Orchestrator to inspect _memoryExtractIntervalTimeout — ' +
    'integration test requires full Orchestrator boot with a short interval and spying on MemoryManager.consolidateDailyNotes'
  );

  it.todo(
    'agent.log_level: initLogger() is called with config.agent.log_level in both daemon.ts and ' +
    'orchestrator.ts boot() but the logger level is not publicly readable — ' +
    'verification requires spying on pino or reading process logger state'
  );

  /**
   * ApprovalQueue ↔ ChannelManager transport gap (documented in daemon.ts line ~287):
   *
   *   // TODO: wire ApprovalQueue to ChannelManager once the ChannelManager exposes
   *   // a sendApprovalRequest() method (replaces old TelegramGateway.connectApprovalQueue).
   *   if (approvalQueue.isEnabled()) {
   *     log.warn('ApprovalQueue enabled but ChannelManager approval transport not yet implemented...')
   *   }
   *
   * The ApprovalQueue OBJECT is correctly instantiated with config values, and
   * setSessionBlanketAllow() IS wired from steering.auto_approve_low_risk.
   * However the approval SEND PATH is not wired — approval requests will log a
   * "No send handler registered — auto-denying" warning until ChannelManager
   * exposes sendApprovalRequest().
   */
  it.todo(
    'ApprovalQueue send handler gap: approvalQueue.setSendHandler() is never called in daemon.ts ' +
    '(ChannelManager transport not yet implemented). approval.enabled=true in config will result in ' +
    'auto-deny for all approval requests that are NOT covered by setSessionBlanketAllow(). ' +
    'Fix: implement ChannelManager.sendApprovalRequest() and call approvalQueue.setSendHandler() in daemon.ts.'
  );
});
