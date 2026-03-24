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

describe('RoutineManager', () => {
  const testDir = path.join(os.tmpdir(), 'zora-routines-test');
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

    // Allow polling to baseline mtimes
    await new Promise((r) => setTimeout(r, 80));
    await fs.writeFile(watchFile, 'changed');

    // Wait up to 2s for the callback rather than sleeping a fixed duration
    const deadline = Date.now() + 2000;
    while (submitTaskMock.mock.calls.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }

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

    // Allow polling to baseline
    await new Promise((r) => setTimeout(r, 80));
    await fs.writeFile(watchFile, 'v1');

    // Wait up to 2s for the callback rather than sleeping a fixed duration
    const deadline = Date.now() + 2000;
    while (submitTaskMock.mock.calls.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }

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

    await new Promise((r) => setTimeout(r, 80));
    await fs.writeFile(watchFile, 'changed');

    // Wait up to 2s for the callback rather than sleeping a fixed duration
    const deadline = Date.now() + 2000;
    while (submitTaskMock.mock.calls.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(submitTaskMock).toHaveBeenCalledWith({
      prompt: 'free event task',
      model: 'ollama',
      maxCostTier: 'free',
    });

    manager.stopAll();
  });
});
