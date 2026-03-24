/**
 * Integration: file_change trigger wiring
 *
 * Proves that RoutineManager + EventTriggerManager actually watch files and fire
 * when they change. Uses real filesystem operations — no mocks for fs or timers.
 *
 * EventTriggerManager uses polling (fs.stat + setInterval), not fs.watch.
 * We use a 30ms poll interval throughout to keep tests fast.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { RoutineManager } from '../../src/routines/routine-manager.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a unique temp directory for a test. */
async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'zora-wiring-'));
}

/**
 * Wait for a condition to become true, polling every 20ms.
 * Rejects after `timeoutMs` with a descriptive message.
 */
function waitFor(
  condition: () => boolean,
  timeoutMs: number,
  description = 'condition',
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = setInterval(() => {
      if (condition()) {
        clearInterval(check);
        resolve();
      } else if (Date.now() >= deadline) {
        clearInterval(check);
        reject(new Error(`Timed out waiting for: ${description}`));
      }
    }, 20);
  });
}

// ─── Test state ───────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];
const managers: RoutineManager[] = [];

afterEach(async () => {
  // Stop all watchers before removing dirs to avoid dangling intervals
  for (const m of managers) {
    m.stopAll();
  }
  managers.length = 0;

  for (const dir of tmpDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

// ─── Test 1: file_change trigger fires routine callback on file write ─────────

describe('file_change trigger wiring', () => {
  it('fires the routine callback when a watched file is written', async () => {
    const tmpDir = await makeTmpDir();
    tmpDirs.push(tmpDir);

    const watchFile = path.join(tmpDir, 'trigger.txt');
    await fs.writeFile(watchFile, 'initial');

    const calls: string[] = [];
    const submitter = async (opts: { prompt: string }) => {
      calls.push(opts.prompt);
      return 'ok';
    };

    // Poll every 30ms so tests run quickly
    const manager = new RoutineManager(submitter, tmpDir, 30);
    managers.push(manager);

    manager.watchRoutine({
      routine: {
        name: 'wiring-test',
        trigger: 'file_change',
        watch_path: watchFile,
      },
      task: { prompt: 'file-changed-callback' },
    });

    expect(manager.watchedCount).toBe(1);

    // Let the poller baseline the initial mtime
    await new Promise((r) => setTimeout(r, 80));

    // Write to trigger a change
    await fs.writeFile(watchFile, 'changed');

    // Wait up to 2s for at least one callback
    await waitFor(() => calls.length >= 1, 2000, 'callback to fire after file write');

    expect(calls).toContain('file-changed-callback');
  });

  // ─── Test 2: Debounce coalesces rapid writes ────────────────────────────────

  it('debounce coalesces rapid file writes into fewer callbacks', async () => {
    const tmpDir = await makeTmpDir();
    tmpDirs.push(tmpDir);

    const watchFile = path.join(tmpDir, 'debounce.txt');
    await fs.writeFile(watchFile, 'v0');

    let callCount = 0;
    const submitter = async () => {
      callCount++;
      return 'ok';
    };

    const manager = new RoutineManager(submitter, tmpDir, 30);
    managers.push(manager);

    manager.watchRoutine({
      routine: {
        name: 'debounce-test',
        trigger: 'file_change',
        watch_path: watchFile,
        debounce: '100ms',
      },
      task: { prompt: 'debounced' },
    });

    // Baseline mtime
    await new Promise((r) => setTimeout(r, 80));

    // Write 5 times within ~50ms total — all within the 100ms debounce window
    for (let i = 1; i <= 5; i++) {
      await fs.writeFile(watchFile, `v${i}`);
      await new Promise((r) => setTimeout(r, 10));
    }

    // Wait for debounce window + buffer to flush
    await new Promise((r) => setTimeout(r, 250));

    // Debounce should coalesce: expect fewer calls than writes
    // (In practice the poller may fire once per 30ms poll tick, but the
    // debounce gate should block most of them.)
    expect(callCount).toBeGreaterThan(0);
    expect(callCount).toBeLessThan(5);
  });

  // ─── Test 3: stopAll() tears down watchers, no callbacks after stop ─────────

  it('stopAll() tears down watchers and no callbacks fire after stop', async () => {
    const tmpDir = await makeTmpDir();
    tmpDirs.push(tmpDir);

    const watchFile = path.join(tmpDir, 'stop-test.txt');
    await fs.writeFile(watchFile, 'initial');

    let callCount = 0;
    const submitter = async () => {
      callCount++;
      return 'ok';
    };

    const manager = new RoutineManager(submitter, tmpDir, 30);
    managers.push(manager);

    manager.watchRoutine({
      routine: {
        name: 'stop-test',
        trigger: 'file_change',
        watch_path: watchFile,
      },
      task: { prompt: 'should-not-fire-after-stop' },
    });

    expect(manager.watchedCount).toBe(1);

    // Baseline
    await new Promise((r) => setTimeout(r, 80));

    // Stop before any file write
    manager.stopAll();

    expect(manager.watchedCount).toBe(0);

    // Write a file after stopping
    await fs.writeFile(watchFile, 'written-after-stop');

    // Wait to confirm nothing fires
    await new Promise((r) => setTimeout(r, 150));

    expect(callCount).toBe(0);
  });

  // ─── Test 4: cron routine still works alongside file_change routine ──────────

  it('cron routine coexists with file_change routine independently', async () => {
    const tmpDir = await makeTmpDir();
    tmpDirs.push(tmpDir);

    const watchFile = path.join(tmpDir, 'coexist.txt');
    await fs.writeFile(watchFile, 'init');

    const fileCallPrompts: string[] = [];
    const submitter = async (opts: { prompt: string }) => {
      fileCallPrompts.push(opts.prompt);
      return 'ok';
    };

    const manager = new RoutineManager(submitter, tmpDir, 30);
    managers.push(manager);

    // Register a cron routine (1-minute schedule, won't fire during test)
    manager.scheduleRoutine({
      routine: { name: 'cron-coexist', schedule: '* * * * *' },
      task: { prompt: 'cron-task' },
    });

    // Register a file_change routine
    manager.watchRoutine({
      routine: {
        name: 'file-coexist',
        trigger: 'file_change',
        watch_path: watchFile,
      },
      task: { prompt: 'file-task' },
    });

    // Both should be registered without interfering
    expect(manager.scheduledCount).toBe(1);
    expect(manager.watchedCount).toBe(1);

    // Baseline mtime
    await new Promise((r) => setTimeout(r, 80));

    // Trigger the file watcher
    await fs.writeFile(watchFile, 'changed');

    // Wait for the file callback to fire
    await waitFor(
      () => fileCallPrompts.includes('file-task'),
      2000,
      'file-task callback to fire',
    );

    // File task fired; cron task did NOT fire (schedule is 1 min away)
    expect(fileCallPrompts).toContain('file-task');
    expect(fileCallPrompts).not.toContain('cron-task');

    // Counts remain consistent until explicit stop
    expect(manager.scheduledCount).toBe(1);
    expect(manager.watchedCount).toBe(1);

    manager.stopAll();

    expect(manager.scheduledCount).toBe(0);
    expect(manager.watchedCount).toBe(0);
  });
});
