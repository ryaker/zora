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
});
