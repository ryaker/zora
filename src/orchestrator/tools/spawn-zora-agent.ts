/**
 * spawn_zora_agent — Custom tool that spawns a project-scoped Zora instance.
 *
 * PM Zora uses this to start child Zora instances on demand. If the instance
 * is already running (health check passes), returns its URL without spawning.
 *
 * Safety constraints:
 * - Max concurrent children enforced via config [pm].max_children (default 5)
 * - Child stdout/stderr → ~/Library/Logs/zora-<project>.log
 * - Child PIDs tracked for orphan prevention on PM shutdown
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { CustomToolDefinition } from '../execution-loop.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('spawn-zora-agent');

export interface ProjectEntry {
  name: string;
  port: number;
  color?: string;
  icon?: string;
  project_dir: string;
}

export interface SpawnToolOptions {
  projects: ProjectEntry[];
  maxChildren?: number;
  /** Called with PID when a child is spawned — for orphan tracking */
  onSpawn?: (pid: number, project: string) => void;
  /** Called with PID when a child exits */
  onExit?: (pid: number, project: string) => void;
}

/**
 * Check if a Zora instance is already running on the given port.
 */
async function isRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Spawn a Zora instance for the given project directory.
 */
function spawnZora(project: ProjectEntry, opts: SpawnToolOptions): void {
  const zoraPath = process.execPath; // node binary
  const zoraBin = path.resolve(
    path.dirname(process.argv[1] ?? ''),
    'zora-agent',
  );

  const projectDir = project.project_dir.replace(/^~/, os.homedir());
  const logFile = path.join(
    os.homedir(),
    'Library',
    'Logs',
    `zora-${project.name.toLowerCase()}.log`,
  );

  // Determine config: use project dir's .zora/ if it exists, else fallback
  const args = ['start', '--project', projectDir, '--no-open'];

  log.info({ project: project.name, port: project.port, args }, '[spawn] Starting child Zora');

  const child = spawn(zoraPath, [zoraBin, ...args], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ZORA_PROJECT_DIR: projectDir,
    },
  });

  // Redirect logs
  const { createWriteStream } = require('node:fs');
  const logStream = createWriteStream(logFile, { flags: 'a' });
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  child.unref(); // allow parent to exit independently

  if (child.pid) {
    opts.onSpawn?.(child.pid, project.name);
    child.on('exit', (code) => {
      log.info({ project: project.name, code }, '[spawn] Child Zora exited');
      if (child.pid) opts.onExit?.(child.pid, project.name);
    });
  }
}

export function createSpawnZoraTool(opts: SpawnToolOptions): CustomToolDefinition {
  const activeChildren = new Map<string, number>(); // project name → PID

  const trackSpawn = (pid: number, project: string) => {
    activeChildren.set(project, pid);
    opts.onSpawn?.(pid, project);
  };

  const trackExit = (pid: number, project: string) => {
    if (activeChildren.get(project) === pid) {
      activeChildren.delete(project);
    }
    opts.onExit?.(pid, project);
  };

  return {
    name: 'spawn_zora_agent',
    description:
      'Spawn a project-scoped Zora instance or verify an existing one is running. ' +
      'Use this to start a child Zora for a specific project before routing tasks to it. ' +
      'Returns the instance URL and port.',
    input_schema: {
      type: 'object',
      properties: {
        project_name: {
          type: 'string',
          description: 'Name of the project to spawn (e.g. "AgentDev", "Trading")',
        },
        task: {
          type: 'string',
          description: 'Optional initial task to route to the instance after spawning',
        },
      },
      required: ['project_name'],
    },

    handler: async (input: Record<string, unknown>): Promise<unknown> => {
      const projectName = input['project_name'] as string;
      const task = input['task'] as string | undefined;

      const project = opts.projects.find(
        (p) => p.name.toLowerCase() === projectName.toLowerCase(),
      );

      if (!project) {
        const available = opts.projects.map((p) => p.name).join(', ');
        return {
          success: false,
          error: `Unknown project "${projectName}". Available: ${available}`,
        };
      }

      // Check if already running
      if (await isRunning(project.port)) {
        log.info({ project: projectName, port: project.port }, '[spawn] Already running');
        return {
          success: true,
          status: 'already_running',
          project: project.name,
          url: `http://localhost:${project.port}`,
          port: project.port,
          task: task ?? null,
        };
      }

      // Enforce max children cap
      const maxChildren = opts.maxChildren ?? 5;
      if (activeChildren.size >= maxChildren) {
        return {
          success: false,
          error: `Max concurrent child Zora instances (${maxChildren}) reached. Stop one first.`,
          active: Array.from(activeChildren.keys()),
        };
      }

      // Check project dir exists
      const projectDir = project.project_dir.replace(/^~/, os.homedir());
      if (!existsSync(projectDir)) {
        return {
          success: false,
          error: `Project directory not found: ${project.project_dir}`,
        };
      }

      spawnZora(project, { ...opts, onSpawn: trackSpawn, onExit: trackExit });

      // Wait up to 10s for the instance to come up
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        if (await isRunning(project.port)) {
          log.info({ project: projectName, port: project.port }, '[spawn] Child Zora ready');
          return {
            success: true,
            status: 'spawned',
            project: project.name,
            url: `http://localhost:${project.port}`,
            port: project.port,
            task: task ?? null,
          };
        }
      }

      return {
        success: false,
        error: `Zora for "${projectName}" did not come up within 10 seconds. Check ~/Library/Logs/zora-${projectName.toLowerCase()}.log`,
        port: project.port,
      };
    },
  };
}
