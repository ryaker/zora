import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TeamManager } from '../../../src/teams/team-manager.js';
import { PRLifecycleManager } from '../../../src/teams/pr-lifecycle.js';
import type { AgentMember } from '../../../src/teams/team-types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('PRLifecycleManager', () => {
  const testDir = path.join(os.tmpdir(), `zora-pr-lifecycle-test-${Date.now()}`);
  let teamManager: TeamManager;
  let prLifecycle: PRLifecycleManager;

  const memberA: Omit<AgentMember, 'isActive'> = {
    agentId: 'claude-1@test',
    name: 'claude-agent',
    provider: 'claude',
    model: 'claude-sonnet-4-5-20250929',
    cwd: '/tmp/work-a',
    capabilities: ['code', 'review'],
  };

  const memberB: Omit<AgentMember, 'isActive'> = {
    agentId: 'gemini-1@test',
    name: 'gemini-agent',
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    cwd: '/tmp/work-b',
    capabilities: ['research', 'analysis'],
  };

  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    teamManager = new TeamManager(testDir);
    prLifecycle = new PRLifecycleManager(teamManager);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('creates a team for a PR with prNumber and prTitle', async () => {
    const team = await prLifecycle.createTeamForPR(42, 'Fix login bug', [memberA, memberB], 'claude-1@test');

    expect(team.name).toBe('pr-42');
    expect(team.prNumber).toBe(42);
    expect(team.prTitle).toBe('Fix login bug');
    expect(team.persistent).toBe(false);
    expect(team.members).toHaveLength(2);
    expect(team.coordinatorId).toBe('claude-1@test');
  });

  it('tears down team on merge', async () => {
    await prLifecycle.createTeamForPR(10, 'Add feature', [memberA], 'claude-1@test');
    await prLifecycle.teardownTeamForPR(10);

    const team = await prLifecycle.getTeamForPR(10);
    expect(team).toBeNull();
  });

  it('tears down team on close', async () => {
    await prLifecycle.createTeamForPR(11, 'Refactor utils', [memberA], 'claude-1@test');
    await prLifecycle.onPRStatusChange(11, 'closed');

    const team = await prLifecycle.getTeamForPR(11);
    expect(team).toBeNull();
  });

  it('gets team by PR number', async () => {
    await prLifecycle.createTeamForPR(55, 'Update docs', [memberA, memberB], 'claude-1@test');

    const team = await prLifecycle.getTeamForPR(55);
    expect(team).not.toBeNull();
    expect(team!.name).toBe('pr-55');
    expect(team!.prNumber).toBe(55);
  });

  it('returns null for non-existent PR team', async () => {
    const team = await prLifecycle.getTeamForPR(999);
    expect(team).toBeNull();
  });

  it('lists all PR teams', async () => {
    await prLifecycle.createTeamForPR(1, 'First PR', [memberA], 'claude-1@test');
    await prLifecycle.createTeamForPR(2, 'Second PR', [memberB], 'gemini-1@test');

    // Also create a non-PR team to verify it is excluded
    await teamManager.createTeam('regular-team', [memberA], 'claude-1@test');

    const prTeams = await prLifecycle.listPRTeams();
    expect(prTeams).toHaveLength(2);

    const prNumbers = prTeams.map((t) => t.prNumber).sort();
    expect(prNumbers).toEqual([1, 2]);
  });

  it('idempotent create returns existing team', async () => {
    const first = await prLifecycle.createTeamForPR(42, 'Fix bug', [memberA], 'claude-1@test');
    const second = await prLifecycle.createTeamForPR(42, 'Fix bug', [memberA], 'claude-1@test');

    expect(second.name).toBe(first.name);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('idempotent teardown is a no-op for non-existent team', async () => {
    // Should not throw
    await expect(prLifecycle.teardownTeamForPR(404)).resolves.toBeUndefined();
  });

  it('handles opened->merged status transition', async () => {
    await prLifecycle.createTeamForPR(30, 'Feature X', [memberA, memberB], 'claude-1@test');

    const teamBefore = await prLifecycle.getTeamForPR(30);
    expect(teamBefore).not.toBeNull();

    await prLifecycle.onPRStatusChange(30, 'merged');

    const teamAfter = await prLifecycle.getTeamForPR(30);
    expect(teamAfter).toBeNull();
  });

  it('handles opened->closed status transition', async () => {
    await prLifecycle.createTeamForPR(31, 'Feature Y', [memberA], 'claude-1@test');

    await prLifecycle.onPRStatusChange(31, 'closed');

    const teamAfter = await prLifecycle.getTeamForPR(31);
    expect(teamAfter).toBeNull();
  });

  it('onPRStatusChange opened is a no-op (team created via createTeamForPR)', async () => {
    // 'opened' via onPRStatusChange does not create a team —
    // createTeamForPR is the explicit creation path.
    await prLifecycle.onPRStatusChange(77, 'opened');

    const team = await prLifecycle.getTeamForPR(77);
    expect(team).toBeNull();
  });

  it('PR teams are always ephemeral (persistent = false)', async () => {
    const team = await prLifecycle.createTeamForPR(99, 'Ephemeral test', [memberA], 'claude-1@test');
    expect(team.persistent).toBe(false);
  });

  it('stores prNumber and prTitle in team config on disk', async () => {
    await prLifecycle.createTeamForPR(7, 'Disk check PR', [memberA], 'claude-1@test');

    const configPath = path.join(testDir, 'teams', 'pr-7', 'config.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    expect(config.prNumber).toBe(7);
    expect(config.prTitle).toBe('Disk check PR');
  });
});
