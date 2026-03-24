/**
 * SignalIntakeAdapter — wraps signal-sdk SignalCli for Zora's intake layer.
 *
 * Responsibilities:
 *   - Start/stop signal-cli daemon lifecycle
 *   - Exponential backoff reconnect (max 5 retries)
 *   - Message deduplication
 *   - Reject messages > 10,000 chars (DoS protection)
 *   - Map signal envelope → ChannelMessage
 *   - Log sender + channel on receipt (NEVER log content)
 *
 * INVARIANT-7: Daemon crash → intake stops until daemon recovers.
 */

import { SignalCli } from 'signal-sdk';
import { ChannelMessage } from '../../types/channel.js';
import { signalEventToChannelMessage, SignalEvent } from './signal-identity.js';
import { createLogger } from '../../utils/logger.js';
import { routeMessage, type ProjectEntry, type RoutingResult } from './signal-pm-router.js';

const log = createLogger('signal-intake');

const MAX_RETRIES = 5;
const RETRY_BASE_MS = 1000;   // Start at 1 second
const RETRY_MAX_MS = 32000;   // Cap at 32 seconds

export class SignalIntakeAdapter {
  private readonly _phoneNumber: string;
  private readonly _cliPath: string | undefined;
  private _cli: SignalCli | null = null;
  private _messageHandler: ((msg: ChannelMessage) => Promise<void>) | null = null;
  private _seenIds = new Set<string>();
  private _retryCount = 0;
  private _stopped = false;
  private _retryTimeout: ReturnType<typeof setTimeout> | null = null;
  /** PM Zora only: optional project list enabling per-project routing */
  private _projects: ProjectEntry[] | undefined;

  constructor(phoneNumber: string, cliPath?: string) {
    this._phoneNumber = phoneNumber;
    this._cliPath = cliPath;
  }

  /**
   * Configure PM Zora routing. When called with a non-empty project list,
   * inbound messages are routed to the appropriate project before being
   * forwarded to the message handler.
   *
   * Not required for regular Zora instances — only call this when operating
   * in PM Zora mode with multiple downstream project Zoras.
   */
  setProjects(projects: ProjectEntry[]): void {
    this._projects = projects;
  }

  /**
   * Start signal-cli daemon and register message listeners.
   * Throws if max retries exceeded without successful connection.
   */
  async start(): Promise<void> {
    this._stopped = false;
    this._retryCount = 0;
    await this._connect();
  }

  /** Gracefully stop the daemon and cancel any pending reconnects. */
  async stop(): Promise<void> {
    this._stopped = true;
    if (this._retryTimeout) {
      clearTimeout(this._retryTimeout);
      this._retryTimeout = null;
    }
    if (this._cli) {
      try {
        await this._cli.gracefulShutdown();
      } catch {
        // Ignore shutdown errors
      }
      this._cli = null;
    }
    log.info('[signal] Daemon stopped');
  }

  /** Returns the connected SignalCli instance (for sharing with ResponseGateway). */
  getCli(): SignalCli | null {
    return this._cli;
  }

