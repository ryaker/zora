import { test, expect } from '@playwright/test';
import { DashboardServer } from '../../../src/dashboard/server.js';
import { ExecutionLoop } from '../../../src/orchestrator/execution-loop.js';
import { SessionManager } from '../../../src/orchestrator/session-manager.js';
import { SteeringManager } from '../../../src/steering/steering-manager.js';
import { AuthMonitor } from '../../../src/orchestrator/auth-monitor.js';
import { MockProvider } from '../../fixtures/mock-provider.js';
import { PolicyEngine } from '../../../src/security/policy-engine.js';
import { NotificationTools } from '../../../src/tools/notifications.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

test.describe('Page Load Journey', () => {
  let server: DashboardServer;
  const testDir = path.join(os.tmpdir(), 'zora-dashboard-synthetic-test');
  const port = 7072;

  test.beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });

    const provider = new MockProvider();
    const engine = new PolicyEngine({
      filesystem: { allowed_paths: [], denied_paths: [], resolve_symlinks: true, follow_symlinks: false },
      shell: { mode: 'deny_all', allowed_commands: [], denied_commands: [], split_chained_commands: true, max_execution_time: '1m' },
      actions: { reversible: [], irreversible: [], always_flag: [] },
      network: { allowed_domains: [], denied_domains: [], max_request_size: '1mb' },
    });
    const sessionManager = new SessionManager(testDir);
    const steeringManager = new SteeringManager(testDir);
    const notifications = new NotificationTools();
    const authMonitor = new AuthMonitor({ providers: [provider], notifications });
    const loop = new ExecutionLoop({ provider, engine, sessionManager, steeringManager });

    server = new DashboardServer({ loop, sessionManager, steeringManager, authMonitor, port });
    await server.start();
  });

  test.afterAll(async () => {
    server.stop();
  });

  test('footer displays version info', async ({ page }) => {
    await page.goto(`http://localhost:${port}`);

    // Wait for page to load
    await expect(page).toHaveTitle(/Zora/);

    // Use getByText with case-insensitive matching to handle CSS text-transform
    // The footer contains "Zora v0.9.0" and "Dashboard" but they're rendered as uppercase
    const footer = page.locator('div.text-\\[10px\\].font-data.text-white\\/40.uppercase.tracking-widest').last();

    // Check footer is visible
    await expect(footer).toBeVisible();

    // Verify the text content (checking actual DOM text, not rendered uppercase)
    const footerText = await footer.textContent();
    expect(footerText).toContain('Zora v0.9.0');
    expect(footerText).toContain('Dashboard');
  });
});
