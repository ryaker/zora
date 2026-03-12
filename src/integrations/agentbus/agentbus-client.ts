/**
 * AgentBusClient — typed HTTP client for the AgentBus REST API (:8090).
 *
 * Handles Zora instance registration on startup, message sending to other
 * project Zoras, and message acknowledgement. The inbound direction (AgentBus
 * → Zora) is handled separately by the ZoraBridge which watches the inbox folder.
 */

import { createLogger } from '../../utils/logger.js';

const log = createLogger('agentbus-client');

export interface AgentBusConfig {
  /** AgentBus base URL (default: http://localhost:8090) */
  baseUrl?: string;
  /** This Zora's project name (e.g. "AgentDev") */
  project: string;
  /** Absolute path to this project's folder */
  folderPath: string;
}

export interface SendMessageOptions {
  /** Target project name */
  toProject: string;
  /** Message content */
  content: string;
  /** Priority (higher = more urgent, default 0) */
  priority?: number;
}

export interface AgentBusStatus {
  ok: boolean;
  sessions: unknown[];
  queueDepth: number;
}

export class AgentBusClient {
  private readonly _baseUrl: string;
  private readonly _project: string;
  private readonly _folderPath: string;
  private _registered = false;

  constructor(config: AgentBusConfig) {
    this._baseUrl = (config.baseUrl ?? 'http://localhost:8090').replace(/\/$/, '');
    this._project = config.project;
    this._folderPath = config.folderPath;
  }

  get isRegistered(): boolean {
    return this._registered;
  }

  /**
   * Register this Zora instance with AgentBus on boot. Non-blocking — runs in the
   * background with a 5s timeout so it never delays daemon startup.
   * Safe to call multiple times — subsequent calls are no-ops if already registered.
   */
  register(): void {
    if (this._registered) return;

    const doRegister = async () => {
      try {
        const res = await fetch(`${this._baseUrl}/api/bus/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project: this._project,
            folder_path: this._folderPath,
            runtime: 'zora',
            pid: process.pid,
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          log.warn({ status: res.status, body }, '[agentbus] Registration failed — continuing without AgentBus');
          return;
        }

        this._registered = true;
        log.info({ project: this._project, pid: process.pid }, '[agentbus] Registered with AgentBus');
      } catch (err) {
        log.warn({ err }, '[agentbus] AgentBus unreachable — registration skipped');
      }
    };

    doRegister().catch((err) => log.warn({ err }, '[agentbus] register() background error'));
  }

  /**
   * Send a message to another project's Zora via AgentBus.
   * Returns the message ID on success, null on failure.
   */
  async send(options: SendMessageOptions): Promise<number | null> {
    try {
      const res = await fetch(`${this._baseUrl}/api/bus/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_project: options.toProject,
          from_source: this._project,
          content: options.content,
          priority: options.priority ?? 0,
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        log.warn({ status: res.status, body, toProject: options.toProject }, '[agentbus] Send failed');
        return null;
      }

      const data = await res.json() as { id?: number };
      log.info({ messageId: data.id, toProject: options.toProject }, '[agentbus] Message sent');
      return data.id ?? null;
    } catch (err) {
      log.warn({ err, toProject: options.toProject }, '[agentbus] Send error');
      return null;
    }
  }

  /**
   * Acknowledge a message that was delivered via the inbox.
   */
  async ack(messageId: number): Promise<void> {
    try {
      const res = await fetch(`${this._baseUrl}/api/bus/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: messageId, handled_by: this._project }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        log.warn({ messageId, status: res.status, body }, '[agentbus] Ack returned non-2xx');
      }
    } catch (err) {
      log.warn({ err, messageId }, '[agentbus] Ack failed');
    }
  }

  /**
   * Check AgentBus health and return status.
   */
  async status(): Promise<AgentBusStatus | null> {
    try {
      const res = await fetch(`${this._baseUrl}/api/bus/status`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      return res.json() as Promise<AgentBusStatus>;
    } catch {
      return null;
    }
  }

  /**
   * Deregister on shutdown. Best-effort — does not throw.
   */
  async deregister(): Promise<void> {
    if (!this._registered) return;
    // AgentBus doesn't have a deregister endpoint yet — mark locally
    this._registered = false;
    log.info({ project: this._project }, '[agentbus] Deregistered');
  }
}
