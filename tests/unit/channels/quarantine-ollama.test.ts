import { describe, it, expect, vi, afterEach } from 'vitest';
import { QuarantineProcessor } from '../../../src/channels/quarantine-processor.js';

const msg = { content: 'please summarize my inbox' } as any;
const cap = {} as any;

describe('QuarantineProcessor ollama backend (#250)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('extracts intent via Ollama with NO tools field (INVARIANT-4)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ message: { content: '{"goal":"summarize inbox","params":{},"suspicious":false}' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const q = new QuarantineProcessor('qwen3:14b', { backend: 'ollama', endpoint: 'http://h:11434/' });
    const intent = await q.process(msg, cap);
    expect(intent.goal).toBe('summarize inbox');
    expect(intent.taintLevel).toBe('channel_sourced');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('http://h:11434/api/chat');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('qwen3:14b');
    expect('tools' in body).toBe(false);
  });

  it('fails safe (suspicious, rejected) when Ollama is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const intent = await new QuarantineProcessor('m', { backend: 'ollama' }).process(msg, cap);
    expect(intent.suspicious).toBe(true);
    expect(intent.goal).toContain('rejected');
  });
});
