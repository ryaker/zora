import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FlagManager } from '../../../src/steering/flag-manager.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('FlagManager', () => {
  const testDir = path.join(os.tmpdir(), `zora-flags-test-${Date.now()}`);
  let manager: FlagManager;

  beforeEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('creates flag and returns flagId', async () => {
    manager = new FlagManager(testDir, { timeoutMs: 60_000 });
    const flagId = await manager.flag('job-1', 'Delete this file?', 'skip');

    expect(flagId).toMatch(/^flag_/);

    const decision = await manager.getFlagDecision(flagId);
    expect(decision).toBe('pending');
  });

  it('gets pending flags filtered by jobId', async () => {
    manager = new FlagManager(testDir, { timeoutMs: 60_000 });
    await manager.flag('job-1', 'Q1', 'skip');
    await manager.flag('job-2', 'Q2', 'skip');
    await manager.flag('job-1', 'Q3', 'proceed');

    const job1Flags = await manager.getFlags('job-1');
    expect(job1Flags).toHaveLength(2);

    const allFlags = await manager.getFlags();
    expect(allFlags).toHaveLength(3);
  });

  it('approves flag', async () => {
    manager = new FlagManager(testDir, { timeoutMs: 60_000 });
    const flagId = await manager.flag('job-1', 'Proceed?', 'abort');

    await manager.approve(flagId);

    const decision = await manager.getFlagDecision(flagId);
    expect(decision).toBe('approved');
  });

  it('rejects flag with reason', async () => {
    manager = new FlagManager(testDir, { timeoutMs: 60_000 });
    const flagId = await manager.flag('job-1', 'Safe to delete?', 'keep');

    await manager.reject(flagId, 'Contains important data');

    const decision = await manager.getFlagDecision(flagId);
    expect(decision).toBe('rejected');

    // Verify reason is stored in the flag file
    const flags = await manager.getFlags('job-1');
    const flag = flags.find((f) => f.flagId === flagId);
    expect(flag).toBeDefined();
    expect(flag!.chosenAction).toBe('Contains important data');
  });

  it('flag timeout auto-resolves with default action', async () => {
    manager = new FlagManager(testDir, { timeoutMs: 50 });
    const flagId = await manager.flag('job-1', 'Timeout test?', 'auto-skip');

    // Wait for timeout + async resolution
    await new Promise((resolve) => setTimeout(resolve, 200));

    const decision = await manager.getFlagDecision(flagId);
    expect(decision).toBe('approved'); // timed_out maps to 'approved'

    // Verify the flag entry shows timed_out status
    const flags = await manager.getFlags('job-1');
    const flag = flags.find((f) => f.flagId === flagId);
    expect(flag).toBeDefined();
    expect(flag!.status).toBe('timed_out');
    expect(flag!.chosenAction).toBe('auto-skip');
  });

  it('calls notifyFn on flag creation', async () => {
    const notifyFn = vi.fn();
    manager = new FlagManager(testDir, { timeoutMs: 60_000, notifyFn });

    await manager.flag('job-1', 'Notify test?', 'skip');

    expect(notifyFn).toHaveBeenCalledOnce();
    expect(notifyFn.mock.calls[0]![0]).toContain('Notify test?');
  });
});
