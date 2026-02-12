import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionLoop } from '../../../src/orchestrator/execution-loop.js';
import { SessionManager } from '../../../src/orchestrator/session-manager.js';
import { PolicyEngine } from '../../../src/security/policy-engine.js';
import { MockProvider } from '../../fixtures/mock-provider.js';
import type { TaskContext } from '../../../src/types.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('ExecutionLoop', () => {
  const testDir = path.join(os.tmpdir(), 'zora-loop-test');
  let loop: ExecutionLoop;
  let provider: MockProvider;
  let manager: SessionManager;
  let engine: PolicyEngine;

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    
    provider = new MockProvider({ name: 'mock', rank: 1 });
    engine = new PolicyEngine({
      filesystem: { allowed_paths: [os.tmpdir()], denied_paths: [], resolve_symlinks: true, follow_symlinks: false },
      shell: { mode: 'deny_all', allowed_commands: [], denied_commands: [], split_chained_commands: true, max_execution_time: '1m' },
      actions: { reversible: [], irreversible: [], always_flag: [] },
      network: { allowed_domains: [], denied_domains: [], max_request_size: '1mb' },
    });
    manager = new SessionManager(testDir);
    loop = new ExecutionLoop({ provider, engine, sessionManager: manager });
  });

  const task: TaskContext = {
    jobId: 'loop-job-1',
    task: 'Say hello',
    requiredCapabilities: [],
    complexity: 'simple',
    resourceType: 'creative',
    systemPrompt: '',
    memoryContext: [],
    history: [],
  };

  it('runs a task to completion and persists events', async () => {
    await loop.run(task);

    const history = await manager.getHistory('loop-job-1');
    // MockProvider yields: thinking, text, done
    expect(history).toHaveLength(3);
    expect(history[0]!.type).toBe('thinking');
    expect(history[1]!.type).toBe('text');
    expect(history[2]!.type).toBe('done');
  });

  it('respects max turns', async () => {
    // Override max turns to 1
    loop = new ExecutionLoop({ provider, engine, sessionManager: manager, maxTurns: 1 });
    
    await loop.run(task);

    const history = await manager.getHistory('loop-job-1');
    // Should have: thinking, then error (max turns)
    expect(history.some(e => e.type === 'error' && (e.content as any).message.includes('Maximum turns'))).toBe(true);
  });

  it('handles tool calls through the loop', async () => {
    // Configure mock to yield a tool call
    provider.setMockEvents([
      { type: 'tool_call', timestamp: new Date(), content: { tool: 'read_file', arguments: { path: '/tmp/test.txt' }, toolCallId: 'c1' } },
      { type: 'done', timestamp: new Date(), content: { text: 'Done' } }
    ]);

    // Mock the fs tool call inside loop (since /tmp/test.txt might not exist)
    // Actually, let's just check if it records the tool_result
    
    await loop.run(task);
    
    const history = await manager.getHistory('loop-job-1');
    expect(history.some(e => e.type === 'tool_result')).toBe(true);
  });
});
