import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/unit/dashboard',
  testMatch: ['dashboard-browser.test.ts', 'dashboard-synthetic.test.ts'],
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:7071',
  },
  webServer: undefined, // Tests manage their own server lifecycle
});
