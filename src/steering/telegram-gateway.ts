/**
 * TelegramGateway — Remote async steering via Telegram Bot API.
 *
 * Spec §6.0 "Telegram Gateway Spec":
 *   - Uses Long Polling to avoid public exposure.
 *   - Authenticates users via allowed_users list in config.
 *   - Injects steer messages into SteeringManager.
 */

import type { SteeringManager } from './steering-manager.js';
import type { SessionManager } from '../orchestrator/session-manager.js';
import type { SteeringConfig } from '../types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('telegram-gateway');

// Lazy-loaded: node-telegram-bot-api is an optional peer dependency
type TelegramBotType = import('node-telegram-bot-api');

export interface TelegramConfig extends SteeringConfig {
  bot_token?: string;
  allowed_users: string[];
  enabled: boolean;
  mode?: 'polling' | 'webhook';
}

export class TelegramGateway {
  private readonly _bot: TelegramBotType;
  private readonly _steeringManager: SteeringManager;
  private readonly _sessionManager?: SessionManager;
  private readonly _allowedUsers: Set<string>;

  private constructor(bot: TelegramBotType, steeringManager: SteeringManager, allowedUsers: string[], sessionManager?: SessionManager) {
    this._bot = bot;
    this._steeringManager = steeringManager;
    this._sessionManager = sessionManager;
    this._allowedUsers = new Set(allowedUsers);

    this._setupHandlers();
  }

  /**
   * Factory method — loads node-telegram-bot-api dynamically.
   * Throws a clear error if the optional dep isn't installed.
   */
  static async create(config: TelegramConfig, steeringManager: SteeringManager, sessionManager?: SessionManager): Promise<TelegramGateway> {
    const token = config.bot_token || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is required for TelegramGateway');
    }

    let TelegramBot: typeof import('node-telegram-bot-api');
    try {
      const mod = await import('node-telegram-bot-api');
      TelegramBot = mod.default;
    } catch (importErr) {
      const isModuleNotFound =
        importErr instanceof Error &&
        ('code' in importErr && (importErr as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND' ||
         importErr.message.includes('Cannot find'));
      throw new Error(
        'Telegram support requires the optional peer dependency node-telegram-bot-api.\n' +
        (isModuleNotFound
          ? 'Install it in your project: npm install node-telegram-bot-api\n' +
            'If installed globally, ensure it is resolvable from zora-agent\'s module path.'
          : `Unexpected import error: ${importErr instanceof Error ? importErr.message : String(importErr)}`)
      );
    }

    const mode = config.mode ?? 'polling';
    if (mode === 'webhook') {
      console.warn('[Telegram] Webhook mode selected. Ensure your webhook URL is configured externally.');
    }
    const bot = new TelegramBot(token, { polling: mode === 'polling' });
    return new TelegramGateway(bot, steeringManager, config.allowed_users, sessionManager);
  }

  private _setupHandlers(): void {
    /**
     * Middleware-like check for authorized users
     */
    this._bot.on('message', (msg) => {
      const userId = msg.from?.id?.toString();
      if (!userId || !this._allowedUsers.has(userId)) {
        log.warn({ userId }, 'Unauthorized access attempt');
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

      try {
        const lines: string[] = [`STATUS [${jobId}]`];

        // Query pending steering messages
        const pending = await this._steeringManager.getPendingMessages(jobId);
        lines.push(`Pending steer messages: ${pending.length}`);

        // Query session state if session manager is available
        if (this._sessionManager) {
          const sessions = await this._sessionManager.listSessions();
          const session = sessions.find(s => s.jobId === jobId);
          if (session) {
            lines.push(`Session status: ${session.status}`);
            lines.push(`Event count: ${session.eventCount}`);
            lines.push(`Last activity: ${session.lastActivity ? session.lastActivity.toISOString() : 'N/A'}`);
          } else {
            lines.push('Session: not found');
          }
        } else {
          lines.push('Session manager: not available');
        }

        this._bot.sendMessage(msg.chat.id, lines.join('\n'));
      } catch (err) {
        log.error({ jobId, error: String(err) }, 'Failed to retrieve status');
        this._bot.sendMessage(msg.chat.id, `Failed to retrieve status for ${jobId}: ${String(err)}`);
      }
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
