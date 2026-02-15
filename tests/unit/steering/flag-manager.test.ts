import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FlagManager } from '../../../src/steering/flag-manager.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('FlagManager', () => {
  const testDir = path.join(os.tmpdir(), `zora-flag-test-${Date.now()}`);

  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('creates a flag and returns flagId', async () => {
    const manager = new FlagManager(testDir, { timeoutMs: 30000 });
    const flagId = await manager.flag('job-1', 'Delete this file?', 'skip');
    expect(flagId).toMatch(/^flag_/);
    const flags = await manager.getFlags();
    expect(flags).toHaveLength(1);
    expect(flags[0]!.flagId).toBe(flagId);
    expect(flags[0]!.status).toBe('pending_review');
    expect(flags[0]!.question).toBe('Delete this file?');
    expect(flags[0]!.defaultAction).toBe('skip');
  });

  it('approves a flag', async () => {
    const manager = new FlagManager(testDir, { timeoutMs: 30000 });
    const flagId = await manager.flag('job-1', 'Proceed?', 'abort');
    await manager.approve(flagId);
    const decision = await manager.getFlagDecision(flagId);
    expect(decision).toBe('approved');
    const flags = await manager.getFlags();
    expect(flags[0]!.status).toBe('approved');
    expect(flags[0]!.resolvedAt).toBeDefined();
  });

  it('rejects a flag with reason', async () => {
    const manager = new FlagManager(testDir, { timeoutMs: 30000 });
    const flagId = await manager.flag('job-1', 'Format disk?', 'yes');
    await manager.reject(flagId, 'Too dangerous');
    const decision = await manager.getFlagDecision(flagId);
    expect(decision).toBe('rejected');
    const flags = await manager.getFlags();
    expect(flags[0]!.status).toBe('rejected');
    expect(flags[0]!.chosenAction).toBe('Too dangerous');
  });

  it('auto-resolves with default action after timeout', async () => {
    const manager = new FlagManager(testDir, { timeoutMs: 50 });
    const flagId = await manager.flag('job-1', 'Continue?', 'yes-continue');
    await new Promise((r) => setTimeout(r, 150));
    const decision = await manager.getFlagDecision(flagId);
    expect(decision).toBe('approved');
    const flags = await manager.getFlags();
    expect(flags[0]!.status).toBe('timed_out');
    expect(flags[0]!.chosenAction).toBe('yes-continue');
  });

  it('filters flags by jobId', async () => {
    const manager = new FlagManager(testDir, { timeoutMs: 30000 });
    await manager.flag('job-a', 'Q1?', 'default');
    await manager.flag('job-b', 'Q2?', 'default');
    await manager.flag('job-a', 'Q3?', 'default');
    const jobAFlags = await manager.getFlags('job-a');
    expect(jobAFlags).toHaveLength(2);
    const jobBFlags = await manager.getFlags('job-b');
    expect(jobBFlags).toHaveLength(1);
  });

  it('calls notifyFn when flag is created', async () => {
    const notifyFn = vi.fn();
    const manager = new FlagManager(testDir, { timeoutMs: 30000, notifyFn });
    await manager.flag('job-1', 'Important question', 'default');
    expect(notifyFn).toHaveBeenCalledTimes(1);
    expect(notifyFn).toHaveBeenCalledWith(expect.stringContaining('Important question'));
  });

  it('does not auto-resolve if already decided', async () => {
    const manager = new FlagManager(testDir, { timeoutMs: 50 });
    const flagId = await manager.flag('job-1', 'Q?', 'default-action');
    await manager.reject(flagId, 'no');
    await new Promise((r) => setTimeout(r, 150));
    const flags = await manager.getFlags();
    expect(flags[0]!.status).toBe('rejected');
  });

  it('getFlagDecision returns pending for unknown flag', async () => {
    const manager = new FlagManager(testDir, { timeoutMs: 30000 });
    const decision = await manager.getFlagDecision('nonexistent');
    expect(decision).toBe('pending');
  });

  it('logs and tracks diagnostics for corrupted flag files', async () => {
    const manager = new FlagManager(testDir, { timeoutMs: 30000 });
    // Create a valid flag first so the directory exists
    await manager.flag('job-1', 'Q?', 'default');

    // Write a corrupted JSON file
    await fs.writeFile(path.join(testDir, 'corrupted.json'), '{ bad json !!!', 'utf8');

    const flags = await manager.getFlags();
    // Should get 1 valid flag, corrupted one skipped
    expect(flags).toHaveLength(1);

    const status = manager.getConfigStatus();
    expect(status.filesLoaded).toBeGreaterThanOrEqual(1);
    expect(status.filesFailed).toBeGreaterThanOrEqual(1);
    expect(status.failedFiles.length).toBeGreaterThanOrEqual(1);
    expect(status.failedFiles[0]!.errorType).toBe('parse_error');
  });

  it('getConfigStatus returns zero counts initially', () => {
    const manager = new FlagManager(testDir, { timeoutMs: 30000 });
    const status = manager.getConfigStatus();
    expect(status.filesLoaded).toBe(0);
    expect(status.filesFailed).toBe(0);
    expect(status.failedFiles).toEqual([]);
  });

  it('tracks diagnostics for getFlagDecision on missing flag', async () => {
    const manager = new FlagManager(testDir, { timeoutMs: 30000 });
    await manager.getFlagDecision('nonexistent-flag');
    const status = manager.getConfigStatus();
    expect(status.failedFiles.length).toBe(1);
    expect(status.failedFiles[0]!.errorType).toBe('not_found');
  });

  it('throws on corrupted flag file during resolve', async () => {
    const manager = new FlagManager(testDir, { timeoutMs: 30000 });
    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(path.join(testDir, 'bad_flag.json'), '!!!not json!!!', 'utf8');

    await expect(manager.approve('bad_flag')).rejects.toThrow('Corrupted flag file');
  });
});
