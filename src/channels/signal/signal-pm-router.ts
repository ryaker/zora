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

  // 1. Slash commands — PM Zora handles these directly
  const cmdMatch = text.match(/^(\/\w+)\s*(.*)?$/s);
  if (cmdMatch?.[1]) {
    const cmd = cmdMatch[1].toLowerCase();
    if (SLASH_COMMANDS.has(cmd)) {
      return { type: 'command', command: cmd, args: (cmdMatch[2] ?? '').trim(), content: text };
    }
  }

  // 2. Explicit @ProjectName prefix
  const atMatch = text.match(/^@(\w+)\s+([\s\S]+)$/i);
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

  // 3. Keyword-based classification
  const lower = text.toLowerCase();
  for (const project of projects) {
    const keywords = project.keywords ?? [project.name.toLowerCase()];
    if (keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      log.info({ project: project.name, message: text.slice(0, 80) }, '[pm-router] Keyword match');
      return { type: 'route', project: project.name, content: text };
    }
  }

  return { type: 'unresolved', content: text };
}

/**
 * Format the /status command response.
 */
export async function formatStatus(
  projects: ProjectEntry[],
): Promise<string> {
  const lines: string[] = ['*PM Zora — Instance Status*', ''];
  for (const p of projects) {
    const icon = p.icon ?? '⚡';
    try {
      const res = await fetch(`http://localhost:${p.port}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      const status = res.ok ? '🟢 running' : '🔴 unhealthy';
      lines.push(`${icon} *${p.name}* — ${status} (port ${p.port})`);
    } catch {
      lines.push(`${icon} *${p.name}* — ⚫ offline (port ${p.port})`);
    }
  }
  return lines.join('\n');
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

export function formatHelp(): string {
  return [
    '*PM Zora Commands*',
    '',
    '`/status` — Show all Zora instance health',
    '`/list` — List configured projects',
    '`/spawn <project>` — Start a project Zora',
    '`/stop <project>` — Stop a project Zora',
    '',
    '*Routing*',
    '`@AgentDev <message>` — Route to AgentDev Zora',
    '`@Trading <message>` — Route to Trading Zora',
    '',
    'Or just send a message — PM Zora will route it automatically.',
  ].join('\n');
}
