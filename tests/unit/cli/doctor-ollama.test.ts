import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectOllama } from '../../../src/cli/doctor.js';

describe('detectOllama (#249)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns installed models when the daemon answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ models: [{ name: 'qwen3:14b' }] }) })));
    expect(await detectOllama('localhost:11434')).toEqual({ found: true, endpoint: 'http://localhost:11434', models: ['qwen3:14b'] });
  });

  it('never throws when the daemon is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect((await detectOllama('http://localhost:1')).found).toBe(false);
  });
});
