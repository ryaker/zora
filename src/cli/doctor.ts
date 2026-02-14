/**
 * Doctor Checks — detect available providers and tools.
 *
 * Reusable by `zora-agent init` and a future `zora-agent doctor` command.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface DoctorResult {
  node: { found: boolean; version: string };
  claude: { found: boolean; path: string | null };
  gemini: { found: boolean; path: string | null };
}

async function whichCommand(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('which', [cmd]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function runDoctorChecks(): Promise<DoctorResult> {
  const [claudePath, geminiPath] = await Promise.all([
    whichCommand('claude'),
    whichCommand('gemini'),
  ]);

  const nodeVersion = process.version; // e.g. "v20.11.0"
  const nodeMajor = parseInt(nodeVersion.slice(1), 10);

  return {
    node: { found: nodeMajor >= 20, version: nodeVersion },
    claude: { found: claudePath !== null, path: claudePath },
    gemini: { found: geminiPath !== null, path: geminiPath },
  };
}
