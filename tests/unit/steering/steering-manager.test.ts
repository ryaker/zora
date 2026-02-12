import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SteeringManager } from '../../../src/steering/steering-manager.js';
import type { SteerMessage } from '../../../src/steering/types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('SteeringManager', () => {
  const testDir = path.join(os.tmpdir(), 'zora-steering-test');
  let manager: SteeringManager;

  beforeEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
    manager = new SteeringManager(testDir);
    await manager.init();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('injects and retrieves steer messages', async () => {
    const msg: SteerMessage = {
      type: 'steer',
      jobId: 'job-123',
      source: 'web',
      author: 'rich',
      message: 'Stop what you are doing',
      timestamp: new Date(),
    };

    const id = await manager.injectMessage(msg);
    expect(id).toContain('steer_');

    const pending = await manager.getPendingMessages('job-123');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.message).toBe('Stop what you are doing');
    expect(pending[0]!.id).toBe(id);
  });

  it('archives messages', async () => {
    const msg: SteerMessage = {
      type: 'steer',
      jobId: 'job-1',
      source: 'cli',
      author: 'rich',
      message: 'test',
      timestamp: new Date(),
    };

    const id = await manager.injectMessage(msg);
    await manager.archiveMessage('job-1', id);

    const pending = await manager.getPendingMessages('job-1');
    expect(pending).toHaveLength(0);

    const archivedFiles = await fs.readdir(path.join(testDir, 'steering', 'job-1', 'archive'));
    expect(archivedFiles).toHaveLength(1);
    expect(archivedFiles[0]).toBe(`${id}.json`);
  });

  it('sorts messages by timestamp', async () => {
    const now = Date.now();
    const msg1: SteerMessage = { type: 'steer', jobId: 'j1', source: 'web', author: 'a', message: 'm1', timestamp: new Date(now + 1000) };
    const msg2: SteerMessage = { type: 'steer', jobId: 'j1', source: 'web', author: 'a', message: 'm2', timestamp: new Date(now) };

    await manager.injectMessage(msg1);
    await manager.injectMessage(msg2);

    const pending = await manager.getPendingMessages('j1');
    expect(pending[0]!.message).toBe('m2');
    expect(pending[1]!.message).toBe('m1');
  });
});
