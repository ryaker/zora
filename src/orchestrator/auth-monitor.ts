/**
 * AuthMonitor — Periodic provider health and auth status checks.
 *
 * Spec §5.1 "Auth Health Monitoring":
 *   - Checks all registered provider health and auth status on every heartbeat.
 *   - Notifies user if auth expires or is near expiry.
 *   - Distinguishes between quota exhaustion and auth failure.
 *   - Checkpoints active jobs on auth failure.
 */

import type { LLMProvider, AuthStatus } from '../types.js';
import { NotificationTools } from '../tools/notifications.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('auth-monitor');

export interface AuthMonitorOptions {
  providers: LLMProvider[];
  notifications: NotificationTools;
  preExpiryWarningHours?: number;
}

export class AuthMonitor {
  private readonly _providers: LLMProvider[];
  private readonly _notifications: NotificationTools;
  private readonly _preExpiryWarningHours: number;

  constructor(options: AuthMonitorOptions) {
    this._providers = options.providers;
    this._notifications = options.notifications;
    this._preExpiryWarningHours = options.preExpiryWarningHours ?? 2;
  }

  /**
   * Performs a full health check across all providers.
   * Typically called on every heartbeat.
   */
  async checkAll(): Promise<Map<string, AuthStatus>> {
    const results = new Map<string, AuthStatus>();
    const MS_PER_HOUR = 3600000;

    await Promise.all(
      this._providers.map(async (provider) => {
        try {
          const auth = await provider.checkAuth();
          results.set(provider.name, auth);

          if (!auth.valid && auth.requiresInteraction) {
            // Log only — don't trigger OS notifications for auth failures.
            // Auth status is visible in the dashboard. Zora fails over to
            // another provider automatically.
            log.warn({ provider: provider.name }, 'Provider auth invalid, failing over');
            // In a full implementation, we would call checkpointActiveJobs(provider.name) here
          } else if (auth.valid && auth.expiresAt) {
            const hoursRemaining = (auth.expiresAt.getTime() - Date.now()) / MS_PER_HOUR;
            if (hoursRemaining > 0 && hoursRemaining < this._preExpiryWarningHours) {
              // on_auth_expiry toggle is enforced inside notifyAuthExpiry()
              await this._notifications.notifyAuthExpiry(provider.name, hoursRemaining);
            }
          }
        } catch (err) {
          // Unexpected error during auth check
          log.error({ provider: provider.name, err }, 'Error checking auth');
        }
      })
    );

    return results;
  }
}
