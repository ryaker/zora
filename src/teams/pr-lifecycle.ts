/**
 * PRLifecycleManager — Ties team lifecycle to pull request status.
 *
 * Spec v0.6 §5.7 "PR-Scoped Teams":
 *   - Each PR gets an ephemeral team named `pr-{number}`.
 *   - Team is created on PR open, torn down on merge or close.
 *   - Operations are idempotent: duplicate creates return existing,
 *     teardown of non-existent team is a no-op.
 */

import path from 'node:path';
import type { AgentMember, TeamConfig } from './team-types.js';
import { TeamManager } from './team-manager.js';
import { writeAtomic } from '../utils/fs.js';

export class PRLifecycleManager {
  constructor(private readonly teamManager: TeamManager) {}

  /**
   * Returns the team name for a given PR number.
   */
  private _teamName(prNumber: number): string {
    return `pr-${prNumber}`;
  }

  /**
   * Creates an ephemeral team for a PR.
   * If a team already exists for this PR, returns the existing team.
   * Stores both prNumber and prTitle in the team config on disk.
   */
  async createTeamForPR(
    prNumber: number,
    prTitle: string,
    members: Omit<AgentMember, 'isActive'>[],
    coordinatorId: string,
  ): Promise<TeamConfig> {
    const teamName = this._teamName(prNumber);

    // Idempotent: return existing team if it exists
    const existing = await this.teamManager.getTeam(teamName);
    if (existing) return existing;

    const team = await this.teamManager.createTeam(
      teamName,
      members,
      coordinatorId,
      false, // PR teams are always ephemeral
    );

    // Patch prNumber and prTitle into the config atomically.
    // We re-read the config that createTeam just wrote, add PR fields,
    // and write it back in a single atomic operation.
    const configPath = path.join(this.teamManager.teamsDir, teamName, 'config.json');
    const enrichedConfig: TeamConfig = { ...team, prNumber, prTitle };
    await writeAtomic(configPath, JSON.stringify(enrichedConfig, null, 2));

    return enrichedConfig;
  }

  /**
   * Tears down the team for a PR. No-op if team does not exist.
   */
  async teardownTeamForPR(prNumber: number): Promise<void> {
    const teamName = this._teamName(prNumber);
    const existing = await this.teamManager.getTeam(teamName);
    if (!existing) return; // Idempotent no-op
    await this.teamManager.teardownTeam(teamName);
  }

  /**
   * Look up the team for a given PR number.
   */
  async getTeamForPR(prNumber: number): Promise<TeamConfig | null> {
    return this.teamManager.getTeam(this._teamName(prNumber));
  }

  /**
   * Handle PR status transitions.
   *   - 'opened': no-op (callers use createTeamForPR which needs members/coordinator)
   *   - 'merged' | 'closed': tears down team
   */
  async onPRStatusChange(
    prNumber: number,
    status: 'opened' | 'merged' | 'closed',
  ): Promise<void> {
    if (status === 'merged' || status === 'closed') {
      await this.teardownTeamForPR(prNumber);
    }
  }

  /**
   * Lists all PR-associated teams.
   */
  async listPRTeams(): Promise<Array<{ prNumber: number; team: TeamConfig }>> {
    const allTeams = await this.teamManager.listTeams();
    const prTeams: Array<{ prNumber: number; team: TeamConfig }> = [];

    for (const team of allTeams) {
      if (team.prNumber !== undefined) {
        prTeams.push({ prNumber: team.prNumber, team });
      }
    }

    return prTeams;
  }
}
