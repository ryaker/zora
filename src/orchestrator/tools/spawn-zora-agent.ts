/**
 * spawn_zora_agent — Custom tool that spawns a project-scoped Zora instance.
 *
 * PM Zora uses this to start child Zora instances on demand. If the instance
 * is already running (health check passes), returns its URL without spawning.
 *
 * Safety constraints:
 * - Max concurrent children enforced via config [pm].max_children (default 5)
 * - Child stdout/stderr → platform log directory / zora-<project>.log
 * - Child PIDs tracked for orphan prevention on PM shutdown
 * - Per-project spawn lock prevents duplicate launches from concurrent calls
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { CustomToolDefinition } from '../execution-loop.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('spawn-zora-agent');

/** Platform-appropriate log directory for child Zora instances. */
function logDir(): string {
  if (os.platform() === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Logs');
  }
  // Linux / other: use XDG_STATE_HOME or ~/.local/state
  return process.env['XDG_STATE_HOME'] ?? path.join(os.homedir(), '.local', 'state', 'zora');
}

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
 * Uses the `zora-agent` CLI binary resolved from PATH — no hard-coded paths.
 */
function spawnZora(project: ProjectEntry, opts: SpawnToolOptions): void {
  const projectDir = project.project_dir.replace(/^~/, os.homedir());
  const dir = logDir();
  const logFile = path.join(dir, `zora-${project.name.toLowerCase()}.log`);

  // Ensure log directory exists
  mkdirSync(dir, { recursive: true });

  const logStream = createWriteStream(logFile, { flags: 'a' });

  log.info({ project: project.name, port: project.port, logFile }, '[spawn] Starting child Zora');

  // Use `zora-agent` from PATH — same binary that started the PM daemon
  const child = spawn('zora-agent', ['start', '--project', projectDir, '--no-open'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ZORA_PROJECT_DIR: projectDir,
    },
  });

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
  /** Per-project spawn lock — prevents concurrent duplicate launches */
  const spawning = new Set<string>();

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

      // Check if already running (health check)
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

      // Per-project spawn lock — prevent duplicate launches from concurrent calls
      if (spawning.has(project.name)) {
        return {
          success: false,
          error: `Spawn already in progress for "${project.name}" — try again in a moment`,
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

      spawning.add(project.name);
      try {
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

        const logFile = path.join(logDir(), `zora-${project.name.toLowerCase()}.log`);
        return {
          success: false,
          error: `Zora for "${project.name}" did not come up within 10 seconds. Check ${logFile}`,
          port: project.port,
        };
      } finally {
        spawning.delete(project.name);
      }
    },
  };
}