  /**
   * Register the message handler.
   * Called before start(). Only one handler is supported.
   */
  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
    this._messageHandler = handler;
  }

  /** Internal: connect with exponential backoff */
  private async _connect(): Promise<void> {
    while (!this._stopped && this._retryCount <= MAX_RETRIES) {
      try {
        log.info('[signal] Connecting to signal-cli daemon...');
        // If a cliPath is configured, pass it as first arg so signal-sdk uses that
        // binary instead of its bundled version. Required when the account was
        // registered with a newer signal-cli than the one bundled in signal-sdk.
        this._cli = this._cliPath
          ? new SignalCli(this._cliPath, this._phoneNumber)
          : new SignalCli(this._phoneNumber);

        this._cli.on('message', (raw: unknown) => {
          this._handleRawMessage(raw).catch(err => {
            log.error({ err }, '[signal] Error in message handler');
          });
        });

        this._cli.on('error', (err: Error) => {
          log.error({ err }, '[signal] Daemon error');
        });

        this._cli.on('close', () => {
          if (!this._stopped) {
            log.warn('[signal] Daemon closed unexpectedly — scheduling reconnect');
            this._scheduleReconnect();
          }
        });

        await this._cli.connect();
        this._retryCount = 0;
        log.info(`[signal] Daemon ready — listening for messages on ${this._phoneNumber}`);
        return;
      } catch (err) {
        this._retryCount++;
        if (this._retryCount > MAX_RETRIES) {
          log.error({ err, retries: this._retryCount }, '[signal] Max retries exceeded — giving up');
          throw new Error(`SignalIntakeAdapter: failed to connect after ${MAX_RETRIES} retries: ${err}`);
        }
        const delay = Math.min(RETRY_BASE_MS * Math.pow(2, this._retryCount - 1), RETRY_MAX_MS);
        log.warn({ err, retry: this._retryCount, delayMs: delay }, '[signal] Connection failed — retrying');
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /** Schedule a reconnect attempt (called on unexpected close) */
  private _scheduleReconnect(): void {
    if (this._stopped) return;
    this._retryCount++;
    if (this._retryCount > MAX_RETRIES) {
      log.error({ retries: this._retryCount }, '[signal] INVARIANT-7: Max retries exceeded — intake stopped');
      return;
    }
    const delay = Math.min(RETRY_BASE_MS * Math.pow(2, this._retryCount - 1), RETRY_MAX_MS);
    log.info({ retry: this._retryCount, delayMs: delay }, '[signal] Scheduling reconnect');
    this._retryTimeout = setTimeout(() => {
      this._connect().catch(err => {
        log.error({ err }, '[signal] Reconnect failed');
      });
    }, delay);
  }

  /** Handle raw signal-sdk message event */
  private async _handleRawMessage(raw: unknown): Promise<void> {
    // Map signal-sdk event structure to our SignalEvent shape
    const event = raw as SignalEvent;

    // Convert to ChannelMessage — may throw on oversized content or missing fields
    let message: ChannelMessage;
    try {
      message = signalEventToChannelMessage(event);
    } catch (err) {
      const envelope = (raw as Record<string, unknown>)?.['envelope'];
      const phone = envelope
        ? ((envelope as Record<string, unknown>)['sourceNumber'] ?? 'unknown')
        : 'unknown';
      log.warn({ err, phone }, '[signal] Rejected message (parse/size error)');
      return;
    }

    // Deduplication: signal-cli can redeliver messages
    if (this._seenIds.has(message.id)) {
      log.debug({ id: message.id }, '[signal] Duplicate message dropped');
      return;
    }
    this._seenIds.add(message.id);

    // Prune dedup set to prevent unbounded growth (keep last 1000)
    if (this._seenIds.size > 1000) {
      const oldest = this._seenIds.values().next().value;
      if (oldest !== undefined) this._seenIds.delete(oldest);
    }

    // SECURITY: Log sender + channel, never content
    log.info(
      { sender: message.from.phoneNumber, channelId: message.channelId, channelType: message.channelType },
      '[signal] Message received'
    );

    // PM Zora routing — only active when projects are configured
    if (this._projects && this._projects.length > 0) {
      const result: RoutingResult = routeMessage(message.content ?? '', this._projects);

      if (result.type === 'command') {
        // Slash commands are handled by PM Zora directly.
        // Log and drop for now — a command handler can be attached later.
        log.info({ command: result.command, args: result.args }, '[signal] PM Zora slash command received');
        return;
      }

      if (result.type === 'route' && result.project) {
        // Apply the stripped content (without @Project prefix) and attach
        // the routing target so downstream handlers can forward to the correct project Zora.
        message.content = result.content;
        message.project = result.project;
        log.info({ project: result.project }, '[signal] PM Zora routed message to project');
      }
      // 'unresolved' falls through to the default handler unchanged
    }

    if (this._messageHandler) {
      await this._messageHandler(message);
    }
  }
}
