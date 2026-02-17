/**
 * Tests for ORCH-12: Lifecycle hook system (HookRunner)
 */

import { describe, it, expect, vi } from 'vitest';
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

describe('HookRunner — ORCH-12', () => {
  // ── Registration ──────────────────────────────────────────────────

  it('starts with zero hooks', () => {
    const runner = new HookRunner();
    expect(runner.count('onTaskStart')).toBe(0);
    expect(runner.count('beforeToolExecute')).toBe(0);
    expect(runner.count('afterToolExecute')).toBe(0);
    expect(runner.count('onTaskEnd')).toBe(0);
  });

  it('registers hooks and reports counts', () => {
    const runner = new HookRunner();
    runner.on('onTaskStart', async (ctx) => ctx);
    runner.on('onTaskStart', async (ctx) => ctx);
    runner.on('beforeToolExecute', async () => ({ allow: true }));

    expect(runner.count('onTaskStart')).toBe(2);
    expect(runner.count('beforeToolExecute')).toBe(1);
    expect(runner.count('afterToolExecute')).toBe(0);
  });

  it('activeEvents returns only events with registered hooks', () => {
    const runner = new HookRunner();
    runner.on('onTaskStart', async (ctx) => ctx);
    runner.on('onTaskEnd', async () => undefined);

    expect(runner.activeEvents()).toEqual(['onTaskStart', 'onTaskEnd']);
  });

  it('listHooks returns all events with counts', () => {
    const runner = new HookRunner();
    runner.on('onTaskStart', async (ctx) => ctx);

    const list = runner.listHooks();
    expect(list).toEqual([
      { event: 'onTaskStart', count: 1 },
      { event: 'beforeToolExecute', count: 0 },
      { event: 'afterToolExecute', count: 0 },
      { event: 'onTaskEnd', count: 0 },
    ]);
  });

  // ── onTaskStart ───────────────────────────────────────────────────

  it('runOnTaskStart passes context through hooks in order', async () => {
    const runner = new HookRunner();
    runner.on('onTaskStart', async (ctx) => ({
      ...ctx,
      systemPrompt: ctx.systemPrompt + ' [hook1]',
    }));
    runner.on('onTaskStart', async (ctx) => ({
      ...ctx,
      systemPrompt: ctx.systemPrompt + ' [hook2]',
    }));

    const ctx = makeTaskContext({ systemPrompt: 'base' });
    const result = await runner.runOnTaskStart(ctx);
    expect(result.systemPrompt).toBe('base [hook1] [hook2]');
  });

  it('runOnTaskStart continues on hook error', async () => {
    const runner = new HookRunner();
    runner.on('onTaskStart', async () => {
      throw new Error('hook error');
    });
    runner.on('onTaskStart', async (ctx) => ({
      ...ctx,
      systemPrompt: 'modified',
    }));

    const ctx = makeTaskContext();
    const result = await runner.runOnTaskStart(ctx);
    expect(result.systemPrompt).toBe('modified');
  });

  it('runOnTaskStart returns original context when no hooks registered', async () => {
    const runner = new HookRunner();
    const ctx = makeTaskContext();
    const result = await runner.runOnTaskStart(ctx);
    expect(result).toBe(ctx);
  });

  // ── beforeToolExecute ─────────────────────────────────────────────

  it('runBeforeToolExecute allows by default', async () => {
    const runner = new HookRunner();
    const result = await runner.runBeforeToolExecute('Bash', { cmd: 'ls' });
    expect(result.allow).toBe(true);
  });

  it('runBeforeToolExecute short-circuits on allow=false', async () => {
    const runner = new HookRunner();
    const secondHook = vi.fn().mockResolvedValue({ allow: true });

    runner.on('beforeToolExecute', async (tool) => ({
      allow: tool !== 'Bash',
      message: 'Bash blocked',
    }));
    runner.on('beforeToolExecute', secondHook);

    const result = await runner.runBeforeToolExecute('Bash', {});
    expect(result.allow).toBe(false);
    expect(result.message).toBe('Bash blocked');
    expect(secondHook).not.toHaveBeenCalled();
  });

  it('runBeforeToolExecute accumulates arg modifications', async () => {
    const runner = new HookRunner();
    runner.on('beforeToolExecute', async (_tool, args) => ({
      allow: true,
      args: { ...args, injected: true },
    }));
    runner.on('beforeToolExecute', async (_tool, args) => ({
      allow: true,
      args: { ...args, extra: 'value' },
    }));

    const result = await runner.runBeforeToolExecute('Read', { path: '/foo' });
    expect(result.allow).toBe(true);
    expect(result.args).toEqual({ path: '/foo', injected: true, extra: 'value' });
  });

  it('runBeforeToolExecute continues on hook error', async () => {
    const runner = new HookRunner();
    runner.on('beforeToolExecute', async () => {
      throw new Error('hook error');
    });
    runner.on('beforeToolExecute', async () => ({
      allow: true,
      args: { safe: true },
    }));

    const result = await runner.runBeforeToolExecute('Read', {});
    expect(result.allow).toBe(true);
    expect(result.args).toEqual({ safe: true });
  });

  // ── afterToolExecute ──────────────────────────────────────────────

  it('runAfterToolExecute pipes result through hooks', async () => {
    const runner = new HookRunner();
    runner.on('afterToolExecute', async (_tool, result) => {
      return `${result} [redacted]`;
    });

    const result = await runner.runAfterToolExecute('Read', 'file contents');
    expect(result).toBe('file contents [redacted]');
  });

  it('runAfterToolExecute returns original result with no hooks', async () => {
    const runner = new HookRunner();
    const result = await runner.runAfterToolExecute('Read', 'data');
    expect(result).toBe('data');
  });

  it('runAfterToolExecute continues on hook error', async () => {
    const runner = new HookRunner();
    runner.on('afterToolExecute', async () => {
      throw new Error('hook error');
    });
    runner.on('afterToolExecute', async (_tool, result) => `${result}+suffix`);

    const result = await runner.runAfterToolExecute('Read', 'data');
    expect(result).toBe('data+suffix');
  });

  // ── onTaskEnd ─────────────────────────────────────────────────────

  it('runOnTaskEnd returns empty object with no hooks', async () => {
    const runner = new HookRunner();
    const ctx = makeTaskContext();
    const result = await runner.runOnTaskEnd(ctx, 'done');
    expect(result).toEqual({});
  });

  it('runOnTaskEnd returns follow-up when provided', async () => {
    const runner = new HookRunner();
    runner.on('onTaskEnd', async (_ctx, _result) => ({
      followUp: 'summarize the results',
    }));

    const ctx = makeTaskContext();
    const result = await runner.runOnTaskEnd(ctx, 'done');
    expect(result.followUp).toBe('summarize the results');
  });

  it('runOnTaskEnd returns first follow-up and stops', async () => {
    const runner = new HookRunner();
    runner.on('onTaskEnd', async () => ({ followUp: 'first' }));
    runner.on('onTaskEnd', async () => ({ followUp: 'second' }));

    const ctx = makeTaskContext();
    const result = await runner.runOnTaskEnd(ctx, 'done');
    expect(result.followUp).toBe('first');
  });

  it('runOnTaskEnd continues on hook error', async () => {
    const runner = new HookRunner();
    runner.on('onTaskEnd', async () => {
      throw new Error('hook error');
    });
    runner.on('onTaskEnd', async () => ({ followUp: 'recover' }));

    const ctx = makeTaskContext();
    const result = await runner.runOnTaskEnd(ctx, 'done');
    expect(result.followUp).toBe('recover');
  });

  it('runOnTaskEnd returns empty when hooks return void', async () => {
    const runner = new HookRunner();
    runner.on('onTaskEnd', async () => undefined);
    runner.on('onTaskEnd', async () => undefined);

    const ctx = makeTaskContext();
    const result = await runner.runOnTaskEnd(ctx, 'done');
    expect(result).toEqual({});
  });
});
