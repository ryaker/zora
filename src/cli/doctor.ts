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
  /** #249: local Ollama daemon reachability and installed models. */
  ollama: { found: boolean; endpoint: string; models: string[] };
}

/**
 * Probe a local Ollama daemon. Never throws: an absent daemon is a normal
 * state, not an error (#249 — Ollama must be a first-class primary provider).
 */
export async function detectOllama(
  endpoint = process.env['OLLAMA_HOST'] ?? 'http://localhost:11434',
): Promise<DoctorResult['ollama']> {
  const base = (/^https?:\/\//.test(endpoint) ? endpoint : `http://${endpoint}`).replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { found: false, endpoint: base, models: [] };
    const body = (await res.json()) as { models?: Array<{ name?: string }> };
    const models = (body.models ?? []).map(m => m.name).filter((n): n is string => !!n);
    return { found: true, endpoint: base, models };
  } catch {
    return { found: false, endpoint: base, models: [] };
  }
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
  const [claudePath, geminiPath, ollama] = await Promise.all([
    whichCommand('claude'),
    whichCommand('gemini'),
    detectOllama(),
  ]);

  const nodeVersion = process.version; // e.g. "v20.11.0"
  const nodeMajor = parseInt(nodeVersion.slice(1), 10);

  return {
    node: { found: nodeMajor >= 20, version: nodeVersion },
    claude: { found: claudePath !== null, path: claudePath },
    gemini: { found: geminiPath !== null, path: geminiPath },
    ollama,
  };
}
