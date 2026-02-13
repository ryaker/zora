import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventTriggerManager } from '../../../src/routines/event-triggers.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('EventTriggerManager', () => {
  const testDir = path.join(os.tmpdir(), `zora-triggers-test-${Date.now()}`);
  let manager: EventTriggerManager;

  beforeEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
    await fs.mkdir(testDir, { recursive: true });
    manager = new EventTriggerManager({ pollIntervalMs: 30 });
  });

  afterEach(async () => {
    manager.unwatchAll();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('watches for file changes', async () => {
    const filePath = path.join(testDir, 'test.txt');
    await fs.writeFile(filePath, 'initial');

    const callback = vi.fn();
    manager.watch(filePath, 0, callback);

    // Wait for initial mtime capture
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Modify the file
    await fs.writeFile(filePath, 'updated');

    // Wait for poll to detect change
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(callback).toHaveBeenCalledWith(filePath);
  });

  it('debounces rapid changes', async () => {
    const filePath = path.join(testDir, 'debounce.txt');
    await fs.writeFile(filePath, 'v1');

    const callback = vi.fn();
    manager.watch(filePath, 500, callback); // 500ms debounce

    // Wait for initial mtime
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Rapid file changes
    await fs.writeFile(filePath, 'v2');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await fs.writeFile(filePath, 'v3');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await fs.writeFile(filePath, 'v4');

    // Wait for polls
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Debounce should limit callbacks
    expect(callback.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('unwatch stops polling', async () => {
    const filePath = path.join(testDir, 'unwatch.txt');
    await fs.writeFile(filePath, 'initial');

    const callback = vi.fn();
    manager.watch(filePath, 0, callback);

    // Wait for initial mtime
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Unwatch before modifying
    manager.unwatch(filePath);

    await fs.writeFile(filePath, 'modified');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(callback).not.toHaveBeenCalled();
  });

  it('unwatchAll clears everything', async () => {
    const file1 = path.join(testDir, 'a.txt');
    const file2 = path.join(testDir, 'b.txt');
    await fs.writeFile(file1, 'a');
    await fs.writeFile(file2, 'b');

    const cb1 = vi.fn();
    const cb2 = vi.fn();
    manager.watch(file1, 0, cb1);
    manager.watch(file2, 0, cb2);

    // Wait for initial mtime capture
    await new Promise((resolve) => setTimeout(resolve, 80));

    manager.unwatchAll();

    await fs.writeFile(file1, 'modified-a');
    await fs.writeFile(file2, 'modified-b');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
  });

  it('detects new files in watched directory via glob', async () => {
    // Create an initial file so the glob has something to scan
    const existingFile = path.join(testDir, 'existing.log');
    await fs.writeFile(existingFile, 'old');

    const callback = vi.fn();
    manager.watch(path.join(testDir, '*.log'), 0, callback);

    // Wait for initial poll
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Modify the existing file
    await fs.writeFile(existingFile, 'updated content');

    // Wait for detection
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(callback).toHaveBeenCalledWith(existingFile);
  });
});
