/**
 * Team CLI Commands — create, list, status, and teardown multi-agent teams.
 *
 * Spec §5.9 "CLI Interface" — team subcommands.
 */

import type { Command } from 'commander';
import { TeamManager } from '../teams/team-manager.js';
import type { AgentMember } from '../teams/team-types.js';

function parseAgentSpec(spec: string): Omit<AgentMember, 'isActive'> {
  const parts = spec.split(':');
  const name = parts[0] ?? 'agent';
  const VALID_PROVIDERS = ['claude', 'gemini'] as const;
  const rawProvider = parts[1] ?? 'claude';
  if (!VALID_PROVIDERS.includes(rawProvider as typeof VALID_PROVIDERS[number])) {
    throw new Error(`Invalid provider "${rawProvider}". Must be one of: ${VALID_PROVIDERS.join(', ')}`);
  }
  const provider = rawProvider as 'claude' | 'gemini';
  const model = parts[2] ?? 'default';

  return {
    agentId: `${name}@cli`,
    name,
    provider,
    model,
    cwd: process.cwd(),
    capabilities: ['reasoning'],
  };
}

export function registerTeamCommands(
  program: Command,
  baseDir: string,
): void {
  const team = program.command('team').description('Manage agent teams');

  team
    .command('create <name>')
    .description('Create a new team')
    .option('--agents <agents>', 'Comma-separated agent specs (name:provider:model)')
    .option('--persistent', 'Keep team after completion')
    .action(async (name: string, opts: { agents?: string; persistent?: boolean }) => {
      const manager = new TeamManager(baseDir);

      const members: Omit<AgentMember, 'isActive'>[] = opts.agents
        ? opts.agents.split(',').map(s => parseAgentSpec(s.trim()))
        : [parseAgentSpec('default:claude:default')];

      const coordinatorId = members[0]?.agentId ?? 'default@cli';

      const config = await manager.createTeam(
        name,
        members,
        coordinatorId,
        opts.persistent ?? false,
      );

      console.log(`Team "${config.name}" created with ${config.members.length} member(s).`);
      for (const m of config.members) {
        console.log(`  - ${m.name} (${m.provider}/${m.model})`);
      }
    });

  team
    .command('list')
    .description('List all teams')
    .action(async () => {
      const manager = new TeamManager(baseDir);
      const teams = await manager.listTeams();

      if (teams.length === 0) {
        console.log('No teams found.');
        return;
      }

      for (const t of teams) {
        const memberCount = t.members.length;
        const activeCount = t.members.filter(m => m.isActive).length;
        console.log(`  ${t.name} — ${activeCount}/${memberCount} active, created ${t.createdAt}`);
      }
    });

  team
    .command('status <name>')
    .description('Show team status')
    .action(async (name: string) => {
      const manager = new TeamManager(baseDir);

      try {
        const { team: t, unreadMessages } = await manager.getTeamStatus(name);

        console.log(`Team: ${t.name}`);
        console.log(`Created: ${t.createdAt}`);
        console.log(`Coordinator: ${t.coordinatorId}`);
        console.log(`Persistent: ${t.persistent}`);
        console.log(`Members:`);

        for (const m of t.members) {
          const unread = unreadMessages[m.name] ?? 0;
          const status = m.isActive ? 'active' : 'inactive';
          console.log(`  - ${m.name} (${m.provider}/${m.model}) [${status}] ${unread} unread`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  team
    .command('teardown <name>')
    .description('Remove a team')
    .action(async (name: string) => {
      const manager = new TeamManager(baseDir);
      await manager.teardownTeam(name);
      console.log(`Team "${name}" torn down.`);
    });
}
