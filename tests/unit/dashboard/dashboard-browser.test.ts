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

test.describe('Zora Tactical Dashboard', () => {
  let server: DashboardServer;
  const testDir = path.join(os.tmpdir(), 'zora-dashboard-test');
  const port = 7071;

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

  test('loads the tactical interface', async ({ page }) => {
    await page.goto(`http://localhost:${port}`);
    await expect(page).toHaveTitle(/Zora — Tactical Interface/);
    await expect(page.locator('text=ZORA // TACTICAL INTERFACE')).toBeVisible();
  });

  test('injects steering message via UI', async ({ page }) => {
    await page.goto(`http://localhost:${port}`);
    
    const input = page.locator('[placeholder="INPUT COMMAND..."]');
    await input.fill('Engage impulse engines');
    await page.click('text=SEND');

    // Check if logs updated in UI
    await expect(page.locator('text=Course correction injected: Engage impulse engines')).toBeVisible();
  });
});
