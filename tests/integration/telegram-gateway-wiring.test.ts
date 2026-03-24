/**
 * TelegramGateway Wiring Integration Tests
 *
 * Verifies that the TelegramGateway is:
 *   1. Exported from the steering barrel (src/steering/index.ts)
 *   2. Instantiable and start()-able without a live Telegram connection
 *   3. Properly wires an ApprovalQueue via connectApprovalQueue()
 *   4. Provides an idempotent stop() that doesn't throw even when unused
 *
 * These tests do NOT make real Telegram connections.  The node-telegram-bot-api
 * module is mocked to intercept the network boundary.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

// ─── Mock the Telegram bot library ────────────────────────────────────────────
// Must be declared before any imports that transitively pull in the library.
vi.mock('node-telegram-bot-api', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
      onText: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      stopPolling: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

// ─── Imports (after mock declaration) ────────────────────────────────────────
import { TelegramGateway } from '../../src/steering/index.js';
import { SteeringManager } from '../../src/steering/steering-manager.js';
import { ApprovalQueue, DEFAULT_APPROVAL_CONFIG } from '../../src/core/approval-queue.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FAKE_TOKEN = 'fake:bot-token-for-testing';
const TEST_DIR = path.join(os.tmpdir(), 'zora-tg-wiring-test');

/** Minimal TelegramConfig satisfying the interface */
const baseTelegramConfig = {
  enabled: true,
  bot_token: FAKE_TOKEN,
  allowed_users: ['123456'],
  mode: 'polling' as const,
  // SteeringConfig fields required by TelegramConfig extends SteeringConfig
  poll_interval: '5s',
  dashboard_port: 8070,
  notify_on_flag: false,
  flag_timeout: '10m',
  auto_approve_low_risk: false,
  always_flag_irreversible: false,
};

async function makeSteeringManager(): Promise<SteeringManager> {
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
  const sm = new SteeringManager(TEST_DIR);
  await sm.init();
  return sm;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('TelegramGateway barrel export', () => {
  it('TelegramGateway is exported from steering index', () => {
    expect(TelegramGateway).toBeDefined();
    expect(typeof TelegramGateway).toBe('function'); // class is a function
  });

  it('TelegramGateway has a static create() factory method', () => {
    expect(typeof TelegramGateway.create).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('TelegramGateway.create() and start()', () => {
  let sm: SteeringManager;
  let gateway: TelegramGateway;

  beforeEach(async () => {
    sm = await makeSteeringManager();
    gateway = await TelegramGateway.create(baseTelegramConfig as any, sm);
  });

  afterEach(async () => {
    // stop() is safe to call on a freshly-created gateway (idempotent guarantee)
    await gateway.stop();
  });

  it('creates a gateway instance without throwing', () => {
    expect(gateway).toBeInstanceOf(TelegramGateway);
  });

  it('start() — calling create() succeeds with a fake bot_token (no live connection)', () => {
    // TelegramGateway.create() is the start — it instantiates the bot with polling.
    // The mock intercepts the network call, so no real Telegram connection is made.
    // This test proves the creation path through daemon.ts would not throw.
    expect(gateway).toBeDefined();
  });

  it('rejects when no bot token is available', async () => {
    const savedEnv = process.env['TELEGRAM_BOT_TOKEN'];
    delete process.env['TELEGRAM_BOT_TOKEN'];
    try {
      await expect(
        TelegramGateway.create({ ...baseTelegramConfig, bot_token: undefined } as any, sm)
      ).rejects.toThrow('TELEGRAM_BOT_TOKEN is required');
    } finally {
      if (savedEnv !== undefined) {
        process.env['TELEGRAM_BOT_TOKEN'] = savedEnv;
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('TelegramGateway.connectApprovalQueue()', () => {
  let sm: SteeringManager;
  let gateway: TelegramGateway;
  let queue: ApprovalQueue;

  beforeEach(async () => {
    sm = await makeSteeringManager();
    gateway = await TelegramGateway.create(baseTelegramConfig as any, sm);
    queue = new ApprovalQueue({ ...DEFAULT_APPROVAL_CONFIG, enabled: true });
  });

  afterEach(async () => {
    await gateway.stop();
  });

  it('connectApprovalQueue() calls queue.setSendHandler()', () => {
    const spy = vi.spyOn(queue, 'setSendHandler');

    gateway.connectApprovalQueue(queue);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.any(Function));
  });

  it('the registered send handler is a function that can be invoked', () => {
    let capturedHandler: ((msg: string) => Promise<void>) | undefined;
    vi.spyOn(queue, 'setSendHandler').mockImplementation((fn) => {
      capturedHandler = fn;
    });

    gateway.connectApprovalQueue(queue);

    expect(capturedHandler).toBeDefined();
    // Invoke the handler — with no chatIds registered, it's a no-op (no throw)
    expect(() => capturedHandler!('test approval message')).not.toThrow();
  });

  it('connectApprovalQueue() can be called multiple times without throwing', () => {
    expect(() => {
      gateway.connectApprovalQueue(queue);
      gateway.connectApprovalQueue(queue);
    }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('TelegramGateway.stop() idempotency', () => {
  let sm: SteeringManager;

  beforeEach(async () => {
    sm = await makeSteeringManager();
  });

  it('stop() does not throw when called without ever starting', async () => {
    const gateway = await TelegramGateway.create(baseTelegramConfig as any, sm);
    // Call stop immediately after create, before any polling activity
    await expect(gateway.stop()).resolves.not.toThrow();
  });

  it('stop() can be called twice in succession without throwing', async () => {
    const gateway = await TelegramGateway.create(baseTelegramConfig as any, sm);
    await expect(gateway.stop()).resolves.not.toThrow();
    await expect(gateway.stop()).resolves.not.toThrow();
  });
});
