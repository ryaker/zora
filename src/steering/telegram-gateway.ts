/**
 * TelegramGateway — Remote async steering via Telegram Bot API.
 *
 * Spec §6.0 "Telegram Gateway Spec":
 *   - Uses Long Polling to avoid public exposure.
 *   - Authenticates users via allowed_users list in config.
 *   - Injects steer messages into SteeringManager.
 */

import { spawn } from 'child_process';
import type { SteeringManager } from './steering-manager.js';
import type { SessionManager } from '../orchestrator/session-manager.js';
import type { SteeringConfig } from '../types.js';
import { createLogger } from '../utils/logger.js';
import type { ApprovalQueue } from '../core/approval-queue.js';

const log = createLogger('telegram-gateway');

// Lazy-loaded: node-telegram-bot-api is an optional peer dependency
type TelegramBotType = import('node-telegram-bot-api');

export interface TelegramConfig extends SteeringConfig {
  bot_token?: string;
  allowed_users: string[];
  enabled: boolean;
  mode?: 'polling' | 'webhook';
  project_dir?: string;
}

/** Strip ANSI, spinner frames, and log noise — keep only the final agent reply. */
function cleanOutput(raw: string): string {
  return raw
    .split('\n')
    .filter(line => {
      const t = line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim();
      if (!t) return false;
      if (t.startsWith('{')) return false;                    // JSON log lines
      if (/^[◐◑◒◓◇◆⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏|/-\\]\s*(Running task|Working|Thinking)/.test(t)) return false; // spinner frames
      if (/^\[[\?0-9]+[A-Za-z]/.test(t)) return false;       // raw ANSI sequences
      return true;
    })
    .map(line => line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, ''))
    .join('\n')
    .trim();
}

export class TelegramGateway {
  private readonly _bot: TelegramBotType;
  private readonly _steeringManager: SteeringManager;
  private readonly _sessionManager?: SessionManager;
  private readonly _allowedUsers: Set<string>;
  private readonly _projectDir: string;
  private readonly _chatIds = new Map<string, number>(); // userId → chatId
  private _approvalQueue: ApprovalQueue | undefined;

  private constructor(bot: TelegramBotType, steeringManager: SteeringManager, allowedUsers: string[], projectDir: string, sessionManager?: SessionManager) {
    this._bot = bot;
    this._steeringManager = steeringManager;
    this._sessionManager = sessionManager;
    this._allowedUsers = new Set(allowedUsers);
    this._projectDir = projectDir;

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
    const projectDir = config.project_dir ?? process.env.ZORA_PROJECT_DIR ?? process.cwd();
    return new TelegramGateway(bot, steeringManager, config.allowed_users, projectDir, sessionManager);
  }

  private _setupHandlers(): void {
    /**
     * Plain text handler — fully conversational.
     * Any authorized message that isn't a slash command runs as a task.
     */
    this._bot.on('message', (msg) => {
      const userId = msg.from?.id?.toString();
      if (!userId || !this._allowedUsers.has(userId)) {
        log.warn({ userId }, 'Unauthorized access attempt');
        this._bot.sendMessage(msg.chat.id, '⛔ UNAUTHORIZED: Access Denied.');
        return;
      }

      // Store chatId for proactive messages (approval requests)
      this._chatIds.set(userId, msg.chat.id);

      const text = msg.text ?? '';

      // Let slash command handlers take over for commands
      if (text.startsWith('/')) return;

      // Plain text → run as a task
      this._bot.sendMessage(msg.chat.id, '🤔 On it...');

      log.info({ userId, prompt: text.slice(0, 80) }, 'Running task from Telegram');

      let output = '';
      let error = '';

      // Unset CLAUDECODE so the Claude Agent SDK can spawn claude without
      // the "nested session" guard blocking it.
      const spawnEnv: NodeJS.ProcessEnv = { ...process.env, ZORA_PROJECT_DIR: this._projectDir, NO_COLOR: '1', FORCE_COLOR: '0' };
      delete spawnEnv['CLAUDECODE'];

      const child = spawn('zora-agent', ['ask', text], {
        env: spawnEnv,
        timeout: 5 * 60 * 1000, // 5 min max
      });

      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString(); });

      child.on('close', (code) => {
        const cleaned = cleanOutput(output) || cleanOutput(error);
        if (cleaned) {
          // Telegram message limit is 4096 chars
          const reply = cleaned.length > 4000
            ? cleaned.slice(0, 3997) + '...'
            : cleaned;
          this._bot.sendMessage(msg.chat.id, reply);
        } else {
          this._bot.sendMessage(msg.chat.id, code === 0
            ? '✅ Done.'
            : `❌ Task failed (exit ${code}). Check daemon logs.`
          );
        }
      });

      child.on('error', (err) => {
        log.error({ err: err.message }, 'Failed to spawn zora-agent ask');
        this._bot.sendMessage(msg.chat.id, `❌ Could not start task: ${err.message}`);
      });
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
     * /approve ZORA-XXXX allow|deny|allow-30m|allow-session
     */
    this._bot.onText(/\/approve\s+(.+)/, (msg, match) => {
      const userId = msg.from?.id?.toString();
      if (!userId || !this._allowedUsers.has(userId)) return;
      if (!this._approvalQueue) return;

      const text = `/approve ${match![1]!}`;
      const parsed = this._approvalQueue.parseApprovalCommand(text);
      if (!parsed) {
        this._bot.sendMessage(msg.chat.id, '❌ Invalid approval command. Use: /approve ZORA-XXXX allow|deny|allow-30m|allow-session');
        return;
      }

      const handled = this._approvalQueue.handleReply(parsed.token, parsed.decision);
      if (handled) {
        this._bot.sendMessage(msg.chat.id, `✅ Approval recorded: ${parsed.token} → ${parsed.decision}`);
      } else {
        this._bot.sendMessage(msg.chat.id, `⚠️ Token ${parsed.token} not found (already processed or expired)`);
      }
    });

    /**
     * /help
     */
    this._bot.onText(/\/help/, (msg) => {
      const help = '🛰 **Zora Tactical Link**\n\n' +
                   '/steer <job_id> <message> — Inject course correction\n' +
                   '/status <job_id> — Check task progress\n' +
                   '/approve <token> allow|deny|allow-30m|allow-session — Respond to approval request\n' +
                   '/help — Show this menu';
      this._bot.sendMessage(msg.chat.id, help, { parse_mode: 'Markdown' });
    });
  }

  /**
   * Wire an ApprovalQueue to this gateway.
   * Sets up a send handler that broadcasts approval requests to all known chatIds.
   */
  connectApprovalQueue(queue: ApprovalQueue): void {
    this._approvalQueue = queue;
    queue.setSendHandler(async (message: string) => {
      // #218: report how many chats were actually reached. No known chat, or
      // every send failing, means nobody can approve, and the queue denies at
      // once instead of waiting out the timeout.
      let delivered = 0;
      for (const [, chatId] of this._chatIds) {
        try {
          await this._bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
          delivered++;
        } catch (err) {
          log.warn({ err }, 'Approval request send failed for a chat');
        }
      }
      return delivered;
    });
    log.info('ApprovalQueue connected to Telegram gateway');
  }

  /**
   * Stops the bot.
   */
  async stop(): Promise<void> {
    // #218: pending approvals can no longer be answered once polling stops.
    this._approvalQueue?.clearSendHandler();
    await this._bot.stopPolling();
  }
}
