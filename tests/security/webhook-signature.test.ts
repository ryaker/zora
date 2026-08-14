/**
 * INVARIANT-10 — the webhook server authenticates before it dispatches.
 *
 * The invariant is not "a signature is checked somewhere" but "nothing reaches
 * an adapter until it authenticates". So the assertion that matters in almost
 * every case below is that the adapter was **not called**: a 401 with the
 * payload already delivered would satisfy a status-code-only test while
 * breaking the actual property.
 *
 * These run over a real listening Express server rather than by calling the
 * route handler directly, because the raw-body capture, the JSON body parser
 * and the header casing are all part of what is under test — a hand-built
 * context object would skip exactly the layer that decides whether a body can
 * be authenticated at all.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebhookServer } from '../../src/channels/webhook-server.js';
import {
  WebhookValidatorRegistry,
  createTelegramValidator,
  timingSafeEqualString,
  TELEGRAM_SECRET_TOKEN_HEADER,
} from '../../src/channels/webhook-signatures.js';
import type { ChannelManager } from '../../src/channels/channel-manager.js';
import type { IChannelAdapter } from '../../src/channels/channel-adapter.js';

const SECRET = 'test-secret-token_123';

/** Records every webhook delivery that reached the adapter. */
interface SpyAdapter extends IChannelAdapter {
  deliveries: string[];
}

function spyAdapter(name: string, opts: { acceptsWebhooks?: boolean } = {}): SpyAdapter {
  const deliveries: string[] = [];
  const adapter = {
    name,
    deliveries,
    start: async () => {},
    stop: async () => {},
    onMessage: () => {},
    send: async () => {},
  } as unknown as SpyAdapter;

  if (opts.acceptsWebhooks !== false) {
    adapter.handleWebhook = async (request: Request): Promise<Response> => {
      deliveries.push(await request.text());
      return new Response('OK', { status: 200 });
    };
  }
  return adapter;
}

describe('INVARIANT-10 — webhook signature validation', () => {
  let server: WebhookServer | null = null;
  let adapter: SpyAdapter;
  let baseUrl: string;

  /** Boots a server on an ephemeral port with the given validator set. */
  async function boot(validators: WebhookValidatorRegistry, adapters: SpyAdapter[]): Promise<void> {
    const manager = {
      getAdapter: (name: string) => adapters.find((a) => a.name === name),
    } as unknown as ChannelManager;

    server = new WebhookServer(manager, validators, 0);
    await server.start();
    baseUrl = `http://127.0.0.1:${server.address()}`;
  }

  function post(
    platform: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    return fetch(`${baseUrl}/webhooks/${platform}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  beforeEach(async () => {
    adapter = spyAdapter('telegram');
    const validators = new WebhookValidatorRegistry();
    validators.register(createTelegramValidator(SECRET));
    await boot(validators, [adapter]);
  });

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  it('dispatches a correctly signed webhook, with the body intact', async () => {
    const update = { update_id: 1, message: { text: 'hello' } };
    const res = await post('telegram', update, { [TELEGRAM_SECRET_TOKEN_HEADER]: SECRET });

    expect(res.status).toBe(200);
    expect(adapter.deliveries).toHaveLength(1);
    // The adapter must see the bytes that were validated, not a re-serialisation.
    expect(JSON.parse(adapter.deliveries[0]!)).toEqual(update);
  });

  it('refuses a webhook with no secret-token header, without dispatching', async () => {
    const res = await post('telegram', { update_id: 2 });

    expect(res.status).toBe(401);
    expect(adapter.deliveries, 'an unauthenticated payload reached the adapter').toEqual([]);
  });

  it('refuses a webhook with the wrong secret token, without dispatching', async () => {
    const res = await post('telegram', { update_id: 3 }, {
      [TELEGRAM_SECRET_TOKEN_HEADER]: 'not-the-secret',
    });

    expect(res.status).toBe(401);
    expect(adapter.deliveries).toEqual([]);
  });

  /**
   * A near-miss rather than a wholly different value: a prefix match is what an
   * attacker probing a token one byte at a time actually sends.
   */
  it('refuses a token that is a prefix of the real one', async () => {
    const res = await post('telegram', { update_id: 4 }, {
      [TELEGRAM_SECRET_TOKEN_HEADER]: SECRET.slice(0, -1),
    });

    expect(res.status).toBe(401);
    expect(adapter.deliveries).toEqual([]);
  });

  it('refuses a body that is not JSON, so cannot be authenticated', async () => {
    // No raw body is captured for a non-JSON content type, so there is nothing
    // to validate. That must read as unauthenticated, not as an empty payload.
    const res = await fetch(`${baseUrl}/webhooks/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', [TELEGRAM_SECRET_TOKEN_HEADER]: SECRET },
      body: 'update_id=5',
    });

    expect(res.status).toBe(401);
    expect(adapter.deliveries).toEqual([]);
  });

  it('serves health without authentication', async () => {
    // The liveness probe is the one route that must answer unauthenticated —
    // and it must not be a way to reach an adapter.
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    expect(adapter.deliveries).toEqual([]);
  });
});

