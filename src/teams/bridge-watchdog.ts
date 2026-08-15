/**
 * BridgeWatchdog — Monitors a poller's health and restarts it on stale heartbeats.
 *
 * Spec v0.6 §5.7 "Bridge Watchdog":
 *   - Reads/writes state/bridge-health.json
 *   - Restarts the supervised poller with exponential backoff if the heartbeat
 *     goes stale.
 *
 * ERR-21 follow-up: the spec says "bridge", and this supervised `GeminiBridge`
 * — a class constructed nowhere in src/, so the fail-closed fix landed on
 * something that never runs. It now supervises any `SupervisedPoller`, which in
 * the daemon is the team `MailboxChannelAdapter`. GeminiBridge itself is gone:
 * the adapter does what it did, through the ChannelManager pipeline.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from '../utils/logger.js';
import { writeAtomic } from '../utils/fs.js';

const log = createLogger('bridge-watchdog');

/**
 * What the watchdog supervises.
 *
 * ERR-21 follow-up: this was typed as `GeminiBridge`, which was constructed
 * nowhere in `src/` — so the fail-closed fix protected a component that never
 * ran. The watchdog only ever needs three things, and naming them as an
 * interface lets it supervise whatever actually polls, which is
 * `MailboxChannelAdapter`.
 */
export interface SupervisedPoller {
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  /** Called after each successful poll cycle; drives the heartbeat. */
  setOnPollComplete(callback: () => void | Promise<void>): void;
}

/**
 * ERR-21: how far ahead of now a heartbeat may legitimately be.
 *
 * Covers an NTP step or a slightly fast clock between the write and the read.
 * Anything beyond it is a damaged or forged file, not a clock difference.
 */
const MAX_CLOCK_SKEW_MS = 60_000;

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

/**
 * ERR-21: the outcome of reading the health file, with "absent" kept distinct
 * from "unusable".
 *
 * The distinction is the whole fix. `_readState()` used to answer every failure
 * with a fresh heartbeat, which is only the right answer for one of these three
 * cases; for the other two it is a lie that the caller cannot detect, and
 * `_check()` believed it.
 */
type ReadResult =
  | { ok: true; state: HealthState }
  /** The file does not exist yet. `start()` has not run, or state was wiped. */
  | { ok: false; reason: 'missing' }
  /** The file exists but its last-heartbeat time cannot be established. */
  | { ok: false; reason: 'unusable'; detail: string };

export class BridgeWatchdog {
  private readonly _bridge: SupervisedPoller;
  private readonly _healthCheckIntervalMs: number;
  private readonly _maxStaleMs: number;
  private readonly _maxRestarts: number;
  private readonly _healthFilePath: string;
  private _checkTimer: ReturnType<typeof setInterval> | null = null;
  private _running = false;
  private _restartCount = 0;
  private _checking = false;

