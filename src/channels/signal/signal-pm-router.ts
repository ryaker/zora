/**
 * SignalPmRouter — Routes inbound Signal/Telegram messages to the correct project Zora.
 *
 * Routing priority:
 *   1. Explicit `@ProjectName <message>` prefix → route immediately
 *   2. Slash commands (`/status`, `/spawn`, `/stop`, `/list`) → handle directly
 *   3. Content-based classification → route to best-match project
 *
 * Used by PM Zora only. Regular Zora instances do not use this router.
 */

import { createLogger } from '../../utils/logger.js';

const log = createLogger('signal-pm-router');

export interface ProjectEntry {
  name: string;
  port: number;
  icon?: string;
  keywords?: string[];
}

export interface RoutingResult {
  type: 'route' | 'command' | 'unresolved';
  /** For type='route': target project name */
  project?: string;
  /** Stripped message content (without @prefix) */
  content: string;
  /** For type='command': the slash command */
  command?: string;
  /** Arguments after the command */
  args?: string;
}

const SLASH_COMMANDS = new Set(['/status', '/spawn', '/stop', '/list', '/help']);

/**
 * Parse and route an inbound message.
 *
 * Returns a RoutingResult indicating what to do with the message.
 */
export function routeMessage(message: string, projects: ProjectEntry[]): RoutingResult {
  const text = message.trim();

  // 1. Slash commands — PM Zora handles these directly.
  // Unknown slash commands return 'unresolved' immediately — do not fall through to
  // keyword routing, as that would cause `/unknowncmd` to accidentally match project keywords.
  const cmdMatch = text.match(/^(\/\w+)\s*(.*)?$/s);
  if (cmdMatch?.[1]) {
    const cmd = cmdMatch[1].toLowerCase();
    if (SLASH_COMMANDS.has(cmd)) {
      return { type: 'command', command: cmd, args: (cmdMatch[2] ?? '').trim(), content: text };
    }
    return { type: 'unresolved', content: text };
  }

  // 2. Explicit @ProjectName prefix — match any non-whitespace token so names like
  // "my-project", "abundance.coach", or "Zora_Dev" all route correctly.
  const atMatch = text.match(/^@([^\s]+)\s+([\s\S]+)$/i);
  if (atMatch?.[1] && atMatch[2]) {
    const requestedName = atMatch[1].toLowerCase();
    const project = projects.find((p) => p.name.toLowerCase() === requestedName);
    if (project) {
      return { type: 'route', project: project.name, content: atMatch[2].trim() };
    }
    // Unknown @project — treat as unresolved
    return {
      type: 'unresolved',
      content: text,
    };
  }

  // 3. Keyword-based classification — score each project by number of keyword hits
  // and route to the highest-scoring match, so config order does not determine winner.
  const lower = text.toLowerCase();
  let bestProject: ProjectEntry | undefined;
  let bestScore = 0;

  for (const project of projects) {
    const keywords = project.keywords ?? [project.name.toLowerCase()];
    const score = keywords.filter((kw) => lower.includes(kw.toLowerCase())).length;
    if (score > bestScore) {
      bestScore = score;
      bestProject = project;
    }
  }

  if (bestProject) {
    log.info({ project: bestProject.name, score: bestScore, message: text.slice(0, 80) }, '[pm-router] Keyword match');
    return { type: 'route', project: bestProject.name, content: text };
  }

  return { type: 'unresolved', content: text };
}

/**
 * Format the /status command response.
 */
export async function formatStatus(
  projects: ProjectEntry[],
): Promise<string> {
  // Check all instances in parallel — one slow/offline instance won't block others
  const checks = await Promise.all(
    projects.map(async (p) => {
      const icon = p.icon ?? '⚡';
      try {
        const res = await fetch(`http://localhost:${p.port}/api/health`, {
          signal: AbortSignal.timeout(2000),
        });
        const status = res.ok ? '🟢 running' : '🔴 unhealthy';
        return `${icon} *${p.name}* — ${status} (port ${p.port})`;
      } catch {
        return `${icon} *${p.name}* — ⚫ offline (port ${p.port})`;
      }
    }),
  );
  return ['*PM Zora — Instance Status*', '', ...checks].join('\n');
}

/**
 * Format the /list command response.
 */
export function formatList(projects: ProjectEntry[]): string {
  const lines = ['*Configured Projects*', ''];
  for (const p of projects) {
    lines.push(`${p.icon ?? '⚡'} *${p.name}* — port ${p.port}`);
    if (p.keywords?.length) {
      lines.push(`  Keywords: ${p.keywords.join(', ')}`);
    }
  }
  lines.push('', 'Route with `@ProjectName <message>` or just describe your task.');
  return lines.join('\n');
}

export function formatHelp(projects: ProjectEntry[]): string {
  const routingExamples = projects
    .slice(0, 2)
    .map((p) => `\`@${p.name} <message>\` — Route to ${p.name} Zora`);

  return [
    '*PM Zora Commands*',
    '',
    '`/status` — Show all Zora instance health',
    '`/list` — List configured projects',
    '`/spawn <project>` — Start a project Zora',
    '`/stop <project>` — Stop a project Zora',
    '',
    '*Routing*',
    ...routingExamples,
    '',
    'Or just send a message — PM Zora will route it automatically.',
  ].join('\n');
}
