import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoutineManager, type RoutineTaskSubmitter } from '../../../src/routines/routine-manager.js';
import type { RoutineDefinition } from '../../../src/types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const { mockWarn } = vi.hoisted(() => {
  const mockWarn = vi.fn();
  return { mockWarn };
});

vi.mock('../../../src/utils/logger.js', () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mockWarn,
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return {
    createLogger: vi.fn(() => mockLogger),
    getLogger: vi.fn(() => mockLogger),
    initLogger: vi.fn(() => mockLogger),
    resetLogger: vi.fn(),
    logger: mockLogger,
  };
});

/**
 * TEST-20: rewrite the watched file until the routine fires.
 *
 * The file watcher only reports a change once it has a previous mtime to
 * compare against, and it records that baseline on its first poll. Sleeping 80
 * ms and writing once assumes the baseline poll won that race — when it does
 * not, the write silently *becomes* the baseline, no change is ever reported,
 * and the (correctly deadline-bounded) wait that follows spins out and fails.
 * Rewriting until the routine fires removes the ordering assumption.
 */
async function touchUntilFired(
  filePath: string,
  fired: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let n = 0;
  while (!fired()) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${filePath} change to fire`);
    }
    await fs.writeFile(filePath, `change-${n++}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('RoutineManager', () => {
  // TEST-20: this was the fixed path `${tmpdir}/zora-routines-test`, shared by
  // every process on the machine. `beforeEach` rm -rf's it, so a second vitest
  // run — a parallel CI job, a second checkout, another agent's worktree —
  // deletes the directory out from under a test that is mid-write, which shows
  // up as an ENOENT on a file the test just created. Observed exactly that
  // while stress-running the suite alongside other work on the same box.
  const testDir = path.join(
    os.tmpdir(),
    `zora-routines-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  );
  let manager: RoutineManager;
  let submitTaskMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
    await fs.mkdir(testDir, { recursive: true });

    submitTaskMock = vi.fn().mockResolvedValue('Task completed');
    manager = new RoutineManager(submitTaskMock, testDir);
  });

  afterEach(async () => {
    manager.stopAll();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('loads and schedules routines from TOML', async () => {
    const routinePath = path.join(testDir, 'routines', 'test.toml');
    await fs.mkdir(path.dirname(routinePath), { recursive: true });
    await fs.writeFile(routinePath, `
[routine]
name = "test-routine"
schedule = "* * * * *"
enabled = true

[task]
prompt = "say hello"
    `, 'utf8');

    await manager.init();
    expect(manager.scheduledCount).toBe(1);
  });

  it('stops all tasks', async () => {
    manager.scheduleRoutine({
      routine: { name: 'r1', schedule: '* * * * *' },
      task: { prompt: 'p1' },
    });
    expect(manager.scheduledCount).toBe(1);
    manager.stopAll();
    expect(manager.scheduledCount).toBe(0);
  });

  it('passes model_preference to submitTask via runRoutine', async () => {
    const definition: RoutineDefinition = {
      routine: { name: 'r-model', schedule: '* * * * *', model_preference: 'claude-haiku' },
      task: { prompt: 'generate content' },
    };

    await manager.runRoutine(definition);

    expect(submitTaskMock).toHaveBeenCalledWith({
      prompt: 'generate content',
      model: 'claude-haiku',
      maxCostTier: undefined,
    });
  });

  it('passes max_cost_tier to submitTask via runRoutine', async () => {
    const definition: RoutineDefinition = {
      routine: { name: 'r-cost', schedule: '* * * * *', max_cost_tier: 'included' },
      task: { prompt: 'cheap task' },
    };

    await manager.runRoutine(definition);

    expect(submitTaskMock).toHaveBeenCalledWith({
      prompt: 'cheap task',
      model: undefined,
      maxCostTier: 'included',
    });
  });

  it('passes both model_preference and max_cost_tier together', async () => {
    const definition: RoutineDefinition = {
      routine: {
        name: 'r-both',
        schedule: '* * * * *',
        model_preference: 'ollama',
        max_cost_tier: 'free',
      },
      task: { prompt: 'local task' },
    };

    await manager.runRoutine(definition);

    expect(submitTaskMock).toHaveBeenCalledWith({
      prompt: 'local task',
      model: 'ollama',
      maxCostTier: 'free',
    });
  });

  it('loads routine with model_preference and max_cost_tier from TOML', async () => {
    const routinePath = path.join(testDir, 'routines', 'model-test.toml');
    await fs.mkdir(path.dirname(routinePath), { recursive: true });
    await fs.writeFile(routinePath, `
[routine]
name = "model-routine"
schedule = "* * * * *"
model_preference = "claude-haiku"
max_cost_tier = "free"

[task]
prompt = "budget task"
    `, 'utf8');

    await manager.init();
    expect(manager.scheduledCount).toBe(1);
  });

  it('warns on invalid max_cost_tier but still loads', async () => {
    mockWarn.mockClear();

    const routinePath = path.join(testDir, 'routines', 'bad-tier.toml');
    await fs.mkdir(path.dirname(routinePath), { recursive: true });
    await fs.writeFile(routinePath, `
[routine]
name = "bad-tier"
schedule = "* * * * *"
max_cost_tier = "ultra-cheap"

[task]
prompt = "test"
    `, 'utf8');

    await manager.init();
    expect(manager.scheduledCount).toBe(1);
    // After LOG-01 migration, warnings go through pino structured logger
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ costTier: 'ultra-cheap' }),
      expect.stringContaining('Invalid max_cost_tier')
    );
  });

  it('skips disabled routines', async () => {
    const routinePath = path.join(testDir, 'routines', 'disabled.toml');
    await fs.mkdir(path.dirname(routinePath), { recursive: true });
    await fs.writeFile(routinePath, `
[routine]
name = "disabled-routine"
schedule = "* * * * *"
enabled = false

[task]
prompt = "should not run"
    `, 'utf8');

    await manager.init();
    expect(manager.scheduledCount).toBe(0);
  });

  // ─── Event-triggered routine tests ───────────────────────────────────

  it('registers file_change trigger routines via watchRoutine()', async () => {
    const watchDir = path.join(testDir, 'watched');
    await fs.mkdir(watchDir, { recursive: true });
    const watchFile = path.join(watchDir, 'trigger.txt');
    await fs.writeFile(watchFile, 'initial');

    manager = new RoutineManager(submitTaskMock, testDir, 30);
    manager.watchRoutine({
      routine: { name: 'file-watcher', trigger: 'file_change', watch_path: watchFile },
      task: { prompt: 'file changed' },
    });

    expect(manager.watchedCount).toBe(1);
    expect(manager.scheduledCount).toBe(0);

    await touchUntilFired(watchFile, () => submitTaskMock.mock.calls.length > 0);

    expect(submitTaskMock).toHaveBeenCalledWith({
      prompt: 'file changed',
      model: undefined,
      maxCostTier: undefined,
    });

    manager.stopAll();
    expect(manager.watchedCount).toBe(0);
  });

  it('loads file_change routines from TOML', async () => {
    const watchDir = path.join(testDir, 'watch-dir');
    await fs.mkdir(watchDir, { recursive: true });
    const watchFile = path.join(watchDir, 'signal.txt');
    await fs.writeFile(watchFile, 'v0');

    const routinePath = path.join(testDir, 'routines', 'event-routine.toml');
    await fs.mkdir(path.dirname(routinePath), { recursive: true });
    await fs.writeFile(routinePath, `
[routine]
name = "event-routine"
trigger = "file_change"
watch_path = "${watchFile}"
debounce = "0"

[task]
prompt = "handle change"
    `, 'utf8');

    manager = new RoutineManager(submitTaskMock, testDir, 30);
    await manager.init();

    expect(manager.watchedCount).toBe(1);
    expect(manager.scheduledCount).toBe(0);

    await touchUntilFired(watchFile, () => submitTaskMock.mock.calls.length > 0);

    expect(submitTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'handle change' }),
    );
  });

  it('stopAll() clears both cron tasks and file watchers', async () => {
    manager.scheduleRoutine({
      routine: { name: 'cron-r', schedule: '* * * * *' },
      task: { prompt: 'cron' },
    });

    const watchFile = path.join(testDir, 'stop-test.txt');
    await fs.writeFile(watchFile, 'x');
    manager.watchRoutine({
      routine: { name: 'event-r', trigger: 'file_change', watch_path: watchFile },
      task: { prompt: 'event' },
    });

    expect(manager.scheduledCount).toBe(1);
    expect(manager.watchedCount).toBe(1);

    manager.stopAll();

    expect(manager.scheduledCount).toBe(0);
    expect(manager.watchedCount).toBe(0);
  });

  it('rejects file_change routine without watch_path', async () => {
    const routinePath = path.join(testDir, 'routines', 'bad-event.toml');
    await fs.mkdir(path.dirname(routinePath), { recursive: true });
    await fs.writeFile(routinePath, `
[routine]
name = "bad-event"
trigger = "file_change"

[task]
prompt = "will not register"
    `, 'utf8');

    manager = new RoutineManager(submitTaskMock, testDir, 30);
    await manager.init();

    expect(manager.watchedCount).toBe(0);
    expect(manager.scheduledCount).toBe(0);
  });

  it('passes model_preference and max_cost_tier through watchRoutine callback', async () => {
    const watchFile = path.join(testDir, 'model-trigger.txt');
    await fs.writeFile(watchFile, 'init');

    manager = new RoutineManager(submitTaskMock, testDir, 30);
    manager.watchRoutine({
      routine: {
        name: 'model-event',
        trigger: 'file_change',
        watch_path: watchFile,
        model_preference: 'ollama',
        max_cost_tier: 'free',
      },
      task: { prompt: 'free event task' },
    });

    await touchUntilFired(watchFile, () => submitTaskMock.mock.calls.length > 0);

    expect(submitTaskMock).toHaveBeenCalledWith({
      prompt: 'free event task',
      model: 'ollama',
      maxCostTier: 'free',
    });

    manager.stopAll();
  });
});
