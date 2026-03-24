/**
 * Integration tests — Orphaned module wiring (PR #164)
 *
 * Proves that three previously-orphaned modules are now real connections:
 *   1. signal-pm-router  → SignalIntakeAdapter (setProjects + _handleRawMessage)
 *   2. PRLifecycleManager → TeamManager (prLifecycle getter)
 *   3. BridgeWatchdog     → GeminiBridge (attachWatchdog + heartbeat)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

// Units under test
import { SignalIntakeAdapter } from '../../src/channels/signal/signal-intake-adapter.js';
import type { ChannelMessage } from '../../src/types/channel.js';
import { TeamManager } from '../../src/teams/team-manager.js';
import { GeminiBridge } from '../../src/teams/gemini-bridge.js';
import { BridgeWatchdog } from '../../src/teams/bridge-watchdog.js';
import { Mailbox } from '../../src/teams/mailbox.js';
import type { AgentMember } from '../../src/teams/team-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal signal-sdk raw event that signalEventToChannelMessage can parse. */
function makeRawEvent(content: string, ts = Date.now()) {
  return {
    envelope: {
      sourceNumber: '+14155550100',
      sourceUuid: 'test-uuid-1234',
      sourceName: 'Tester',
      timestamp: ts,
      dataMessage: {
        message: content,
      },
    },
  };
}

/** Create a temp directory, return its path. */
async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'zora-wiring-test-'));
}

/** Standard member definition reused across team tests. */
const COORD: Omit<AgentMember, 'isActive'> = {
  agentId: 'coordinator',
  name: 'coordinator',
  provider: 'claude',
  model: 'claude-sonnet-4-6',
  cwd: '/tmp',
  capabilities: ['reasoning'],
};

const REVIEWER: Omit<AgentMember, 'isActive'> = {
  agentId: 'reviewer',
  name: 'reviewer',
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  cwd: '/tmp',
  capabilities: ['reasoning'],
};

// ---------------------------------------------------------------------------
// Group 1: SignalIntakeAdapter ↔ signal-pm-router
// ---------------------------------------------------------------------------

describe('SignalIntakeAdapter — signal-pm-router wiring', () => {
  /**
   * We bypass the real signal-cli daemon entirely by reaching into the private
   * `_handleRawMessage` method, which is where the actual routing logic lives.
   * This is the seam that was wired in PR #164.
   */
  function callHandleRaw(adapter: SignalIntakeAdapter, raw: unknown): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (adapter as any)._handleRawMessage(raw);
  }

  it('Test 1 — routes @ProjectName message to the correct project', async () => {
    const adapter = new SignalIntakeAdapter('+15550000001');
    adapter.setProjects([{ name: 'ProjectA', port: 8080, keywords: ['deploy'] }]);

    const received: ChannelMessage[] = [];
    adapter.onMessage(async (msg) => { received.push(msg); });

    await callHandleRaw(adapter, makeRawEvent('@ProjectA do something'));

    expect(received).toHaveLength(1);
    // The routing wiring attaches .project to the ChannelMessage
    expect((received[0] as ChannelMessage & { project?: string }).project).toBe('ProjectA');
  });

  it('Test 2 — unresolved messages pass through to handler unchanged', async () => {
    const adapter = new SignalIntakeAdapter('+15550000002');
    adapter.setProjects([{ name: 'ProjectA', port: 8080, keywords: ['deploy'] }]);

    const received: ChannelMessage[] = [];
    adapter.onMessage(async (msg) => { received.push(msg); });

    await callHandleRaw(adapter, makeRawEvent('hello there, no prefix here'));

    // Message must NOT be dropped — it reaches the handler
    expect(received).toHaveLength(1);
    // No project annotation for unresolved messages
    expect((received[0] as ChannelMessage & { project?: string }).project).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Group 2: TeamManager.prLifecycle ↔ PRLifecycleManager
// ---------------------------------------------------------------------------

describe('TeamManager.prLifecycle — PRLifecycleManager wiring', () => {
  let tmpDir: string;
  let tm: TeamManager;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    tm = new TeamManager(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('Test 3 — createTeamForPR creates a team named pr-{number}', async () => {
    const lifecycle = tm.prLifecycle;

    await lifecycle.createTeamForPR(42, 'Fix the bug', [COORD, REVIEWER], 'coordinator');

    const team = await tm.getTeam('pr-42');
    expect(team).not.toBeNull();
    expect(team!.name).toBe('pr-42');
    // PR metadata written into the config
    expect(team!.prNumber).toBe(42);
    expect(team!.prTitle).toBe('Fix the bug');
  });

  it('Test 4 — teardownTeamForPR removes the team', async () => {
    const lifecycle = tm.prLifecycle;

    await lifecycle.createTeamForPR(42, 'Fix the bug', [COORD, REVIEWER], 'coordinator');
    expect(await tm.getTeam('pr-42')).not.toBeNull();

    await lifecycle.teardownTeamForPR(42);

    expect(await tm.getTeam('pr-42')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Group 3: GeminiBridge.attachWatchdog() ↔ BridgeWatchdog heartbeat
// ---------------------------------------------------------------------------

describe('GeminiBridge.attachWatchdog — BridgeWatchdog wiring', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('Test 5 — attachWatchdog() calls watchdog.start() and wires heartbeat to poll cycle', async () => {
    // Create a minimal Mailbox backed by the temp dir
    const teamsDir = path.join(tmpDir, 'teams');
    await fs.mkdir(path.join(teamsDir, 'test-team', 'inboxes'), { recursive: true });
    const mailbox = new Mailbox(teamsDir, 'gemini-agent');
    await mailbox.init('test-team');

    const bridge = new GeminiBridge('test-team', mailbox, {
      pollIntervalMs: 9999,     // Long interval — we won't rely on real polling
      geminiCliPath: '/bin/false',
      onPollComplete: undefined,
    });

    const stateDir = path.join(tmpDir, 'state');
    await fs.mkdir(stateDir, { recursive: true });

    const watchdog = new BridgeWatchdog(bridge, {
      healthCheckIntervalMs: 100,
      maxStaleMs: 500,
      maxRestarts: 3,
      stateDir,
    });

    // Spy on watchdog.start() before attaching
    const startSpy = vi.spyOn(watchdog, 'start');
    const heartbeatSpy = vi.spyOn(watchdog, 'writeHeartbeat');

    bridge.attachWatchdog(watchdog);

    // watchdog.start() must have been called as part of attachWatchdog()
    expect(startSpy).toHaveBeenCalledOnce();

    // The poll-complete callback should now invoke writeHeartbeat.
    // Simulate a completed poll cycle by calling setOnPollComplete callback directly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pollCompleteFn = (bridge as any)._onPollComplete as (() => void | Promise<void>) | undefined;
    expect(pollCompleteFn).toBeDefined();
    await pollCompleteFn?.();

    // writeHeartbeat was triggered by the poll-complete callback
    expect(heartbeatSpy).toHaveBeenCalled();

    // Cleanup: stop the watchdog to avoid timer leaks
    watchdog.stop();
    bridge.stop();
  });
});
