/**
 * HITL escalation is wired end to end — SEC-27.
 *
 * `IrreversibilityScorerHook` has always denied flagged actions with the reason
 * `approval_required:{score}`, and `ApprovalQueue`'s own docstring said the
 * orchestrator "should call ApprovalQueue.request() before proceeding". Nothing
 * did. The hook held no queue reference, so the flag threshold was simply a
 * second auto-deny threshold and the escalation existed only as a string in a
 * denial message — the same build-it-and-wire-it-to-nothing shape as
 * `graph_recall` and the risk forecaster.
 *
 * Underneath it was also a SEC-29 parity bug: `cli/daemon.ts` was the only
 * place that constructed an ApprovalQueue at all, so even a correctly wired
 * hook would have had nothing to escalate to under `zora-agent ask`.
 *
 * These tests therefore assert on what a *booted Orchestrator* holds and does,
 * not on a hook chain the test assembled itself — a test that builds its own
 * wiring cannot notice wiring that is missing. They reach the orchestrator's
 * real `_toolHookRunner` and push a tool call through it exactly as the
 * `PreToolUse` bridge does.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Orchestrator } from '../../src/orchestrator/orchestrator.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { MockProvider } from '../fixtures/mock-provider.js';
import {
  ApprovalQueue,
  approvalConfigFrom,
  DEFAULT_APPROVAL_CONFIG,
} from '../../src/core/approval-queue.js';
import type { ToolHookRunner } from '../../src/hooks/tool-hook-runner.js';
import type { ZoraPolicy, ZoraConfig } from '../../src/types.js';

const testPolicy: ZoraPolicy = {
  filesystem: { allowed_paths: ['/tmp'], denied_paths: [], resolve_symlinks: false, follow_symlinks: false },
  shell: { mode: 'allowlist', allowed_commands: ['echo'], denied_commands: [], split_chained_commands: true, max_execution_time: '30s' },
  actions: { reversible: [], irreversible: [], always_flag: [] },
  network: { allowed_domains: [], denied_domains: [], max_request_size: '10MB' },
};

/**
 * `send_message` scores 80 against the defaults: over the flag threshold (65),
 * under auto-deny (95). That window is the only one where approval means
 * anything — below it nothing is asked, above it nothing is asked either.
 */
const FLAGGED_TOOL = 'send_message';
const FLAGGED_SCORE = 80;

/** Internals this file reaches into, rather than rebuilding them. */
interface OrchestratorInternals {
  _toolHookRunner: ToolHookRunner;
  _approvalQueue?: ApprovalQueue;
}

