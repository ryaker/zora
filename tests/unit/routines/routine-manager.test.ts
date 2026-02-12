import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoutineManager } from '../../../src/routines/routine-manager.js';
import { ExecutionLoop } from '../../../src/orchestrator/execution-loop.js';
import { SessionManager } from '../../../src/orchestrator/session-manager.js';
import { PolicyEngine } from '../../../src/security/policy-engine.js';
import { MockProvider } from '../../fixtures/mock-provider.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('RoutineManager', () => {
  const testDir = path.join(os.tmpdir(), 'zora-routines-test');
  let manager: RoutineManager;
  let loop: ExecutionLoop;

  beforeEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
    await fs.mkdir(testDir, { recursive: true });

    const provider = new MockProvider();
    const engine = new PolicyEngine({
      filesystem: { allowed_paths: [], denied_paths: [], resolve_symlinks: true, follow_symlinks: false },
      shell: { mode: 'deny_all', allowed_commands: [], denied_commands: [], split_chained_commands: true, max_execution_time: '1m' },
      actions: { reversible: [], irreversible: [], always_flag: [] },
      network: { allowed_domains: [], denied_domains: [], max_request_size: '1mb' },
    });
    const sessionManager = new SessionManager(testDir);
    loop = new ExecutionLoop({ provider, engine, sessionManager });
    vi.spyOn(loop, 'run').mockResolvedValue(undefined);

    manager = new RoutineManager(loop, testDir);
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
      task: { prompt: 'p1' }
    });
    expect(manager.scheduledCount).toBe(1);
    manager.stopAll();
    expect(manager.scheduledCount).toBe(0);
  });
});
