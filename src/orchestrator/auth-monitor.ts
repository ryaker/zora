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
            await this._notifications.notify(
              'Authentication Required',
              `${provider.name} auth expired. Please re-authenticate in the desktop app or CLI.`
            );
            // In a full implementation, we would call checkpointActiveJobs(provider.name) here
          } else if (auth.valid && auth.expiresAt) {
            const hoursRemaining = (auth.expiresAt.getTime() - Date.now()) / MS_PER_HOUR;
            if (hoursRemaining > 0 && hoursRemaining < this._preExpiryWarningHours) {
              await this._notifications.notify(
                'Token Near Expiry',
                `${provider.name} token expires in ~${Math.round(hoursRemaining)}h.`
              );
            }
          }
        } catch (err) {
          // Unexpected error during auth check
          console.error(`Error checking auth for ${provider.name}:`, err);
        }
      })
    );

    return results;
  }
}