  constructor(bridge: SupervisedPoller, options: BridgeWatchdogOptions) {
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
   *
   * ERR-21: this is the one path that may legitimately overwrite an unusable
   * file. It runs from the bridge's poll-completion callback, so reaching it at
   * all is positive evidence that the bridge is alive — writing a current
   * heartbeat is the truth, not an assumption, and it heals a damaged file
   * instead of leaving the watchdog to restart a working bridge forever. The
   * damage is logged on the way past so a recurring corruption is visible.
   */
  async writeHeartbeat(): Promise<void> {
    const read = await this._readState();
    if (!read.ok && read.reason === 'unusable') {
      log.warn(
        { healthFile: this._healthFilePath, detail: read.detail },
        'Health file unusable; rewriting it from a live poll heartbeat',
      );
    }
    const state = read.ok ? read.state : this._freshState();
    state.lastHeartbeat = new Date().toISOString();
    await this._writeState(state);
  }

  private async _check(): Promise<void> {
    if (!this._running || this._checking) return;
    this._checking = true;

    try {
      // ERR-21: fail CLOSED. The check has exactly one question to answer —
      // how long since the last heartbeat — and if it cannot answer it, the
      // safe reading is "too long", not "no time at all". An absent file counts
      // as unanswerable too: `start()` writes one before the first check, so a
      // missing file at check time means state was lost, not that the bridge is
      // fresh. The restart path rewrites the file, so a single bad read heals
      // itself; a persistently unreadable state directory exhausts maxRestarts
      // and stops the watchdog loudly, which is the outcome this gap is about.
      const read = await this._readState();
      let elapsed: number;
      if (read.ok) {
        elapsed = Date.now() - new Date(read.state.lastHeartbeat).getTime();
      } else {
        elapsed = Number.POSITIVE_INFINITY;
        log.error(
          {
            healthFile: this._healthFilePath,
            reason: read.reason,
            ...(read.reason === 'unusable' ? { detail: read.detail } : {}),
          },
          'Cannot determine last heartbeat; treating bridge as stale',
        );
      }

      if (elapsed > this._maxStaleMs) {
        if (this._restartCount >= this._maxRestarts) {
          log.error({ maxRestarts: this._maxRestarts }, 'Max restarts exceeded, stopping watchdog');
          this.stop();
          return;
        }

        // Exponential backoff: 1s, 2s, 4s, 8s... capped at 60s
        const backoffMs = Math.min(1000 * Math.pow(2, this._restartCount), 60_000);
        this._restartCount++;

        // ERR-21: the fail-closed path sets elapsed to Infinity, which JSON
        // serialises to null — indistinguishable in the log from a field that
        // was never set. Name the case instead.
        log.warn(
          {
            elapsedMs: Number.isFinite(elapsed) ? elapsed : 'unknown (health file unreadable)',
            attempt: this._restartCount,
            maxRestarts: this._maxRestarts,
            backoffMs,
          },
          'Heartbeat stale, restarting bridge',
        );

        await this._bridge.stop();

        await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));

        if (this._running) {
          await this._bridge.start();
          await this.writeHeartbeat();

          // Re-read state to avoid overwriting concurrent heartbeat updates.
          // ERR-21: `writeHeartbeat()` above has just rewritten the file, so a
          // read failure here is new damage rather than the one being healed;
          // fall back to a current heartbeat so the restart is still recorded
          // and the next check has a timestamp to measure against.
          const reread = await this._readState();
          const freshState = reread.ok ? reread.state : this._freshState();
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

  /**
   * ERR-21: reads the health file without inventing a heartbeat.
   *
   * Every failure here used to collapse into `{ lastHeartbeat: now }`, which
   * made an unreadable file indistinguishable from a perfectly healthy bridge
   * that had just checked in. That is a fail-open: a corrupt file, a bad
   * permission, a directory where the file should be, or a `{}` document all
   * produced an elapsed time of ~0 forever, so the staleness branch in
   * `_check()` became unreachable and the watchdog stopped watching in silence.
   *
   * The shape check is part of the same hole rather than an extra: JSON.parse
   * succeeds on `{}` and on `{"lastHeartbeat":"banana"}`, and
   * `new Date(...).getTime()` then yields NaN. Every comparison against NaN is
   * false, so `elapsed > maxStaleMs` is false and the watchdog goes blind
   * through a path that never throws and never logs. `lastHeartbeat` is
   * therefore validated strictly; `restartCount` is not, because it is only
   * persisted for observability — the restart limit is enforced against the
   * in-memory `this._restartCount`.
   */
  private async _readState(): Promise<ReadResult> {
    let content: string;
    try {
      content = await fs.readFile(this._healthFilePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: false, reason: 'missing' };
      }
      return { ok: false, reason: 'unusable', detail: `unreadable: ${String(err)}` };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch (err) {
      return { ok: false, reason: 'unusable', detail: `unparseable: ${String(err)}` };
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return { ok: false, reason: 'unusable', detail: 'not a JSON object' };
    }

    const record = parsed as Record<string, unknown>;
    const lastHeartbeat = record.lastHeartbeat;
    if (typeof lastHeartbeat !== 'string') {
      return { ok: false, reason: 'unusable', detail: 'lastHeartbeat missing or not a string' };
    }
    const beatMs = new Date(lastHeartbeat).getTime();
    if (!Number.isFinite(beatMs)) {
      return { ok: false, reason: 'unusable', detail: 'lastHeartbeat is not a valid date' };
    }
    // ERR-21 follow-up (review finding): a *future* heartbeat is the same
    // fail-open in a different costume. It parses, so the check above waved it
    // through; `_check()` then computes a negative elapsed time, and
    // `elapsed > maxStaleMs` stays false until that timestamp arrives. A health
    // file dated next year therefore disables restart detection for a year,
    // silently — which is precisely what this gap was about. Only a small skew
    // allowance is legitimate, for a clock that stepped between write and read.
    if (beatMs - Date.now() > MAX_CLOCK_SKEW_MS) {
      return {
        ok: false,
        reason: 'unusable',
        detail: `lastHeartbeat is ${Math.round((beatMs - Date.now()) / 1000)}s in the future`,
      };
    }

    const restartCount = typeof record.restartCount === 'number' && Number.isFinite(record.restartCount)
      ? record.restartCount
      : 0;

    return {
      ok: true,
      state: {
        lastHeartbeat,
        restartCount,
        ...(typeof record.lastRestart === 'string' ? { lastRestart: record.lastRestart } : {}),
      },
    };
  }

  /**
   * ERR-21: the state to build on when the file could not be read.
   *
   * `restartCount` comes from the in-memory counter rather than from 0, so
   * healing a damaged file cannot hand the bridge a fresh budget of restarts.
   */
  private _freshState(): HealthState {
    return {
      lastHeartbeat: new Date().toISOString(),
      restartCount: this._restartCount,
    };
  }

  /**
   * TEST-20: writes the health file atomically (temp file + rename).
   *
   * A plain `fs.writeFile` here is a real corruption hazard, not a theoretical
   * one: nothing serialises the writers. `writeHeartbeat()` is called from the
   * bridge's poll-completion callback while `_check()` runs on its own
   * interval and writes the same file from its restart path, so two writes can
   * be in flight at once. When they interleave, the file ends up with one
   * document spliced into another — observed in a test run as
   * `{ "lastHeartbeat": ..., "restartCount": 0 } "lastRestart": ... }`.
   *
   * That used to be unrecoverable rather than transient, because
   * `_readState()` treated any read or parse failure as "no state yet" and
   * returned a *fresh* heartbeat: once the file was invalid, every health check
   * saw an elapsed time of ~0 and the watchdog never restarted the bridge
   * again. ERR-21 closed that second half — an unreadable file now reads as
   * stale and provokes a restart, which rewrites the file — so corruption is
   * survivable. This atomic write remains the first line of defence: it stops
   * the corruption happening at all, rather than relying on recovery from it.
   * A rename is atomic, so a reader sees either the whole previous document or
   * the whole new one.
   */
  private async _writeState(state: HealthState): Promise<void> {
    await writeAtomic(this._healthFilePath, JSON.stringify(state, null, 2));
  }
}
