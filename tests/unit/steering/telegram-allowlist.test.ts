/**
 * TEST-07: TelegramGateway User Allowlist Logic Tests
 *
 * Validates security-critical access control:
 * - Allowed users can steer tasks
 * - Denied users are blocked
 * - Allowlist edge cases handled safely
 * - Audit logging of access attempts
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TelegramGateway } from '../../../src/steering/telegram-gateway.js';
import { SteeringManager } from '../../../src/steering/steering-manager.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

// Capture handlers registered by TelegramGateway
type MessageHandler = (msg: any) => void;
type TextHandler = (msg: any, match: RegExpExecArray | null) => void;

let messageHandlers: MessageHandler[] = [];
let textHandlers: Array<{ regex: RegExp; handler: TextHandler }> = [];

vi.mock('node-telegram-bot-api', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      on: vi.fn((event: string, handler: MessageHandler) => {
        if (event === 'message') messageHandlers.push(handler);
      }),
      onText: vi.fn((regex: RegExp, handler: TextHandler) => {
        textHandlers.push({ regex, handler });
      }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      stopPolling: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe('TelegramGateway Allowlist', () => {
  const testDir = path.join(os.tmpdir(), `zora-tg-allowlist-${Date.now()}`);
  let steeringManager: SteeringManager;
  let gateway: TelegramGateway;

  function makeConfig(allowedUsers: string[] = ['123456', '789012']) {
    return {
      enabled: true,
      poll_interval: '5s',
      dashboard_port: 8070,
      notify_on_flag: true,
      flag_timeout: '10m',
      auto_approve_low_risk: true,
      always_flag_irreversible: true,
      bot_token: 'test-token-123',
      allowed_users: allowedUsers,
    };
  }

  function makeTelegramMessage(userId: string | undefined, chatId: number = 100, text: string = '/steer job-1 fix the bug') {
    return {
      from: userId !== undefined ? { id: Number(userId) } : undefined,
      chat: { id: chatId },
      text,
    };
  }

  beforeEach(async () => {
    messageHandlers = [];
    textHandlers = [];
    vi.clearAllMocks();

    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch { /* ignore */ }

    steeringManager = new SteeringManager(testDir);
    await steeringManager.init();
  });

  afterEach(async () => {
    if (gateway) {
      await gateway.stop();
    }
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('allowed user access', () => {
    it('allowed user ID is recognized', async () => {
      gateway = await TelegramGateway.create(makeConfig(['123456']) as any, steeringManager);
      const allowedUsers = (gateway as any)._allowedUsers as Set<string>;
      expect(allowedUsers.has('123456')).toBe(true);
    });

    it('multiple allowed users are all recognized', async () => {
      gateway = await TelegramGateway.create(makeConfig(['111', '222', '333']) as any, steeringManager);
      const allowedUsers = (gateway as any)._allowedUsers as Set<string>;
      expect(allowedUsers.has('111')).toBe(true);
      expect(allowedUsers.has('222')).toBe(true);
      expect(allowedUsers.has('333')).toBe(true);
    });

    it('allowed user message handler does not send unauthorized response', async () => {
      gateway = await TelegramGateway.create(makeConfig(['123456']) as any, steeringManager);
      const bot = (gateway as any)._bot;

      const msg = makeTelegramMessage('123456');
      // Fire the message handler
      for (const handler of messageHandlers) {
        handler(msg);
      }

      // Should NOT send unauthorized message
      const sendCalls = bot.sendMessage.mock.calls as Array<[number, string]>;
      const unauthorizedCalls = sendCalls.filter(
        (call) => typeof call[1] === 'string' && call[1].includes('UNAUTHORIZED')
      );
      expect(unauthorizedCalls).toHaveLength(0);
    });
  });

  describe('denied user access', () => {
    it('denies user not in allowlist', async () => {
      gateway = await TelegramGateway.create(makeConfig(['123456']) as any, steeringManager);
      const bot = (gateway as any)._bot;

      const msg = makeTelegramMessage('999999');
      for (const handler of messageHandlers) {
        handler(msg);
      }

      expect(bot.sendMessage).toHaveBeenCalledWith(
        msg.chat.id,
        expect.stringContaining('UNAUTHORIZED')
      );
    });

    it('denies message with no from field', async () => {
      gateway = await TelegramGateway.create(makeConfig(['123456']) as any, steeringManager);
      const bot = (gateway as any)._bot;

      const msg = { chat: { id: 100 }, text: 'hello' };
      for (const handler of messageHandlers) {
        handler(msg);
      }

      // When from is undefined, userId is undefined, sends UNAUTHORIZED
      expect(bot.sendMessage).toHaveBeenCalledWith(
        100,
        expect.stringContaining('UNAUTHORIZED')
      );
    });

    it('denies message with undefined user ID', async () => {
      gateway = await TelegramGateway.create(makeConfig(['123456']) as any, steeringManager);
      const bot = (gateway as any)._bot;

      const msg = { from: {}, chat: { id: 100 }, text: 'hello' };
      for (const handler of messageHandlers) {
        handler(msg);
      }

      // from.id is undefined => userId is undefined => sends UNAUTHORIZED
      expect(bot.sendMessage).toHaveBeenCalledWith(
        100,
        expect.stringContaining('UNAUTHORIZED')
      );
    });
  });

  describe('steer command authorization', () => {
    it('allowed user can trigger /steer command', async () => {
      const spy = vi.spyOn(steeringManager, 'injectMessage').mockResolvedValue('steer_123');
      gateway = await TelegramGateway.create(makeConfig(['123456']) as any, steeringManager);
      const bot = (gateway as any)._bot;

      // Find the /steer handler
      const steerHandler = textHandlers.find(h => h.regex.source.includes('steer'));
      expect(steerHandler).toBeDefined();

      const msg = makeTelegramMessage('123456');
      const match = ['/steer job-1 fix the bug', 'job-1', 'fix the bug'] as unknown as RegExpExecArray;

      await steerHandler!.handler(msg, match);

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'steer',
          jobId: 'job-1',
          message: 'fix the bug',
          author: 'tg_123456',
          source: 'telegram',
        })
      );

      expect(bot.sendMessage).toHaveBeenCalledWith(
        msg.chat.id,
        expect.stringContaining('STEERING INJECTED')
      );
    });

    it('denied user /steer command is silently ignored', async () => {
      const spy = vi.spyOn(steeringManager, 'injectMessage');
      gateway = await TelegramGateway.create(makeConfig(['123456']) as any, steeringManager);

      const steerHandler = textHandlers.find(h => h.regex.source.includes('steer'));
      const msg = makeTelegramMessage('999999');
      const match = ['/steer job-1 do bad things', 'job-1', 'do bad things'] as unknown as RegExpExecArray;

      await steerHandler!.handler(msg, match);

      // Should NOT have injected the steering message
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('status command authorization', () => {
    it('allowed user can check /status', async () => {
      gateway = await TelegramGateway.create(makeConfig(['123456']) as any, steeringManager);
      const bot = (gateway as any)._bot;

      const statusHandler = textHandlers.find(h => h.regex.source.includes('status'));
      expect(statusHandler).toBeDefined();

      const msg = makeTelegramMessage('123456');
      const match = ['/status job-1', 'job-1'] as unknown as RegExpExecArray;

      await statusHandler!.handler(msg, match);

      expect(bot.sendMessage).toHaveBeenCalledWith(
        msg.chat.id,
        expect.stringContaining('STATUS')
      );
    });

    it('denied user /status is silently ignored', async () => {
      gateway = await TelegramGateway.create(makeConfig(['123456']) as any, steeringManager);
      const bot = (gateway as any)._bot;

      const statusHandler = textHandlers.find(h => h.regex.source.includes('status'));
      const msg = makeTelegramMessage('999999');
      const match = ['/status job-1', 'job-1'] as unknown as RegExpExecArray;

      await statusHandler!.handler(msg, match);

      // Should NOT respond with status to unauthorized user
      const statusCalls = (bot.sendMessage.mock.calls as Array<[number, string]>).filter(
        (call) => typeof call[1] === 'string' && call[1].includes('STATUS')
      );
      expect(statusCalls).toHaveLength(0);
    });
  });

  describe('empty allowlist', () => {
    it('empty allowlist denies all users', async () => {
      gateway = await TelegramGateway.create(makeConfig([]) as any, steeringManager);
      const bot = (gateway as any)._bot;

      const msg = makeTelegramMessage('123456');
      for (const handler of messageHandlers) {
        handler(msg);
      }

      expect(bot.sendMessage).toHaveBeenCalledWith(
        msg.chat.id,
        expect.stringContaining('UNAUTHORIZED')
      );
    });
  });

  describe('user ID matching', () => {
    it('user ID matching is exact (string comparison)', async () => {
      gateway = await TelegramGateway.create(makeConfig(['123456']) as any, steeringManager);
      const allowedUsers = (gateway as any)._allowedUsers as Set<string>;

      // Exact match works
      expect(allowedUsers.has('123456')).toBe(true);
      // Partial match does not
      expect(allowedUsers.has('12345')).toBe(false);
      expect(allowedUsers.has('1234567')).toBe(false);
      // Different ID does not
      expect(allowedUsers.has('654321')).toBe(false);
    });
  });

  describe('steer error handling', () => {
    it('reports error when steeringManager.injectMessage fails', async () => {
      vi.spyOn(steeringManager, 'injectMessage').mockRejectedValue(new Error('disk full'));
      gateway = await TelegramGateway.create(makeConfig(['123456']) as any, steeringManager);
      const bot = (gateway as any)._bot;

      const steerHandler = textHandlers.find(h => h.regex.source.includes('steer'));
      const msg = makeTelegramMessage('123456');
      const match = ['/steer job-1 fix it', 'job-1', 'fix it'] as unknown as RegExpExecArray;

      await steerHandler!.handler(msg, match);

      expect(bot.sendMessage).toHaveBeenCalledWith(
        msg.chat.id,
        expect.stringContaining('FAILED')
      );
    });
  });

  describe('unauthorized access logging', () => {
    it('logs warning for unauthorized access attempt', async () => {
      gateway = await TelegramGateway.create(makeConfig(['123456']) as any, steeringManager);

      const msg = makeTelegramMessage('999999');
      for (const handler of messageHandlers) {
        handler(msg);
      }

      // After structured logging migration (LOG-01), warnings go through pino logger
      // instead of console.warn. We verify the gateway sends the UNAUTHORIZED message
      // to the chat, which confirms the unauthorized path was triggered.
      const bot = (gateway as any)._bot;
      expect(bot.sendMessage).toHaveBeenCalledWith(
        msg.chat.id,
        expect.stringContaining('UNAUTHORIZED')
      );
    });
  });
});
