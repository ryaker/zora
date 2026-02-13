/**
 * TeamManager — Creates, manages, and tears down multi-agent teams.
 *
 * Spec v0.6 §5.7 "Team Lifecycle":
 *   - Teams are directory-based: {baseDir}/teams/{teamName}/
 *   - config.json holds TeamConfig
 *   - inboxes/ holds per-agent inbox JSON files
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { writeAtomic } from '../utils/fs.js';
import { Mailbox } from './mailbox.js';
import type { AgentMember, TeamConfig, MailboxMessage } from './team-types.js';

export class TeamManager {
  private readonly _teamsDir: string;

  constructor(baseDir: string) {
    this._teamsDir = path.join(baseDir, 'teams');
  }

  /**
   * Creates a new team with the given members.
   */
  async createTeam(
    name: string,
    members: Omit<AgentMember, 'isActive'>[],
    coordinatorId: string,
    persistent = false,
  ): Promise<TeamConfig> {
    const teamDir = path.join(this._teamsDir, name);
    await fs.mkdir(path.join(teamDir, 'inboxes'), { recursive: true });

    const fullMembers: AgentMember[] = members.map((m) => ({
      ...m,
      isActive: true,
    }));

    const config: TeamConfig = {
      name,
      createdAt: new Date().toISOString(),
      members: fullMembers,
      coordinatorId,
      persistent,
    };

    await writeAtomic(
      path.join(teamDir, 'config.json'),
      JSON.stringify(config, null, 2),
    );

    // Create inbox for each member
    for (const member of fullMembers) {
      const mailbox = new Mailbox(this._teamsDir, member.name);
      await mailbox.init(name);
    }

    return config;
  }

  /**
   * Reads the team config, or null if not found.
   */
  async getTeam(name: string): Promise<TeamConfig | null> {
    const configPath = path.join(this._teamsDir, name, 'config.json');
    try {
      const content = await fs.readFile(configPath, 'utf8');
      return JSON.parse(content) as TeamConfig;
    } catch {
      return null;
    }
  }

  /**
   * Lists all teams.
   */
  async listTeams(): Promise<TeamConfig[]> {
    try {
      const entries = await fs.readdir(this._teamsDir, { withFileTypes: true });
      const teams: TeamConfig[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const team = await this.getTeam(entry.name);
          if (team) teams.push(team);
        }
      }

      return teams;
    } catch {
      return [];
    }
  }

  /**
   * Adds a member to an existing team.
   */
  async addMember(
    teamName: string,
    member: Omit<AgentMember, 'isActive'>,
  ): Promise<void> {
    const config = await this.getTeam(teamName);
    if (!config) throw new Error(`Team "${teamName}" not found`);

    const fullMember: AgentMember = { ...member, isActive: true };
    config.members.push(fullMember);

    await writeAtomic(
      path.join(this._teamsDir, teamName, 'config.json'),
      JSON.stringify(config, null, 2),
    );

    const mailbox = new Mailbox(this._teamsDir, member.name);
    await mailbox.init(teamName);
  }

  /**
   * Removes a member from a team.
   */
  async removeMember(teamName: string, agentId: string): Promise<void> {
    const config = await this.getTeam(teamName);
    if (!config) throw new Error(`Team "${teamName}" not found`);

    if (config.coordinatorId === agentId) {
      throw new Error(`Cannot remove coordinator "${agentId}" from team "${teamName}"`);
    }

    config.members = config.members.filter((m) => m.agentId !== agentId);

    await writeAtomic(
      path.join(this._teamsDir, teamName, 'config.json'),
      JSON.stringify(config, null, 2),
    );
  }

  /**
   * Updates active status for a member.
   */
  async updateMemberStatus(
    teamName: string,
    agentId: string,
    isActive: boolean,
  ): Promise<void> {
    const config = await this.getTeam(teamName);
    if (!config) throw new Error(`Team "${teamName}" not found`);

    const member = config.members.find((m) => m.agentId === agentId);
    if (!member) throw new Error(`Agent "${agentId}" not found in team "${teamName}"`);

    member.isActive = isActive;

    await writeAtomic(
      path.join(this._teamsDir, teamName, 'config.json'),
      JSON.stringify(config, null, 2),
    );
  }

  /**
   * Removes the entire team directory tree.
   */
  async teardownTeam(name: string): Promise<void> {
    const teamDir = path.join(this._teamsDir, name);
    await fs.rm(teamDir, { recursive: true, force: true });
  }

  /**
   * Returns team config and unread message counts per agent.
   */
  async getTeamStatus(
    name: string,
  ): Promise<{ team: TeamConfig; unreadMessages: Record<string, number> }> {
    const team = await this.getTeam(name);
    if (!team) throw new Error(`Team "${name}" not found`);

    const unreadMessages: Record<string, number> = {};

    for (const member of team.members) {
      const mailbox = new Mailbox(this._teamsDir, member.name);
      const all = await mailbox.getAllMessages(name);
      unreadMessages[member.name] = all.filter((m: MailboxMessage) => !m.read).length;
    }

    return { team, unreadMessages };
  }
}
