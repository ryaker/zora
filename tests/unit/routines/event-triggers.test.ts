import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventTriggerManager } from '../../../src/routines/event-triggers.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('EventTriggerManager', () => {
  const testDir = path.join(os.tmpdir(), `zora-triggers-test-${Date.now()}`);

  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('detects file changes via polling', async () => {
    const filePath = path.join(testDir, 'watched.txt');
    await fs.writeFile(filePath, 'initial');
    const callback = vi.fn();
    const manager = new EventTriggerManager({ pollIntervalMs: 30 });
    manager.watch(filePath, 0, callback);
    await new Promise((r) => setTimeout(r, 80));
    await fs.writeFile(filePath, 'modified');
    await new Promise((r) => setTimeout(r, 80));
    expect(callback).toHaveBeenCalledWith(filePath);
    manager.unwatchAll();
  });

  it('debounces rapid changes', async () => {
    const filePath = path.join(testDir, 'rapid.txt');
    await fs.writeFile(filePath, 'v1');
    const callback = vi.fn();
    const manager = new EventTriggerManager({ pollIntervalMs: 30 });
    manager.watch(filePath, 500, callback);
    await new Promise((r) => setTimeout(r, 80));
    await fs.writeFile(filePath, 'v2');
    await new Promise((r) => setTimeout(r, 80));
    expect(callback).toHaveBeenCalledTimes(1);
    await fs.writeFile(filePath, 'v3');
    await new Promise((r) => setTimeout(r, 80));
    expect(callback).toHaveBeenCalledTimes(1);
    manager.unwatchAll();
  });

  it('supports glob patterns', async () => {
    await fs.writeFile(path.join(testDir, 'file1.txt'), 'a');
    await fs.writeFile(path.join(testDir, 'file2.txt'), 'b');
    await fs.writeFile(path.join(testDir, 'file3.log'), 'c');
    const callback = vi.fn();
    const manager = new EventTriggerManager({ pollIntervalMs: 30 });
    manager.watch(path.join(testDir, '*.txt'), 0, callback);
    await new Promise((r) => setTimeout(r, 80));
    await fs.writeFile(path.join(testDir, 'file1.txt'), 'modified');
    await new Promise((r) => setTimeout(r, 80));
    expect(callback).toHaveBeenCalledWith(path.join(testDir, 'file1.txt'));
    manager.unwatchAll();
  });

  it('unwatches a specific path', async () => {
    const filePath = path.join(testDir, 'unwatch-me.txt');
    await fs.writeFile(filePath, 'initial');
    const callback = vi.fn();
    const manager = new EventTriggerManager({ pollIntervalMs: 30 });
    manager.watch(filePath, 0, callback);
    await new Promise((r) => setTimeout(r, 80));
    manager.unwatch(filePath);
    await fs.writeFile(filePath, 'changed');
    await new Promise((r) => setTimeout(r, 150));
    expect(callback).not.toHaveBeenCalled();
    manager.unwatchAll();
  });

  it('unwatchAll stops all watchers', async () => {
    const file1 = path.join(testDir, 'a.txt');
    const file2 = path.join(testDir, 'b.txt');
    await fs.writeFile(file1, 'x');
    await fs.writeFile(file2, 'y');
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const manager = new EventTriggerManager({ pollIntervalMs: 30 });
    manager.watch(file1, 0, cb1);
    manager.watch(file2, 0, cb2);
    await new Promise((r) => setTimeout(r, 80));
    manager.unwatchAll();
    await fs.writeFile(file1, 'changed');
    await fs.writeFile(file2, 'changed');
    await new Promise((r) => setTimeout(r, 150));
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
  });

  it('handles non-existent directory gracefully', async () => {
    const callback = vi.fn();
    const manager = new EventTriggerManager({ pollIntervalMs: 30 });
    manager.watch(path.join(testDir, 'nonexistent', '*.txt'), 0, callback);
    await new Promise((r) => setTimeout(r, 150));
    expect(callback).not.toHaveBeenCalled();
    manager.unwatchAll();
  });
});
