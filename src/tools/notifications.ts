/**
 * Notification Tools — macOS native notifications.
 *
 * Spec §5.3 "Built-in Tools":
 *   - notify_user: Send macOS notification
 *
 * Config fields wired:
 *   notifications.enabled          — master toggle; if false, all notify() calls are no-ops.
 *   notifications.on_task_complete — guards notifyTaskComplete().
 *   notifications.on_error         — guards notifyError().
 *   notifications.on_failover      — guards notifyFailover().
 *   notifications.on_auth_expiry   — guards notifyAuthExpiry().
 *   notifications.on_all_providers_down — guards notifyAllProvidersDown().
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '../utils/logger.js';
import type { NotificationsConfig } from '../types.js';

const execFileAsync = promisify(execFile);
const log = createLogger('notifications');

/** Full notification config — all fields default to enabled. */
const DEFAULT_NOTIFICATIONS_CONFIG: NotificationsConfig = {
  enabled: true,
  on_task_complete: true,
  on_error: true,
  on_failover: true,
  on_auth_expiry: true,
  on_all_providers_down: true,
};

export class NotificationTools {
  private readonly _cfg: NotificationsConfig;

  /**
   * @param config  Optional NotificationsConfig from the user's config.toml.
   *   When omitted, all notifications are enabled (safe default).
   */
  constructor(config?: NotificationsConfig) {
    this._cfg = config ?? DEFAULT_NOTIFICATIONS_CONFIG;
  }

  /**
   * Sends a macOS native notification using AppleScript.
   *
   * This is the low-level primitive. Prefer the typed helpers below so that
   * per-event toggles (on_task_complete, on_error, etc.) are respected.
   *
   * Skips silently when notifications.enabled is false.
   */
  async notify(title: string, message: string): Promise<void> {
    if (!this._cfg.enabled) return;

    // To prevent AppleScript injection, we must escape backslashes first, then double quotes.
    // In AppleScript strings, a quote is escaped as \" and a backslash as \\.
    const escapeForAppleScript = (str: string) =>
      str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    const escapedTitle = escapeForAppleScript(title);
    const escapedMessage = escapeForAppleScript(message);

    const script = `display notification "${escapedMessage}" with title "Zora" subtitle "${escapedTitle}"`;

    try {
      await execFileAsync('osascript', ['-e', script]);
    } catch (err) {
      // If notification fails (e.g. not on macOS or headless), we log to console
      log.info({ title, message }, 'Notification fallback (osascript unavailable)');
    }
  }

  /**
   * Notify that a task completed successfully.
   * Gated by notifications.on_task_complete.
   */
  async notifyTaskComplete(jobId: string, summary?: string): Promise<void> {
    if (!this._cfg.enabled || !this._cfg.on_task_complete) return;
    await this.notify('Task Complete', summary ?? `Job ${jobId} finished successfully.`);
  }

  /**
   * Notify that a task encountered an unrecoverable error.
   * Gated by notifications.on_error.
   */
  async notifyError(jobId: string, errorMessage: string): Promise<void> {
    if (!this._cfg.enabled || !this._cfg.on_error) return;
    await this.notify('Task Error', `Job ${jobId}: ${errorMessage}`);
  }

  /**
   * Notify that a failover to another provider occurred.
   * Gated by notifications.on_failover.
   */
  async notifyFailover(fromProvider: string, toProvider: string, reason: string): Promise<void> {
    if (!this._cfg.enabled || !this._cfg.on_failover) return;
    await this.notify('Provider Failover', `Switched from ${fromProvider} to ${toProvider}: ${reason}`);
  }

  /**
   * Notify that a provider token is near expiry.
   * Gated by notifications.on_auth_expiry.
   */
  async notifyAuthExpiry(providerName: string, hoursRemaining: number): Promise<void> {
    if (!this._cfg.enabled || !this._cfg.on_auth_expiry) return;
    await this.notify('Token Near Expiry', `${providerName} token expires in ~${Math.round(hoursRemaining)}h.`);
  }

  /**
   * Notify that all providers are down and no failover is available.
   * Gated by notifications.on_all_providers_down.
   */
  async notifyAllProvidersDown(): Promise<void> {
    if (!this._cfg.enabled || !this._cfg.on_all_providers_down) return;
    await this.notify('All Providers Down', 'No LLM provider is available. Check credentials and connectivity.');
  }
}
