import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TelegramGateway } from '../../../src/steering/telegram-gateway.js';
import { SteeringManager } from '../../../src/steering/steering-manager.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

// Mock TelegramBot
vi.mock('node-telegram-bot-api', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
      onText: vi.fn(),
      sendMessage: vi.fn(),
      stopPolling: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe('TelegramGateway', () => {
  const testDir = path.join(os.tmpdir(), 'zora-tg-test');
  let steeringManager: SteeringManager;
  let gateway: TelegramGateway;

  const config = {
    enabled: true,
    poll_interval: '5s',
    dashboard_port: 7070,
    notify_on_flag: true,
    flag_timeout: '10m',
    auto_approve_low_risk: true,
    always_flag_irreversible: true,
    telegram: {
      enabled: true,
      bot_token: 'fake-token',
      allowed_users: ['123456'],
    }
  };

  beforeEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
    steeringManager = new SteeringManager(testDir);
    await steeringManager.init();

    gateway = await TelegramGateway.create(config.telegram as any, steeringManager);
  });

  afterEach(async () => {
    await gateway.stop();
  });

  it('initializes with allowed users', () => {
    expect((gateway as any)._allowedUsers.has('123456')).toBe(true);
    expect((gateway as any)._allowedUsers.has('999999')).toBe(false);
  });

  it('rejects if no token provided', async () => {
    const originalToken = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    try {
      await expect(TelegramGateway.create({ allowed_users: [] } as any, steeringManager))
        .rejects.toThrow('TELEGRAM_BOT_TOKEN is required');
    } finally {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    }
  });

  it('registers expected command handlers', () => {
    const bot = (gateway as any)._bot;
    expect(bot.onText).toHaveBeenCalledWith(expect.any(RegExp), expect.any(Function));
  });
});
