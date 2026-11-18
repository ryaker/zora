import { describe, it, expect, vi } from 'vitest';
import { OpenAIProvider, OPENAI_DEFAULT_MODEL } from '../../../src/providers/openai-provider.js';
import type { ProviderConfig, TaskContext, AgentEvent } from '../../../src/types.js';

const KEY = 'sk-test-secret-value';

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    name: 'openai',
    type: 'openai',
    rank: 3,
    capabilities: ['reasoning', 'coding'],
    cost_tier: 'metered',
    enabled: true,
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    jobId: 'job-1',
    task: 'Say hello',
    requiredCapabilities: [],
    complexity: 'simple',
    resourceType: 'reasoning',
    systemPrompt: 'You are helpful.',
    memoryContext: ['likes tea'],
    history: [],
    ...overrides,
  };
}

function sse(lines: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(lines.join('\n') + '\n'));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

const delta = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}`;
const usage = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } })}`;

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function make(fetchFn: typeof fetch, config = makeConfig(), env: NodeJS.ProcessEnv = { OPENAI_API_KEY: KEY }) {
  return new OpenAIProvider({ config, fetchFn, env });
}

describe('OpenAIProvider', () => {
  it('initializes from config', () => {
    const p = make(vi.fn() as unknown as typeof fetch);
    expect(p.name).toBe('openai');
    expect(p.rank).toBe(3);
    expect(p.costTier).toBe('metered');
  });

  describe('availability / auth', () => {
    it('is unavailable when disabled', async () => {
      const p = make(vi.fn() as unknown as typeof fetch, makeConfig({ enabled: false }));
      expect(await p.isAvailable()).toBe(false);
    });

    it('is unavailable without a key, and makes no network call checking', async () => {
      const f = vi.fn();
      const p = make(f as unknown as typeof fetch, makeConfig(), {});
      expect(await p.isAvailable()).toBe(false);
      expect(f).not.toHaveBeenCalled();
    });

    it('reads the key from the env var named by api_key_env', async () => {
      const p = make(vi.fn() as unknown as typeof fetch, makeConfig({ api_key_env: 'ZORA_RUNTIME_OPENAI_KEY' }), {
        ZORA_RUNTIME_OPENAI_KEY: KEY,
      });
      expect((await p.checkAuth()).valid).toBe(true);
    });

    it('rejects a cleartext non-loopback endpoint', async () => {
      const f = vi.fn();
      const p = make(f as unknown as typeof fetch, makeConfig({ endpoint: 'http://evil.example/v1' }));
      expect((await p.checkAuth()).valid).toBe(false);
      const events = await collect(p.execute(makeTask()));
      expect(events[0]!.type).toBe('error');
      expect(f).not.toHaveBeenCalled();
    });

    it('allows loopback http for a local gateway', async () => {
      const p = make(vi.fn() as unknown as typeof fetch, makeConfig({ endpoint: 'http://localhost:8080/v1' }));
      expect((await p.checkAuth()).valid).toBe(true);
    });
  });

  describe('execute', () => {
    it('streams text, reports usage, and sends the default model and bearer key', async () => {
      const f = vi.fn().mockResolvedValue(sse([delta('Hel'), delta('lo'), usage, 'data: [DONE]']));
      const p = make(f as unknown as typeof fetch);
      const events = await collect(p.execute(makeTask()));

      expect(events.filter((e) => e.type === 'text').map((e) => (e.content as { text: string }).text)).toEqual(['Hel', 'lo']);
      const done = events.at(-1)!;
      expect(done.type).toBe('done');
      expect((done.content as { text: string }).text).toBe('Hello');
      expect(p.getUsage()).toMatchObject({ totalInputTokens: 7, totalOutputTokens: 3, requestCount: 1 });

      const [url, init] = f.mock.calls[0]!;
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe(OPENAI_DEFAULT_MODEL);
      expect(body.stream).toBe(true);
      expect(body.messages[0].content).toContain('<memory_context>');
      expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'Say hello' });
    });

    it('uses config.model when set', async () => {
      const f = vi.fn().mockResolvedValue(sse(['data: [DONE]']));
      await collect(make(f as unknown as typeof fetch, makeConfig({ model: 'gpt-6.2-astra' })).execute(makeTask()));
      expect(JSON.parse(f.mock.calls[0]![1].body as string).model).toBe('gpt-6.2-astra');
    });

    it('never sends tools and never emits tool_call events (text-only, enforcement chain untouched)', async () => {
      const toolish = `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ function: { name: 'Bash' } }] } }] })}`;
      const f = vi.fn().mockResolvedValue(sse([toolish, delta('ok'), 'data: [DONE]']));
      const events = await collect(make(f as unknown as typeof fetch).execute(makeTask()));
      const body = JSON.parse(f.mock.calls[0]![1].body as string);
      expect(body.tools).toBeUndefined();
      expect(body.functions).toBeUndefined();
      expect(events.some((e) => e.type === 'tool_call')).toBe(false);
    });

    it('errors without calling the API when no key is set', async () => {
      const f = vi.fn();
      const events = await collect(make(f as unknown as typeof fetch, makeConfig(), {}).execute(makeTask()));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('error');
      expect((events[0]!.content as { isAuthError?: boolean }).isAuthError).toBe(true);
      expect(f).not.toHaveBeenCalled();
    });

    it('marks 401 as an auth error, stops routing, and does not trip the breaker', async () => {
      const f = vi.fn().mockResolvedValue(new Response('bad key', { status: 401 }));
      const p = make(f as unknown as typeof fetch);
      const events = await collect(p.execute(makeTask()));
      expect((events[0]!.content as { isAuthError?: boolean }).isAuthError).toBe(true);
      expect(await p.isAvailable()).toBe(false);
      expect(p.circuitBreaker.getState()).toBe('CLOSED');
    });

    it('marks 429 as a quota error with a cooldown', async () => {
      const f = vi.fn().mockResolvedValue(new Response('slow down', { status: 429, headers: { 'retry-after': '60' } }));
      const p = make(f as unknown as typeof fetch);
      const events = await collect(p.execute(makeTask()));
      expect((events[0]!.content as { isQuotaError?: boolean }).isQuotaError).toBe(true);
      const q = await p.getQuotaStatus();
      expect(q.isExhausted).toBe(true);
      expect(q.cooldownUntil).not.toBeNull();
    });

    it('records 5xx and network failures on the circuit breaker, then rejects when OPEN', async () => {
      const f = vi.fn().mockRejectedValue(new Error('boom'));
      const p = make(f as unknown as typeof fetch);
      for (let i = 0; i < 10 && p.circuitBreaker.getState() !== 'OPEN'; i++) {
        await collect(p.execute(makeTask({ jobId: `j${i}` })));
      }
      expect(p.circuitBreaker.getState()).toBe('OPEN');
      const events = await collect(p.execute(makeTask({ jobId: 'later' })));
      expect((events[0]!.content as { isCircuitOpen?: boolean }).isCircuitOpen).toBe(true);
    });

    it('treats a stream cut off before [DONE] as an error, not a completion', async () => {
      const f = vi.fn().mockResolvedValue(sse([delta('partial')]));
      const events = await collect(make(f as unknown as typeof fetch).execute(makeTask()));
      expect(events.at(-1)!.type).toBe('error');
      expect(events.some((e) => e.type === 'done')).toBe(false);
    });

    it('skips malformed chunks and keeps going', async () => {
      const f = vi.fn().mockResolvedValue(sse(['data: {not json', delta('ok'), 'data: [DONE]']));
      const events = await collect(make(f as unknown as typeof fetch).execute(makeTask()));
      expect((events.at(-1)!.content as { text: string }).text).toBe('ok');
    });

    it('never relays remote error bodies or exception text: key echoed upstream stays out of events and logs', async () => {
      const logs: string[] = [];
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => (logs.push(String(c)), true));
      const f = vi.fn().mockResolvedValue(new Response(`Incorrect API key provided: ${KEY}`, { status: 500 }));
      const events = await collect(make(f as unknown as typeof fetch).execute(makeTask()));
      const g = vi.fn().mockRejectedValue(new Error(`request to https://x failed, Authorization: Bearer ${KEY}`));
      events.push(...(await collect(make(g as unknown as typeof fetch).execute(makeTask()))));
      const h = vi.fn().mockResolvedValue(sse([`data: {broken ${KEY}`, 'data: [DONE]']));
      events.push(...(await collect(make(h as unknown as typeof fetch).execute(makeTask()))));
      spy.mockRestore();
      expect(JSON.stringify(events)).not.toContain(KEY);
      expect(logs.join('')).not.toContain(KEY);
      expect(events[0]!.content).toMatchObject({ message: 'OpenAI API error 500', httpStatus: 500 });
    });

    it('refuses redirects so the key and task data cannot leave the validated endpoint', async () => {
      const f = vi.fn().mockResolvedValue(sse(['data: [DONE]']));
      await collect(make(f as unknown as typeof fetch).execute(makeTask()));
      expect(f.mock.calls[0]![1].redirect).toBe('error');
    });

    it('does not call the API again with a rejected key, and recovers when the key is rotated', async () => {
      const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: KEY };
      const f = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValue(sse(['data: [DONE]']));
      const p = make(f as unknown as typeof fetch, makeConfig(), env);
      await collect(p.execute(makeTask()));
      expect(await p.isAvailable()).toBe(false);
      const again = await collect(p.execute(makeTask({ jobId: 'j2' })));
      expect(again[0]!.type).toBe('error');
      expect(f).toHaveBeenCalledTimes(1);
      env.OPENAI_API_KEY = 'sk-rotated';
      expect(await p.isAvailable()).toBe(true);
      expect((await collect(p.execute(makeTask({ jobId: 'j3' }))))!.at(-1)!.type).toBe('done');
    });

    it('enforces the 429 cooldown in isAvailable() and execute(), and clears it on expiry', async () => {
      vi.useFakeTimers();
      try {
        const f = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '60' } })).mockResolvedValue(sse(['data: [DONE]']));
        const p = make(f as unknown as typeof fetch);
        await collect(p.execute(makeTask()));
        expect(await p.isAvailable()).toBe(false);
        const blocked = await collect(p.execute(makeTask({ jobId: 'j2' })));
        expect((blocked[0]!.content as { isQuotaError?: boolean }).isQuotaError).toBe(true);
        expect(f).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(61_000);
        expect(await p.isAvailable()).toBe(true);
        expect((await collect(p.execute(makeTask({ jobId: 'j3' }))))!.at(-1)!.type).toBe('done');
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not count 401/403/429 or ordinary 4xx toward the breaker', async () => {
      for (const status of [400, 401, 403, 404, 422, 429]) {
        const p = make(vi.fn().mockResolvedValue(new Response('', { status })) as unknown as typeof fetch);
        const spy = vi.spyOn(p.circuitBreaker, 'recordFailure');
        await collect(p.execute(makeTask()));
        expect(spy, `status ${status}`).not.toHaveBeenCalled();
      }
    });

    it('counts 5xx responses and transport failures toward the breaker', async () => {
      for (const make_ of [
        () => vi.fn().mockResolvedValue(new Response('', { status: 503 })),
        () => vi.fn().mockRejectedValue(new Error('net down')),
      ]) {
        const p = make(make_() as unknown as typeof fetch);
        const spy = vi.spyOn(p.circuitBreaker, 'recordFailure');
        await collect(p.execute(makeTask()));
        expect(spy).toHaveBeenCalledTimes(1);
      }
    });

    it('abort() ends an in-flight request with an aborted done event', async () => {
      const f = vi.fn().mockImplementation(
        (_u: string, init: RequestInit) =>
          new Promise((_res, rej) => {
            init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          }),
      );
      const p = make(f as unknown as typeof fetch);
      const pending = collect(p.execute(makeTask()));
      await new Promise((r) => setTimeout(r, 5));
      await p.abort('job-1');
      const events = await pending;
      expect((events.at(-1)!.content as { aborted?: boolean }).aborted).toBe(true);
    });
  });
});
