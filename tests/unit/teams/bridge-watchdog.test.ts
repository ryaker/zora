import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BridgeWatchdog } from '../../../src/teams/bridge-watchdog.js';
import type { GeminiBridge } from '../../../src/teams/gemini-bridge.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('BridgeWatchdog', () => {
  const testDir = path.join(os.tmpdir(), `zora-watchdog-test-${Date.now()}`);
  let mockBridge: GeminiBridge;
  let watchdog: BridgeWatchdog;

  beforeEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
    await fs.mkdir(testDir, { recursive: true });

    mockBridge = {
      start: vi.fn(),
      stop: vi.fn(),
      isRunning: vi.fn(() => true),
    } as unknown as GeminiBridge;
  });

  afterEach(async () => {
    if (watchdog) watchdog.stop();
    vi.restoreAllMocks();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('starts and stops monitoring', async () => {
    watchdog = new BridgeWatchdog(mockBridge, {
      healthCheckIntervalMs: 100,
      maxStaleMs: 500,
      maxRestarts: 3,
      stateDir: testDir,
    });

    await watchdog.start();
    watchdog.stop();
    // Should not throw
  });

  it('writes heartbeat file', async () => {
    watchdog = new BridgeWatchdog(mockBridge, {
      healthCheckIntervalMs: 100,
      maxStaleMs: 500,
      maxRestarts: 3,
      stateDir: testDir,
    });

    await watchdog.writeHeartbeat();

    const healthPath = path.join(testDir, 'bridge-health.json');
    const content = await fs.readFile(healthPath, 'utf8');
    const data = JSON.parse(content);
    expect(data.lastHeartbeat).toBeTypeOf('string');
    const ts = new Date(data.lastHeartbeat).getTime();
    expect(Date.now() - ts).toBeLessThan(2000);
  });

  it('detects stale heartbeat and restarts bridge', async () => {
    watchdog = new BridgeWatchdog(mockBridge, {
      healthCheckIntervalMs: 50,
      maxStaleMs: 10,
      maxRestarts: 5,
      stateDir: testDir,
    });

    // Start writes a fresh heartbeat, so we need to make it stale after start
    await watchdog.start();

    // Overwrite with a stale heartbeat after start
    const healthPath = path.join(testDir, 'bridge-health.json');
    await fs.writeFile(
      healthPath,
      JSON.stringify({ lastHeartbeat: new Date(Date.now() - 5000).toISOString(), restartCount: 0 }),
    );

    // Wait long enough for interval to fire + backoff (1s min) + restart
    await new Promise((resolve) => setTimeout(resolve, 1500));
    watchdog.stop();

    expect(mockBridge.stop).toHaveBeenCalled();
    expect(mockBridge.start).toHaveBeenCalled();
  });

  it('tracks restart count via health state', async () => {
    watchdog = new BridgeWatchdog(mockBridge, {
      healthCheckIntervalMs: 50,
      maxStaleMs: 10,
      maxRestarts: 10,
      stateDir: testDir,
    });

    await watchdog.start();

    // Overwrite with stale heartbeat
    const healthPath = path.join(testDir, 'bridge-health.json');
    await fs.writeFile(
      healthPath,
      JSON.stringify({ lastHeartbeat: new Date(Date.now() - 10000).toISOString(), restartCount: 0 }),
    );

    // Wait for detection + backoff
    await new Promise((resolve) => setTimeout(resolve, 1500));
    watchdog.stop();

    // Verify restartCount was updated
    const content = await fs.readFile(healthPath, 'utf8');
    const data = JSON.parse(content);
    expect(data.restartCount).toBeGreaterThanOrEqual(1);
  });

  it('respects maxRestarts limit', async () => {
    watchdog = new BridgeWatchdog(mockBridge, {
      healthCheckIntervalMs: 30,
      maxStaleMs: 1,
      maxRestarts: 1,
      stateDir: testDir,
    });

    await watchdog.start();

    // Overwrite heartbeat to be stale
    const healthPath = path.join(testDir, 'bridge-health.json');
    await fs.writeFile(
      healthPath,
      JSON.stringify({ lastHeartbeat: new Date(Date.now() - 60000).toISOString(), restartCount: 0 }),
    );

    // Wait for health check + backoff + detection of second stale
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Bridge.stop should have been called at least once due to restart
    expect(mockBridge.stop).toHaveBeenCalled();
  });
});
