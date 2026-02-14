/**
 * TelegramGateway — Remote async steering via Telegram Bot API.
 *
 * Spec §6.0 "Telegram Gateway Spec":
 *   - Uses Long Polling to avoid public exposure.
 *   - Authenticates users via allowed_users list in config.
 *   - Injects steer messages into SteeringManager.
 */

import type { SteeringManager } from './steering-manager.js';
import type { SteeringConfig } from '../types.js';

// Lazy-loaded: node-telegram-bot-api is an optional peer dependency
type TelegramBotType = import('node-telegram-bot-api');

export interface TelegramConfig extends SteeringConfig {
  bot_token?: string;
  allowed_users: string[];
  enabled: boolean;
}

export class TelegramGateway {
  private readonly _bot: TelegramBotType;
  private readonly _steeringManager: SteeringManager;
  private readonly _allowedUsers: Set<string>;

  private constructor(bot: TelegramBotType, steeringManager: SteeringManager, allowedUsers: string[]) {
    this._bot = bot;
    this._steeringManager = steeringManager;
    this._allowedUsers = new Set(allowedUsers);

    this._setupHandlers();
  }

  /**
   * Factory method — loads node-telegram-bot-api dynamically.
   * Throws a clear error if the optional dep isn't installed.
   */
  static async create(config: TelegramConfig, steeringManager: SteeringManager): Promise<TelegramGateway> {
    const token = config.bot_token || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is required for TelegramGateway');
    }

    let TelegramBot: typeof import('node-telegram-bot-api');
    try {
      const mod = await import('node-telegram-bot-api');
      TelegramBot = mod.default;
    } catch {
      throw new Error(
        'Telegram support requires node-telegram-bot-api.\n' +
        'Install it: npm install node-telegram-bot-api'
      );
    }

    const bot = new TelegramBot(token, { polling: true });
    return new TelegramGateway(bot, steeringManager, config.allowed_users);
  }

  private _setupHandlers(): void {
    /**
     * Middleware-like check for authorized users
     */
    this._bot.on('message', (msg) => {
      const userId = msg.from?.id?.toString();
      if (!userId || !this._allowedUsers.has(userId)) {
        console.warn(`[Telegram] Unauthorized access attempt from user ${userId}`);
        this._bot.sendMessage(msg.chat.id, '⛔ UNAUTHORIZED: Access Denied.');
        return;
      }
    });

    /**
     * /steer <job_id> <message>
     */
    this._bot.onText(/\/steer\s+([^\s]+)\s+(.+)/, async (msg, match) => {
      const userId = msg.from?.id?.toString();
      if (!userId || !this._allowedUsers.has(userId)) return;

      const jobId = match![1]!;
      const message = match![2]!;

      try {
        await this._steeringManager.injectMessage({
          type: 'steer',
          jobId,
          message,
          author: `tg_${userId}`,
          source: 'telegram',
          timestamp: new Date()
        });

        this._bot.sendMessage(msg.chat.id, `✅ STEERING INJECTED for job ${jobId}`);
      } catch (err) {
        this._bot.sendMessage(msg.chat.id, `❌ FAILED: ${String(err)}`);
      }
    });

    /**
     * /status <job_id>
     */
    this._bot.onText(/\/status\s+([^\s]+)/, async (msg, match) => {
      const userId = msg.from?.id?.toString();
      if (!userId || !this._allowedUsers.has(userId)) return;

      const jobId = match![1]!;
      // Future: Query session manager for real status
      this._bot.sendMessage(msg.chat.id, `ℹ️ STATUS [${jobId}]: Monitoring active (simulated)`);
    });

    /**
     * /help
     */
    this._bot.onText(/\/help/, (msg) => {
      const help = '🛰 **Zora Tactical Link**\n\n' +
                   '/steer <job_id> <message> — Inject course correction\n' +
                   '/status <job_id> — Check task progress\n' +
                   '/help — Show this menu';
      this._bot.sendMessage(msg.chat.id, help, { parse_mode: 'Markdown' });
    });
  }

  /**
   * Stops the bot.
   */
  async stop(): Promise<void> {
    await this._bot.stopPolling();
  }
}
