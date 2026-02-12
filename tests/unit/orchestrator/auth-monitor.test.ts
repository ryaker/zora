import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthMonitor } from '../../../src/orchestrator/auth-monitor.js';
import { MockProvider } from '../../fixtures/mock-provider.js';
import { NotificationTools } from '../../../src/tools/notifications.js';

describe('AuthMonitor', () => {
  let p1: MockProvider;
  let p2: MockProvider;
  let notifications: NotificationTools;
  let monitor: AuthMonitor;

  beforeEach(() => {
    p1 = new MockProvider({ name: 'p1' });
    p2 = new MockProvider({ name: 'p2' });
    notifications = new NotificationTools();
    vi.spyOn(notifications, 'notify').mockResolvedValue(undefined);
    
    monitor = new AuthMonitor({
      providers: [p1, p2],
      notifications,
      preExpiryWarningHours: 2,
    });
  });

  it('reports status for all providers', async () => {
    const results = await monitor.checkAll();
    expect(results.size).toBe(2);
    expect(results.get('p1')!.valid).toBe(true);
    expect(results.get('p2')!.valid).toBe(true);
  });

  it('notifies when auth expires', async () => {
    p1.setAuthValid(false);
    await monitor.checkAll();
    
    expect(notifications.notify).toHaveBeenCalledWith(
      'Authentication Required',
      expect.stringContaining('p1 auth expired')
    );
  });

  it('notifies when token is near expiry', async () => {
    // 1 hour remaining (within the 2 hour warning threshold)
    const expiresAt = new Date(Date.now() + 3600000);
    p2.reset();
    vi.spyOn(p2, 'checkAuth').mockResolvedValue({
      valid: true,
      expiresAt,
      canAutoRefresh: false,
      requiresInteraction: false,
    });

    await monitor.checkAll();
    
    expect(notifications.notify).toHaveBeenCalledWith(
      'Token Near Expiry',
      expect.stringContaining('p2 token expires in ~1h')
    );
  });

  it('does not notify if token is far from expiry', async () => {
    // 5 hours remaining
    const expiresAt = new Date(Date.now() + 5 * 3600000);
    p2.reset();
    vi.spyOn(p2, 'checkAuth').mockResolvedValue({
      valid: true,
      expiresAt,
      canAutoRefresh: false,
      requiresInteraction: false,
    });

    await monitor.checkAll();
    
    expect(notifications.notify).not.toHaveBeenCalledWith(
      'Token Near Expiry',
      expect.any(String)
    );
  });
});