describe('SEC-27 — a flagged tool call escalates to the approval queue', () => {
  let baseDir: string | null = null;
  let orchestrator: Orchestrator | null = null;

  afterEach(async () => {
    await orchestrator?.shutdown().catch(() => { /* teardown is not under test */ });
    if (baseDir) await fsp.rm(baseDir, { recursive: true, force: true }).catch(() => { /* temp dir */ });
    orchestrator = null;
    baseDir = null;
  });

  /**
   * Boots an Orchestrator the way both entry points do, with an `[approval]`
   * block that is untyped in config and so has to be attached the same way
   * `boot()` reads it.
   */
  async function boot(opts: { approval?: Record<string, unknown>; autoApproveLowRisk?: boolean } = {}): Promise<{
    runner: ToolHookRunner;
    queue: ApprovalQueue;
  }> {
    baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zora-sec27-'));
    const config = structuredClone(DEFAULT_CONFIG);
    config.agent.log_level = 'error';
    config.agent.workspace = path.join(baseDir, 'workspace');
    if (opts.autoApproveLowRisk !== undefined) {
      config.steering.auto_approve_low_risk = opts.autoApproveLowRisk;
    }
    if (opts.approval) {
      (config as unknown as Record<string, unknown>)['approval'] = opts.approval;
    }

    orchestrator = new Orchestrator({
      config: config as ZoraConfig,
      policy: testPolicy,
      providers: [new MockProvider({ name: 'primary', rank: 1 })],
      baseDir,
      skipChannels: true,
    });
    // Note: no setApprovalQueue() call. The queue under test is the one boot()
    // builds for itself — which is exactly what the `ask` path gets, and what
    // did not exist at all before this gap.
    await orchestrator.boot();

    const internals = orchestrator as unknown as OrchestratorInternals;
    expect(
      internals._approvalQueue,
      'a booted Orchestrator holds no ApprovalQueue — IrreversibilityScorerHook has ' +
        'nothing to escalate to, so every flagged action is denied outright with no ' +
        'way for a human to approve it. This is the `zora-agent ask` path.',
    ).toBeDefined();

    return { runner: internals._toolHookRunner, queue: internals._approvalQueue! };
  }

  /** Runs a tool call through the orchestrator's real before-hook chain. */
  function callFlaggedTool(runner: ToolHookRunner, jobId: string): Promise<{ allow: boolean; reason?: string }> {
    return runner.runBefore({
      jobId,
      tool: FLAGGED_TOOL,
      arguments: { to: 'someone', body: 'hello' },
    });
  }

  /** Answers the next approval request with `decision`, and records what was sent. */
  function autoRespond(queue: ApprovalQueue, decision: 'allow' | 'deny'): { sent: string[] } {
    const sent: string[] = [];
    queue.setSendHandler(async (message: string) => {
      sent.push(message);
      const token = /Token: `(ZORA-[A-Z0-9]{4})`/.exec(message)?.[1];
      // The pending entry is registered after the send handler returns, so the
      // reply has to come from a later tick.
      if (token) setImmediate(() => queue.handleReply(token, decision));
    });
    return { sent };
  }

  it('asks the human, and proceeds when the human approves', async () => {
    const { runner, queue } = await boot({ approval: { enabled: true, timeout_s: 20 } });
    const { sent } = autoRespond(queue, 'allow');

    const result = await callFlaggedTool(runner, 'sec27-allow');

    expect(
      sent.length,
      'no approval request was sent — the hook denied without consulting the queue, ' +
        'which is the SEC-27 bug: approval_required was a dead-end string',
    ).toBe(1);
    expect(sent[0]).toContain(FLAGGED_TOOL);
    expect(sent[0]).toContain(`${FLAGGED_SCORE}/100`);
    expect(result.allow, 'approved by a human but still blocked').toBe(true);
  }, 40_000);

  it('denies when the human denies', async () => {
    const { runner, queue } = await boot({ approval: { enabled: true, timeout_s: 20 } });
    autoRespond(queue, 'deny');

    const result = await callFlaggedTool(runner, 'sec27-deny');

    expect(result.allow).toBe(false);
    // The original reason is kept as a prefix — the audit log keys off it.
    expect(result.reason).toMatch(/^approval_required:80/);
    expect(result.reason).toContain('denied at approval gate');
  }, 40_000);

  /**
   * The fail-closed half. Enabling approval must not open a hole when there is
   * nobody on the other end: with no send handler the queue auto-denies, which
   * is the same answer the hook gave before this gap.
   */
  it('denies when approval is enabled but nothing can deliver the request', async () => {
    const { runner } = await boot({ approval: { enabled: true, timeout_s: 20 } });

    const result = await callFlaggedTool(runner, 'sec27-nobody');

    expect(result.allow).toBe(false);
    expect(result.reason).toMatch(/^approval_required:80/);
  }, 40_000);

  /**
   * Default behaviour is unchanged. `approval.enabled` defaults to false, and a
   * disabled queue must deny outright rather than block a task for five minutes
   * waiting for a reply nobody was asked for.
   */
  it('denies outright, without asking, when approval is disabled', async () => {
    const { runner, queue } = await boot();
    const { sent } = autoRespond(queue, 'allow');

    const result = await callFlaggedTool(runner, 'sec27-disabled');

    expect(queue.isEnabled()).toBe(false);
    expect(sent, 'a disabled queue must not send approval requests').toEqual([]);
    expect(result.allow).toBe(false);
    expect(result.reason).toBe(`approval_required:${FLAGGED_SCORE}`);
  }, 40_000);

  /**
   * `steering.auto_approve_low_risk` was applied in `cli/daemon.ts` only, so
   * the same config field meant different things depending on how the task was
   * started. Asserting on the booted queue's behaviour rather than on a private
   * flag: a low-score request resolves true with no send handler registered,
   * which can only happen if boot() pre-activated the blanket window.
   */
  it('applies steering.auto_approve_low_risk at boot, not just in the daemon', async () => {
    const { queue } = await boot({
      approval: { enabled: true, timeout_s: 20 },
      autoApproveLowRisk: true,
    });

    await expect(
      queue.request({ action: 'read_file', score: 5, jobId: 'sec27-blanket', tool: 'read' }),
    ).resolves.toBe(true);
  }, 40_000);
});

/**
 * The `[approval]` block is user-editable TOML that decides whether the agent
 * stops to ask. How it reads a wrong value is part of the enforcement surface.
 * This parser was inline in `cli/daemon.ts`; moving it to `approval-queue.ts`
 * is what made it one function shared by both entry points instead of a block
 * that only one of them had.
 */
describe('SEC-27 — approvalConfigFrom falls back instead of weakening the gate', () => {
  it('defaults to disabled when the block is absent or not a table', () => {
    expect(approvalConfigFrom(undefined).enabled).toBe(false);
    expect(approvalConfigFrom(null).enabled).toBe(false);
    expect(approvalConfigFrom('yes').enabled).toBe(false);
    expect(approvalConfigFrom(42).enabled).toBe(false);
  });

  it('only enables on a real boolean true', () => {
    expect(approvalConfigFrom({ enabled: true }).enabled).toBe(true);
    // A string is what a TOML typo produces. Truthy in JS, and enabling the
    // gate on a typo is the benign direction — but so is refusing to guess.
    expect(approvalConfigFrom({ enabled: 'true' }).enabled).toBe(false);
    expect(approvalConfigFrom({ enabled: 1 }).enabled).toBe(false);
    expect(approvalConfigFrom({}).enabled).toBe(false);
  });

  it('rejects a timeout that would auto-deny instantly or never', () => {
    // 0 or negative would fire the auto-deny timer immediately, turning every
    // approval request into an instant denial; NaN would make setTimeout fire
    // at once too. All fall back to the 5-minute default.
    expect(approvalConfigFrom({ timeout_s: 0 }).timeoutMs).toBe(DEFAULT_APPROVAL_CONFIG.timeoutMs);
    expect(approvalConfigFrom({ timeout_s: -30 }).timeoutMs).toBe(DEFAULT_APPROVAL_CONFIG.timeoutMs);
    expect(approvalConfigFrom({ timeout_s: Number.NaN }).timeoutMs).toBe(DEFAULT_APPROVAL_CONFIG.timeoutMs);
    expect(approvalConfigFrom({ timeout_s: '60' }).timeoutMs).toBe(DEFAULT_APPROVAL_CONFIG.timeoutMs);
    expect(approvalConfigFrom({ timeout_s: 60 }).timeoutMs).toBe(60_000);
  });
});
