import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BridgeWatchdog } from '../../../src/teams/bridge-watchdog.js';
import type { GeminiBridge } from '../../../src/teams/gemini-bridge.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('BridgeWatchdog', () => {
  const testDir = path.join(os.tmpdir(), `zora-watchdog-test-${Date.now()}`);
  const stateDir = path.join(testDir, 'state');

  let mockBridge: GeminiBridge;

  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});

    mockBridge = {
      start: vi.fn(),
      stop: vi.fn(),
      isRunning: vi.fn().mockReturnValue(true),
    } as unknown as GeminiBridge;
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('writes heartbeat file on start', async () => {
    const watchdog = new BridgeWatchdog(mockBridge, {
      healthCheckIntervalMs: 10000,
      maxStaleMs: 50000,
      maxRestarts: 3,
      stateDir,
    });

    await watchdog.start();
    watchdog.stop();

    const healthFile = path.join(stateDir, 'bridge-health.json');
    const content = JSON.parse(await fs.readFile(healthFile, 'utf8'));
    expect(content.lastHeartbeat).toBeDefined();
    expect(new Date(content.lastHeartbeat).getTime()).toBeGreaterThan(0);
  });

  it('writeHeartbeat updates timestamp', async () => {
    const watchdog = new BridgeWatchdog(mockBridge, {
      healthCheckIntervalMs: 10000,
      maxStaleMs: 50000,
      maxRestarts: 3,
      stateDir,
    });

    await watchdog.start();

    const healthFile = path.join(stateDir, 'bridge-health.json');
    const first = JSON.parse(await fs.readFile(healthFile, 'utf8'));

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 10));
    await watchdog.writeHeartbeat();

    const second = JSON.parse(await fs.readFile(healthFile, 'utf8'));
    expect(new Date(second.lastHeartbeat).getTime()).toBeGreaterThanOrEqual(
      new Date(first.lastHeartbeat).getTime(),
    );

    watchdog.stop();
  });

  it('detects stale heartbeat and restarts bridge', async () => {
    // Use very short intervals to speed up the test.
    // maxStaleMs=50ms means heartbeat goes stale fast.
    // healthCheckIntervalMs=30ms means we check frequently.
    // After detection, backoff starts at 1000ms, so we need to wait for that.
    const watchdog = new BridgeWatchdog(mockBridge, {
      healthCheckIntervalMs: 30,
      maxStaleMs: 50,
      maxRestarts: 5,
      stateDir,
    });

    await watchdog.start();

    // Need to wait for: stale detection (~80ms) + backoff (1000ms) + bridge restart
    await new Promise((r) => setTimeout(r, 1600));

    watchdog.stop();

    // After first restart cycle, bridge.stop() and bridge.start() should both have been called
    expect(mockBridge.stop).toHaveBeenCalled();
    expect(mockBridge.start).toHaveBeenCalled();
  }, 5000);

  it('stops after max restarts exceeded', async () => {
    const watchdog = new BridgeWatchdog(mockBridge, {
      healthCheckIntervalMs: 30,
      maxStaleMs: 20,
      maxRestarts: 2,
      stateDir,
    });

    await watchdog.start();

    // Wait for 2 restarts with backoff 1s + 2s = ~4s
    await new Promise((r) => setTimeout(r, 5000));

    // Bridge stop should have been called at least maxRestarts times
    const stopCalls = vi.mocked(mockBridge.stop).mock.calls.length;
    expect(stopCalls).toBeGreaterThanOrEqual(2);

    watchdog.stop();
  }, 10000);

  it('starts and stops cleanly', async () => {
    const watchdog = new BridgeWatchdog(mockBridge, {
      healthCheckIntervalMs: 10000,
      maxStaleMs: 50000,
      maxRestarts: 3,
      stateDir,
    });

    await watchdog.start();
    watchdog.stop();

    const stopCountBefore = vi.mocked(mockBridge.stop).mock.calls.length;
    await new Promise((r) => setTimeout(r, 100));
    const stopCountAfter = vi.mocked(mockBridge.stop).mock.calls.length;

    // No new calls after stop
    expect(stopCountAfter).toBe(stopCountBefore);
  });
});
