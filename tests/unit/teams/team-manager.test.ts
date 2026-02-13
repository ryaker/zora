import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TeamManager } from '../../../src/teams/team-manager.js';
import type { AgentMember } from '../../../src/teams/team-types.js';
import { Mailbox } from '../../../src/teams/mailbox.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('TeamManager', () => {
  const testDir = path.join(os.tmpdir(), `zora-team-mgr-test-${Date.now()}`);
  let manager: TeamManager;

  const baseMember: Omit<AgentMember, 'isActive'> = {
    agentId: 'agent-1',
    name: 'claude-worker',
    provider: 'claude',
    model: 'claude-sonnet-4-5-20250929',
    cwd: '/tmp/work',
    capabilities: ['code', 'review'],
  };

  const geminiMember: Omit<AgentMember, 'isActive'> = {
    agentId: 'agent-2',
    name: 'gemini-worker',
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    cwd: '/tmp/work',
    capabilities: ['research'],
  };

  beforeEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
    manager = new TeamManager(testDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('creates team with config and inboxes', async () => {
    const config = await manager.createTeam('alpha', [baseMember, geminiMember], 'agent-1');

    expect(config.name).toBe('alpha');
    expect(config.members).toHaveLength(2);
    expect(config.coordinatorId).toBe('agent-1');
    expect(config.persistent).toBe(false);

    // Verify inbox files exist
    const inbox1 = path.join(testDir, 'teams', 'alpha', 'inboxes', 'claude-worker.json');
    const inbox2 = path.join(testDir, 'teams', 'alpha', 'inboxes', 'gemini-worker.json');
    await expect(fs.access(inbox1)).resolves.toBeUndefined();
    await expect(fs.access(inbox2)).resolves.toBeUndefined();
  });

  it('gets team config', async () => {
    await manager.createTeam('beta', [baseMember], 'agent-1');
    const config = await manager.getTeam('beta');

    expect(config).not.toBeNull();
    expect(config!.name).toBe('beta');
    expect(config!.members[0]!.isActive).toBe(true);
  });

  it('lists multiple teams', async () => {
    await manager.createTeam('team-a', [baseMember], 'agent-1');
    await manager.createTeam('team-b', [geminiMember], 'agent-2');

    const teams = await manager.listTeams();
    expect(teams).toHaveLength(2);
    const names = teams.map((t) => t.name);
    expect(names).toContain('team-a');
    expect(names).toContain('team-b');
  });

  it('adds member and creates their inbox', async () => {
    await manager.createTeam('gamma', [baseMember], 'agent-1');
    await manager.addMember('gamma', geminiMember);

    const config = await manager.getTeam('gamma');
    expect(config).not.toBeNull();
    expect(config!.members).toHaveLength(2);

    const inboxPath = path.join(testDir, 'teams', 'gamma', 'inboxes', 'gemini-worker.json');
    await expect(fs.access(inboxPath)).resolves.toBeUndefined();
  });

  it('removes member', async () => {
    await manager.createTeam('delta', [baseMember, geminiMember], 'agent-1');
    await manager.removeMember('delta', 'agent-2');

    const config = await manager.getTeam('delta');
    expect(config).not.toBeNull();
    expect(config!.members).toHaveLength(1);
    expect(config!.members[0]!.agentId).toBe('agent-1');
  });

  it('updates member status', async () => {
    await manager.createTeam('epsilon', [baseMember], 'agent-1');
    await manager.updateMemberStatus('epsilon', 'agent-1', false);

    const config = await manager.getTeam('epsilon');
    expect(config).not.toBeNull();
    expect(config!.members[0]!.isActive).toBe(false);
  });

  it('tears down team by removing directory', async () => {
    await manager.createTeam('doomed', [baseMember], 'agent-1');
    await manager.teardownTeam('doomed');

    const teamDir = path.join(testDir, 'teams', 'doomed');
    await expect(fs.access(teamDir)).rejects.toThrow();
  });

  it('gets team status with unread counts', async () => {
    await manager.createTeam('status-team', [baseMember, geminiMember], 'agent-1');

    // Send a message to one member
    const teamsDir = path.join(testDir, 'teams');
    const sender = new Mailbox(teamsDir, 'external');
    await sender.send('status-team', 'claude-worker', {
      type: 'task',
      text: 'Do this',
    });

    const status = await manager.getTeamStatus('status-team');
    expect(status.unreadMessages['claude-worker']).toBe(1);
    expect(status.unreadMessages['gemini-worker']).toBe(0);
  });
});
