/**
 * BridgeWatchdog — Monitors the GeminiBridge health and restarts on stale heartbeats.
 *
 * Spec v0.6 §5.7 "Bridge Watchdog":
 *   - Reads/writes state/bridge-health.json
 *   - Restarts bridge with exponential backoff if heartbeat goes stale.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { GeminiBridge } from './gemini-bridge.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('bridge-watchdog');

export interface BridgeWatchdogOptions {
  healthCheckIntervalMs: number;
  maxStaleMs: number;
  maxRestarts: number;
  stateDir: string;
}

interface HealthState {
  lastHeartbeat: string;
  restartCount: number;
  lastRestart?: string;
}

export class BridgeWatchdog {
  private readonly _bridge: GeminiBridge;
  private readonly _healthCheckIntervalMs: number;
  private readonly _maxStaleMs: number;
  private readonly _maxRestarts: number;
  private readonly _healthFilePath: string;
  private _checkTimer: ReturnType<typeof setInterval> | null = null;
  private _running = false;
  private _restartCount = 0;
  private _checking = false;

  constructor(bridge: GeminiBridge, options: BridgeWatchdogOptions) {
    this._bridge = bridge;
    this._healthCheckIntervalMs = options.healthCheckIntervalMs;
    this._maxStaleMs = options.maxStaleMs;
    this._maxRestarts = options.maxRestarts;
    this._healthFilePath = path.join(options.stateDir, 'bridge-health.json');
  }

  /**
   * Starts health check monitoring.
   * Injects a heartbeat callback into the bridge so each successful
   * poll cycle updates the heartbeat timestamp.
   */
  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;

    await fs.mkdir(path.dirname(this._healthFilePath), { recursive: true });
    await this.writeHeartbeat();

    // Inject heartbeat callback into the bridge so the heartbeat is
    // updated after each successful poll cycle.
    this._bridge.setOnPollComplete(() => this.writeHeartbeat());

    this._checkTimer = setInterval(() => {
      void this._check();
    }, this._healthCheckIntervalMs);
  }

  /**
   * Stops health check monitoring.
   */
  stop(): void {
    this._running = false;
    if (this._checkTimer) {
      clearInterval(this._checkTimer);
      this._checkTimer = null;
    }
  }

  /**
   * Writes a heartbeat timestamp to the health file.
   */
  async writeHeartbeat(): Promise<void> {
    const state = await this._readState();
    state.lastHeartbeat = new Date().toISOString();
    await this._writeState(state);
  }

  private async _check(): Promise<void> {
    if (!this._running || this._checking) return;
    this._checking = true;

    try {
      const state = await this._readState();
      const lastBeat = new Date(state.lastHeartbeat).getTime();
      const elapsed = Date.now() - lastBeat;

      if (elapsed > this._maxStaleMs) {
        if (this._restartCount >= this._maxRestarts) {
          log.error({ maxRestarts: this._maxRestarts }, 'Max restarts exceeded, stopping watchdog');
          this.stop();
          return;
        }

        // Exponential backoff: 1s, 2s, 4s, 8s... capped at 60s
        const backoffMs = Math.min(1000 * Math.pow(2, this._restartCount), 60_000);
        this._restartCount++;

        log.warn({ elapsedMs: elapsed, attempt: this._restartCount, maxRestarts: this._maxRestarts, backoffMs }, 'Heartbeat stale, restarting bridge');

        this._bridge.stop();

        await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));

        if (this._running) {
          this._bridge.start();
          await this.writeHeartbeat();

          // Re-read state to avoid overwriting concurrent heartbeat updates
          const freshState = await this._readState();
          freshState.restartCount = this._restartCount;
          freshState.lastRestart = new Date().toISOString();
          await this._writeState(freshState);
        }
      }
    } catch (err) {
      log.error({ err }, 'Health check error');
    } finally {
      this._checking = false;
    }
  }

  private async _readState(): Promise<HealthState> {
    try {
      const content = await fs.readFile(this._healthFilePath, 'utf8');
      return JSON.parse(content) as HealthState;
    } catch {
      return {
        lastHeartbeat: new Date().toISOString(),
        restartCount: 0,
      };
    }
  }

  private async _writeState(state: HealthState): Promise<void> {
    await fs.mkdir(path.dirname(this._healthFilePath), { recursive: true });
    await fs.writeFile(this._healthFilePath, JSON.stringify(state, null, 2), 'utf8');
  }
}
