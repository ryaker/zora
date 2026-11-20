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
  const jobId = 'job_browser_test';
  let submittedPrompt: string | undefined;

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

    server = new DashboardServer({
      loop, sessionManager, steeringManager, authMonitor, port,
      submitTask: async (prompt) => {
        submittedPrompt = prompt;
        return jobId;
      },
    });
    await server.start();
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('loads the tactical interface', async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('zora_onboarding_complete', 'true'); });
    await page.goto(`http://localhost:${port}`);
    await expect(page).toHaveTitle(/Zora — Tactical Interface/);
    await expect(page.locator('text=ZORA / DASHBOARD')).toBeVisible();
  });

  test('submits a task via chat and displays its final result', async ({ page }) => {
    // Dismiss onboarding overlay so the main input is interactive
    await page.addInitScript(() => { localStorage.setItem('zora_onboarding_complete', 'true'); });
    const connected = page.waitForResponse(response => response.url().endsWith('/api/events') && response.ok());
    await page.goto(`http://localhost:${port}`);
    await connected;

    const input = page.locator('[placeholder="Ask Zora to do something..."]');
    await input.fill('Engage impulse engines');
    const submitted = page.waitForResponse(response => response.url().endsWith('/api/task') && response.request().method() === 'POST');
    await page.click('button:has-text("SEND")');

    expect((await submitted).ok()).toBe(true);
    expect(submittedPrompt).toBe('Engage impulse engines');
    await expect(page.getByText('Working...', { exact: true })).toBeVisible();
    server.broadcastEvent({ type: 'done', data: { jobId, text: `Completed: ${submittedPrompt}` } });
    await expect(page.getByText('Completed: Engage impulse engines', { exact: true })).toBeVisible();
    await expect(page.getByText('Working...', { exact: true })).toBeHidden();
  });
});
