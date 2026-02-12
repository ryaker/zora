import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HeartbeatSystem } from '../../../src/routines/heartbeat.js';
import { ExecutionLoop } from '../../../src/orchestrator/execution-loop.js';
import { SessionManager } from '../../../src/orchestrator/session-manager.js';
import { PolicyEngine } from '../../../src/security/policy-engine.js';
import { MockProvider } from '../../fixtures/mock-provider.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('HeartbeatSystem', () => {
  const testDir = path.join(os.tmpdir(), 'zora-heartbeat-test');
  let heartbeat: HeartbeatSystem;
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

    heartbeat = new HeartbeatSystem({ loop, baseDir: testDir });
  });

  afterEach(async () => {
    heartbeat.stop();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('runs pending tasks from HEARTBEAT.md and marks them done', async () => {
    const heartbeatFile = path.join(testDir, 'workspace', 'HEARTBEAT.md');
    await fs.mkdir(path.dirname(heartbeatFile), { recursive: true });
    await fs.writeFile(heartbeatFile, '# Tasks\n\n- [ ] Task 1\n- [x] Task 2\n', 'utf8');

    await heartbeat.pulse();

    const content = await fs.readFile(heartbeatFile, 'utf8');
    expect(content).toContain('- [x] Task 1');
    expect(content).toContain('- [x] Task 2');
    expect(loop.run).toHaveBeenCalledWith(expect.objectContaining({
      task: 'Task 1'
    }));
  });
});
