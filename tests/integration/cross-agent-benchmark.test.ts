/**
 * Integration tests for cross-agent team lifecycle and parallel execution.
 *
 * Verifies team creation, mailbox communication, parallel task posting,
 * and full lifecycle: create -> assign -> execute -> synthesize -> teardown.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TeamManager } from '../../src/teams/team-manager.js';
import { Mailbox } from '../../src/teams/mailbox.js';

describe('cross-agent-benchmark', () => {
  let tmpDir: string;
  let manager: TeamManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zora-bench-'));
    manager = new TeamManager(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates a team with two agents and inboxes', async () => {
    const config = await manager.createTeam(
      'bench-team',
      [
        { agentId: 'a1@bench', name: 'agent-1', provider: 'claude', model: 'opus', cwd: '/tmp', capabilities: ['reasoning'] },
        { agentId: 'a2@bench', name: 'agent-2', provider: 'gemini', model: 'pro', cwd: '/tmp', capabilities: ['search'] },
      ],
      'a1@bench',
    );

    expect(config.name).toBe('bench-team');
    expect(config.members).toHaveLength(2);
    expect(config.members[0]!.isActive).toBe(true);
    expect(config.members[1]!.isActive).toBe(true);
  });

  it('posts tasks to both inboxes simultaneously', async () => {
    await manager.createTeam(
      'parallel-team',
      [
        { agentId: 'a1@pt', name: 'worker-1', provider: 'claude', model: 'opus', cwd: '/tmp', capabilities: ['reasoning'] },
        { agentId: 'a2@pt', name: 'worker-2', provider: 'gemini', model: 'pro', cwd: '/tmp', capabilities: ['search'] },
      ],
      'a1@pt',
    );

    // Use a coordinator mailbox to send to both workers
    const coordinator = new Mailbox(path.join(tmpDir, 'teams'), 'coordinator');

    // Post tasks in parallel to worker-1 and worker-2 inboxes
    await Promise.all([
      coordinator.send('parallel-team', 'worker-1', {
        text: 'Analyze code quality',
        type: 'task',
      }),
      coordinator.send('parallel-team', 'worker-2', {
        text: 'Search for dependencies',
        type: 'task',
      }),
    ]);

    const worker1Mailbox = new Mailbox(path.join(tmpDir, 'teams'), 'worker-1');
    const worker2Mailbox = new Mailbox(path.join(tmpDir, 'teams'), 'worker-2');

    const msgs1 = await worker1Mailbox.getAllMessages('parallel-team');
    const msgs2 = await worker2Mailbox.getAllMessages('parallel-team');

    expect(msgs1).toHaveLength(1);
    expect(msgs2).toHaveLength(1);
    expect(msgs1[0]!.text).toBe('Analyze code quality');
    expect(msgs2[0]!.text).toBe('Search for dependencies');
  });

  it('both agents produce results that can be read', async () => {
    await manager.createTeam(
      'results-team',
      [
        { agentId: 'a1@rt', name: 'coder', provider: 'claude', model: 'opus', cwd: '/tmp', capabilities: ['coding'] },
        { agentId: 'a2@rt', name: 'reviewer', provider: 'gemini', model: 'pro', cwd: '/tmp', capabilities: ['reasoning'] },
      ],
      'a1@rt',
    );

    // Coder sends result to coordinator inbox
    const coderMailbox = new Mailbox(path.join(tmpDir, 'teams'), 'coder');
    const reviewerMailbox = new Mailbox(path.join(tmpDir, 'teams'), 'reviewer');

    await coderMailbox.send('results-team', 'coordinator', { text: 'Code written: auth.ts', type: 'result' });
    await reviewerMailbox.send('results-team', 'coordinator', { text: 'Review complete: LGTM', type: 'result' });

    const coordMailbox = new Mailbox(path.join(tmpDir, 'teams'), 'coordinator');
    const coderMsgs = await coordMailbox.getAllMessages('results-team');

    expect(coderMsgs).toHaveLength(2);
    expect(coderMsgs[0]!.type).toBe('result');
    expect(coderMsgs[1]!.type).toBe('result');
  });

  /**
   * TEST-20: this used to assert `parallelTime < serialTime * 5`.
   *
   * Both numbers are wall-clock samples over filesystem round trips that take
   * about a millisecond each when the machine is idle, so the threshold was a
   * handful of milliseconds wide — one scheduler preemption or writeback stall
   * inside the parallel half crossed it. Under a full-suite run the test runner
   * *is* the contention, which is why it only failed there. Measured under CPU
   * and disk load: serial ~1.4ms (budget ~7ms) against a parallel half that
   * routinely took 6-11ms — 13 failures in 30 consecutive runs. No wider
   * tolerance is defensible either; 5x of one millisecond is 5x of noise.
   *
   * Nor can "the sends really overlapped" be asserted from the outside: with
   * `Promise.all`, the second send is always *initiated* before the first
   * resolves, even if `send` does all its work synchronously — mutating
   * Mailbox.send to be fully synchronous, and separately to serialise behind a
   * mutex, left an interval-overlap check passing in both cases. Anything that
   * genuinely distinguishes concurrent I/O from sequential I/O is a wall-clock
   * measurement, i.e. the flake.
   *
   * So what is asserted here is the property that concurrent posting has to
   * hold regardless of speed: every message issued in parallel arrives, in
   * order, in the right inbox, with nothing lost to a read-modify-write race.
   * The timings are still measured and reported — they just do not fail the
   * build.
   */
  it('delivers every message when posts are issued in parallel', async () => {
    await manager.createTeam(
      'timing-team',
      [
        { agentId: 'a1@tt', name: 'fast-1', provider: 'claude', model: 'haiku', cwd: '/tmp', capabilities: ['fast'] },
        { agentId: 'a2@tt', name: 'fast-2', provider: 'gemini', model: 'flash', cwd: '/tmp', capabilities: ['fast'] },
      ],
      'a1@tt',
    );

    const sender = new Mailbox(path.join(tmpDir, 'teams'), 'bench');

    // Serial baseline — reported, not asserted on.
    const serialStart = performance.now();
    await sender.send('timing-team', 'fast-1', { text: 'task-serial-1', type: 'task' });
    await sender.send('timing-team', 'fast-2', { text: 'task-serial-2', type: 'task' });
    const serialTime = performance.now() - serialStart;

    const parallelStart = performance.now();
    await Promise.all([
      sender.send('timing-team', 'fast-1', { text: 'task-parallel-1', type: 'task' }),
      sender.send('timing-team', 'fast-2', { text: 'task-parallel-2', type: 'task' }),
    ]);
    const parallelTime = performance.now() - parallelStart;

    // eslint-disable-next-line no-console
    console.log(
      `cross-agent posting: serial ${serialTime.toFixed(2)}ms, parallel ${parallelTime.toFixed(2)}ms`,
    );

    const fast1 = new Mailbox(path.join(tmpDir, 'teams'), 'fast-1');
    const fast2 = new Mailbox(path.join(tmpDir, 'teams'), 'fast-2');
    const all1 = await fast1.getAllMessages('timing-team');
    const all2 = await fast2.getAllMessages('timing-team');

    // Nothing dropped, nothing reordered, nothing delivered to the wrong inbox.
    expect(all1.map((m) => m.text)).toEqual(['task-serial-1', 'task-parallel-1']);
    expect(all2.map((m) => m.text)).toEqual(['task-serial-2', 'task-parallel-2']);
    expect(all1.every((m) => m.from === 'bench' && m.type === 'task')).toBe(true);
    expect(all2.every((m) => m.from === 'bench' && m.type === 'task')).toBe(true);
  });

  it('full lifecycle: create -> assign -> execute -> synthesize -> teardown', async () => {
    // Create
    const config = await manager.createTeam(
      'lifecycle-team',
      [
        { agentId: 'lead@lt', name: 'lead', provider: 'claude', model: 'opus', cwd: '/tmp', capabilities: ['reasoning'] },
        { agentId: 'worker@lt', name: 'worker', provider: 'gemini', model: 'pro', cwd: '/tmp', capabilities: ['coding'] },
      ],
      'lead@lt',
    );
    expect(config.members).toHaveLength(2);

    // Assign (lead sends task to worker)
    const leadMailbox = new Mailbox(path.join(tmpDir, 'teams'), 'lead');
    await leadMailbox.send('lifecycle-team', 'worker', { text: 'Build feature X', type: 'task' });

    // Execute (worker reads)
    const workerMailbox = new Mailbox(path.join(tmpDir, 'teams'), 'worker');
    const tasks = await workerMailbox.getAllMessages('lifecycle-team');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.text).toBe('Build feature X');

    // Synthesize (worker posts result back to lead)
    await workerMailbox.send('lifecycle-team', 'lead', { text: 'Feature X complete', type: 'result' });
    const results = await leadMailbox.getAllMessages('lifecycle-team');
    expect(results[0]!.text).toBe('Feature X complete');

    // Status check
    const status = await manager.getTeamStatus('lifecycle-team');
    expect(status.team.name).toBe('lifecycle-team');

    // Teardown
    await manager.teardownTeam('lifecycle-team');
    const afterTeardown = await manager.getTeam('lifecycle-team');
    expect(afterTeardown).toBeNull();
  });

  it('getTeamStatus reports unread message counts', async () => {
    await manager.createTeam(
      'status-team',
      [
        { agentId: 'a1@st', name: 'agent-a', provider: 'claude', model: 'opus', cwd: '/tmp', capabilities: ['reasoning'] },
        { agentId: 'a2@st', name: 'agent-b', provider: 'gemini', model: 'pro', cwd: '/tmp', capabilities: ['search'] },
      ],
      'a1@st',
    );

    const sender = new Mailbox(path.join(tmpDir, 'teams'), 'system');
    await sender.send('status-team', 'agent-a', { text: 'Hello A', type: 'task' });
    await sender.send('status-team', 'agent-a', { text: 'Hello A again', type: 'task' });

    const status = await manager.getTeamStatus('status-team');
    expect(status.unreadMessages['agent-a']).toBe(2);
    expect(status.unreadMessages['agent-b']).toBe(0);
  });

  it('team listing returns all teams', async () => {
    await manager.createTeam('team-alpha', [
      { agentId: 'a@alpha', name: 'alpha-1', provider: 'claude', model: 'opus', cwd: '/tmp', capabilities: [] },
    ], 'a@alpha');

    await manager.createTeam('team-beta', [
      { agentId: 'b@beta', name: 'beta-1', provider: 'gemini', model: 'pro', cwd: '/tmp', capabilities: [] },
    ], 'b@beta');

    const teams = await manager.listTeams();
    const names = teams.map(t => t.name).sort();
    expect(names).toEqual(['team-alpha', 'team-beta']);
  });
});