describe('INVARIANT-10 — fail-closed defaults', () => {
  let server: WebhookServer | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  async function bootWith(adapters: SpyAdapter[], validators: WebhookValidatorRegistry): Promise<string> {
    const manager = {
      getAdapter: (name: string) => adapters.find((a) => a.name === name),
    } as unknown as ChannelManager;
    server = new WebhookServer(manager, validators, 0);
    await server.start();
    return `http://127.0.0.1:${server.address()}`;
  }

  /**
   * The case that matters most: an adapter is registered and reachable, and no
   * validator exists for it. Signal is exactly this — signal-cli delivers over
   * a local intake process, so no signature could authenticate a webhook for
   * it. Registering an adapter must not open an unauthenticated route.
   */
  it('refuses a platform that has an adapter but no validator', async () => {
    const signal = spyAdapter('signal');
    const url = await bootWith([signal], new WebhookValidatorRegistry());

    const res = await fetch(`${url}/webhooks/signal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spoofed: true }),
    });

    // 401, not a distinguishable "not configured" — see the indistinguishability
    // test below. The invariant that matters is unchanged: nothing dispatched.
    expect(res.status).toBe(401);
    expect(signal.deliveries, 'a platform with no validator dispatched anyway').toEqual([]);
  });

  it('refuses an unknown platform without revealing whether it exists', async () => {
    const validators = new WebhookValidatorRegistry();
    validators.register(createTelegramValidator(SECRET));
    const url = await bootWith([spyAdapter('telegram')], validators);

    // 'telegram' with a bad token and 'nonexistent' must be indistinguishable
    // to an unauthenticated caller, or the endpoint becomes a registry oracle.
    const unknown = await fetch(`${url}/webhooks/nonexistent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const badToken = await fetch(`${url}/webhooks/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [TELEGRAM_SECRET_TOKEN_HEADER]: 'wrong' },
      body: '{}',
    });

    // Review finding on #179: these used to be 501 and 401, so an
    // unauthenticated caller could walk the validator registry one platform at
    // a time and learn which are configured. Identical now — status and body.
    expect(unknown.status).toBe(401);
    expect(badToken.status).toBe(401);
    expect(await unknown.text()).toBe(await badToken.text());
  });

  it('answers 501 when an authenticated platform cannot take webhook delivery', async () => {
    const validators = new WebhookValidatorRegistry();
    validators.register(createTelegramValidator(SECRET));
    const noWebhooks = spyAdapter('telegram', { acceptsWebhooks: false });
    const url = await bootWith([noWebhooks], validators);

    const res = await fetch(`${url}/webhooks/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [TELEGRAM_SECRET_TOKEN_HEADER]: SECRET },
      body: '{}',
    });

    expect(res.status).toBe(501);
  });
});

describe('INVARIANT-10 — validator construction and comparison', () => {
  /**
   * Telegram's documented constraint on secret_token is 1-256 characters of
   * A-Z, a-z, 0-9, `_` and `-`. A secret outside that set can never appear in a
   * genuine request, because `setWebhook` would not accept it — so every
   * webhook would be rejected and the symptom would be "Telegram stopped
   * working", not "the secret is invalid".
   */
  it('rejects a secret token Telegram itself would refuse', () => {
    expect(() => createTelegramValidator('')).toThrow(/1-256 characters/);
    expect(() => createTelegramValidator('has spaces')).toThrow(/1-256 characters/);
    expect(() => createTelegramValidator('emoji-🔑')).toThrow(/1-256 characters/);
    expect(() => createTelegramValidator('a'.repeat(257))).toThrow(/1-256 characters/);
  });

  it('accepts the full documented character set and length range', () => {
    expect(() => createTelegramValidator('a')).not.toThrow();
    expect(() => createTelegramValidator('A-Z_az-09')).not.toThrow();
    expect(() => createTelegramValidator('x'.repeat(256))).not.toThrow();
  });

  it('compares equal and unequal strings correctly, whatever their lengths', () => {
    expect(timingSafeEqualString('abc', 'abc')).toBe(true);
    expect(timingSafeEqualString('', '')).toBe(true);
    expect(timingSafeEqualString('abc', 'abd')).toBe(false);
    // crypto.timingSafeEqual throws on length mismatch; hashing first is what
    // keeps this a false rather than an exception, and hides the real length.
    expect(timingSafeEqualString('abc', 'abcdefghijk')).toBe(false);
    expect(timingSafeEqualString('', 'x')).toBe(false);
  });
});
