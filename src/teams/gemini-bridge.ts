/**
 * GeminiBridge — Runs tasks delegated to a team member via its mailbox.
 *
 * Spec v0.6 §5.7 "Gemini Bridge":
 *   - Polls the agent's inbox for unread task messages.
 *   - Runs each task and posts the result back to the sender's inbox.
 *
 * SEC-22 follow-up: the spec says "spawns the Gemini CLI", and it used to. It
 * now submits the task instead, so execution goes through the orchestrator's
 * provider and enforcement chain rather than around it. See `_executeTask`.
 */

import type { Mailbox } from './mailbox.js';
import { createLogger } from '../utils/logger.js';
import type { BridgeWatchdog } from './bridge-watchdog.js';

const log = createLogger('gemini-bridge');

/**
 * Runs a delegated task and returns what to post back.
 *
 * SEC-22 follow-up: this replaced a direct `spawn()` of the Gemini CLI. A
 * function rather than an `Orchestrator` reference so `teams/` does not import
 * `orchestrator/` — the daemon supplies the binding, and the seam stays
 * testable without booting an orchestrator.
 */
export type TeamTaskSubmitter = (request: {
  /** The delegated instruction, verbatim from the inbox message. */
  prompt: string;
  /** Team member that sent it. */
  fromAgent: string;
  teamName: string;
}) => Promise<{ ok: true; output: string } | { ok: false; error: string }>;

export interface GeminiBridgeOptions {
  pollIntervalMs: number;
  /**
   * How a delegated task is executed. Required: without it the bridge has no
   * way to run anything, and defaulting to a subprocess is what this change
   * removed.
   */
  submitTask: TeamTaskSubmitter;
  onPollComplete?: () => void | Promise<void>;
}

export class GeminiBridge {
  private readonly _teamName: string;
  private readonly _mailbox: Mailbox;
  private readonly _pollIntervalMs: number;
  private readonly _submitTask: TeamTaskSubmitter;
  private _onPollComplete?: () => void | Promise<void>;
  private _running = false;
  private _polling = false;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _watchdog?: BridgeWatchdog;

  constructor(
    teamName: string,
    mailbox: Mailbox,
    options: GeminiBridgeOptions,
  ) {
    this._teamName = teamName;
    this._mailbox = mailbox;
    this._pollIntervalMs = options.pollIntervalMs;
    this._submitTask = options.submitTask;
    this._onPollComplete = options.onPollComplete;
  }

  /**
   * Starts polling the inbox for task messages.
   */
  start(): void {
    if (this._running) return;
    this._running = true;

    this._pollTimer = setInterval(() => {
      void this._poll();
    }, this._pollIntervalMs);
  }

  /**
   * Stops polling.
   * The watchdog is NOT detached — use stopPermanently() for full teardown.
   *
   * SEC-22 follow-up: there is no subprocess to kill any more. A task already
   * in flight runs to completion inside the orchestrator, which owns its own
   * cancellation; the `_running` check in `_executeTask` stops its result from
   * being posted after a stop.
   */
  stop(): void {
    this._running = false;

    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /**
   * Permanently tears down the bridge: stops polling and detaches the
   * watchdog. Use this instead of stop() when the bridge is being destroyed
   * (not just restarted by the watchdog).
   */
  stopPermanently(): void {
    if (this._watchdog) {
      this.detachWatchdog();
    }
    this.stop();
  }

  /**
   * Attaches a BridgeWatchdog to this bridge.
   * Stops any previously attached watchdog before wiring the new one.
   * Wires the watchdog heartbeat to the poll-complete callback and starts monitoring.
   */
  attachWatchdog(watchdog: BridgeWatchdog): void {
    if (this._watchdog) {
      this._watchdog.stop();
    }
    this._watchdog = watchdog;
    this.setOnPollComplete(() => watchdog.writeHeartbeat());
    watchdog.start();
  }

  /**
   * Detaches the current watchdog, stopping its health checks.
   * Does NOT clear _onPollComplete — that callback may have been set
   * independently and must survive watchdog detach/re-attach cycles.
   */
  detachWatchdog(): void {
    if (this._watchdog) {
      this._watchdog.stop();
      this._watchdog = undefined;
    }
  }

  isRunning(): boolean {
    return this._running;
  }

  /**
   * Sets the callback invoked after each successful poll cycle.
   * Used by BridgeWatchdog to update the heartbeat.
   */
  setOnPollComplete(callback: () => void | Promise<void>): void {
    this._onPollComplete = callback;
  }

  private async _poll(): Promise<void> {
    if (!this._running || this._polling) return;
    this._polling = true;

    try {
      const messages = await this._mailbox.receive(this._teamName);
      const tasks = messages.filter((m) => m.type === 'task');

      for (const task of tasks) {
        if (!this._running) break;
        await this._executeTask(task.text, task.from);
      }

      // Signal successful poll completion (used by watchdog for heartbeat)
      if (this._onPollComplete) {
        await this._onPollComplete();
      }
    } catch (err) {
      log.error({ err }, 'Poll error');
    } finally {
      this._polling = false;
    }
  }

  /**
   * Runs one delegated task and posts the outcome back to the sender.
   *
   * SEC-22 follow-up: this used to be
   * `spawn(geminiCliPath, ['chat', '--prompt', taskText])`, which is exactly
   * what SEC-22 removed from `GeminiProvider` — argv is world-readable, so
   * every local process could read a delegated prompt out of `ps aux` or
   * /proc/<pid>/cmdline, and a large one died with E2BIG at the 128 KiB
   * MAX_ARG_STRLEN cap. The fix never reached this copy because nothing
   * constructs it, which is the same reason the gap existed at all.
   *
   * Going through the orchestrator instead of a subprocess is not only about
   * that one leak. A raw spawn bypasses the entire enforcement chain — the
   * PreToolUse hook, canUseTool, PolicyEngine, capability tokens, the
   * irreversibility scorer and its approval gate, and the audit log — so a
   * delegated instruction could do things the same instruction typed by the
   * user could not. Submitting a task inherits all of it.
   */
  private async _executeTask(taskText: string, fromAgent: string): Promise<void> {
    let resultText: string;
    try {
      const outcome = await this._submitTask({
        prompt: taskText,
        fromAgent,
        teamName: this._teamName,
      });
      resultText = outcome.ok
        ? outcome.output.trim() || '(no output)'
        : `Error: ${outcome.error}`;
    } catch (err) {
      // A submitter that throws is a bug in the caller's wiring, not a task
      // failure — but the requester still gets an answer rather than silence.
      log.error({ err, fromAgent }, 'Delegated task submission threw');
      resultText = `Error (task submission failed): ${err instanceof Error ? err.message : String(err)}`;
    }

    // Dropped deliberately if the bridge stopped while the task ran: a result
    // arriving after teardown would be posted by a bridge nobody is watching.
    if (!this._running) {
      log.warn({ fromAgent }, 'Bridge stopped before the task finished — result not posted');
      return;
    }

    try {
      await this._mailbox.send(this._teamName, fromAgent, { type: 'result', text: resultText });
    } catch (err) {
      log.error({ err, fromAgent }, 'Failed to send result');
    }
  }
}
