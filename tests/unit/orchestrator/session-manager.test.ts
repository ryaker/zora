import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../../../src/orchestrator/session-manager.js';
import type { AgentEvent } from '../../../src/types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('SessionManager', () => {
  const testDir = path.join(os.tmpdir(), 'zora-sessions-test');
  let manager: SessionManager;

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    manager = new SessionManager(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('ensures sessions directory exists', () => {
    expect(fs.existsSync(path.join(testDir, 'sessions'))).toBe(true);
  });

  it('appends and retrieves events', async () => {
    const event: AgentEvent = {
      type: 'text',
      timestamp: new Date('2026-02-11T10:00:00Z'),
      content: { text: 'Hello world' },
    };

    await manager.appendEvent('job-1', event);
    const history = await manager.getHistory('job-1');

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      type: 'text',
      content: { text: 'Hello world' },
    });
    // Date might need string conversion check depending on JSON.parse
    expect(new Date(history[0]!.timestamp).toISOString()).toBe(event.timestamp.toISOString());
  });

  it('skips corrupted lines in history', async () => {
    const sessionPath = path.join(testDir, 'sessions', 'corrupt-job.jsonl');
    const validEvent = { type: 'text', timestamp: new Date(), content: { text: 'valid' } };
    
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, 
      JSON.stringify(validEvent) + '\n' + 
      '{"invalid": json}\n' + 
      JSON.stringify(validEvent) + '\n'
    );

    const history = await manager.getHistory('corrupt-job');
    expect(history).toHaveLength(2);
    expect(history[0]!.content).toEqual({ text: 'valid' });
    expect(history[1]!.content).toEqual({ text: 'valid' });
  });

  it('handles non-existent sessions gracefully', async () => {
    const history = await manager.getHistory('ghost-job');
    expect(history).toEqual([]);
  });

  it('sanitizes jobIds for file paths', async () => {
    const event: AgentEvent = { type: 'done', timestamp: new Date(), content: {} };
    await manager.appendEvent('../../etc/passwd', event);
    
    const sessions = await fs.promises.readdir(path.join(testDir, 'sessions'));
    expect(sessions[0]).not.toContain('..');
    expect(sessions[0]).toBe('______etc_passwd.jsonl');
  });
});
