import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TeamManager } from '../../../src/teams/team-manager.js';
import type { AgentMember } from '../../../src/teams/team-types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('TeamManager', () => {
  const testDir = path.join(os.tmpdir(), `zora-team-mgr-test-${Date.now()}`);
  let manager: TeamManager;

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
    manager = new TeamManager(testDir);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('creates a team with config and inboxes', async () => {
    const team = await manager.createTeam('alpha', [memberA, memberB], 'claude-1@test');

    expect(team.name).toBe('alpha');
    expect(team.members).toHaveLength(2);
    expect(team.coordinatorId).toBe('claude-1@test');
    expect(team.persistent).toBe(false);
    expect(team.members[0]!.isActive).toBe(true);

    // Config file exists
    const configPath = path.join(testDir, 'teams', 'alpha', 'config.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    expect(config.name).toBe('alpha');

    // Inbox files exist
    const inboxA = path.join(testDir, 'teams', 'alpha', 'inboxes', 'claude-agent.json');
    const inboxB = path.join(testDir, 'teams', 'alpha', 'inboxes', 'gemini-agent.json');
    expect(JSON.parse(await fs.readFile(inboxA, 'utf8'))).toEqual([]);
    expect(JSON.parse(await fs.readFile(inboxB, 'utf8'))).toEqual([]);
  });

  it('creates a persistent team', async () => {
    const team = await manager.createTeam('beta', [memberA], 'claude-1@test', true);
    expect(team.persistent).toBe(true);
  });

  it('gets an existing team', async () => {
    await manager.createTeam('gamma', [memberA], 'claude-1@test');
    const team = await manager.getTeam('gamma');

    expect(team).not.toBeNull();
    expect(team!.name).toBe('gamma');
    expect(team!.members).toHaveLength(1);
  });

  it('returns null for non-existent team', async () => {
    const team = await manager.getTeam('does-not-exist');
    expect(team).toBeNull();
  });

  it('lists all teams', async () => {
    await manager.createTeam('team-1', [memberA], 'claude-1@test');
    await manager.createTeam('team-2', [memberB], 'gemini-1@test');

    const teams = await manager.listTeams();
    expect(teams).toHaveLength(2);
    const names = teams.map((t) => t.name).sort();
    expect(names).toEqual(['team-1', 'team-2']);
  });

  it('adds a member to a team', async () => {
    await manager.createTeam('delta', [memberA], 'claude-1@test');
    await manager.addMember('delta', memberB);

    const team = await manager.getTeam('delta');
    expect(team!.members).toHaveLength(2);
    expect(team!.members[1]!.agentId).toBe('gemini-1@test');
    expect(team!.members[1]!.isActive).toBe(true);
  });

  it('removes a member from a team', async () => {
    await manager.createTeam('epsilon', [memberA, memberB], 'claude-1@test');
    await manager.removeMember('epsilon', 'gemini-1@test');

    const team = await manager.getTeam('epsilon');
    expect(team!.members).toHaveLength(1);
    expect(team!.members[0]!.agentId).toBe('claude-1@test');
  });

  it('updates member active status', async () => {
    await manager.createTeam('zeta', [memberA], 'claude-1@test');
    await manager.updateMemberStatus('zeta', 'claude-1@test', false);

    const team = await manager.getTeam('zeta');
    expect(team!.members[0]!.isActive).toBe(false);
  });

  it('tears down a team completely', async () => {
    await manager.createTeam('doomed', [memberA], 'claude-1@test');
    await manager.teardownTeam('doomed');

    const team = await manager.getTeam('doomed');
    expect(team).toBeNull();

    const teamDir = path.join(testDir, 'teams', 'doomed');
    await expect(fs.access(teamDir)).rejects.toThrow();
  });

  it('gets team status with unread counts', async () => {
    await manager.createTeam('eta', [memberA, memberB], 'claude-1@test');

    // Write a message directly to gemini-agent inbox
    const inboxPath = path.join(testDir, 'teams', 'eta', 'inboxes', 'gemini-agent.json');
    const msg = [{
      from: 'claude-agent',
      text: 'hello',
      timestamp: new Date().toISOString(),
      read: false,
      type: 'task',
    }];
    await fs.writeFile(inboxPath, JSON.stringify(msg));

    const status = await manager.getTeamStatus('eta');
    expect(status.team.name).toBe('eta');
    expect(status.unreadMessages['claude-agent']).toBe(0);
    expect(status.unreadMessages['gemini-agent']).toBe(1);
  });

  it('throws on operations with non-existent team', async () => {
    await expect(manager.addMember('nope', memberA)).rejects.toThrow('not found');
    await expect(manager.removeMember('nope', 'x')).rejects.toThrow('not found');
    await expect(manager.updateMemberStatus('nope', 'x', true)).rejects.toThrow('not found');
    await expect(manager.getTeamStatus('nope')).rejects.toThrow('not found');
  });
});
