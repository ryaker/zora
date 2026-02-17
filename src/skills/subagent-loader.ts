/**
 * SubagentLoader — Discovers and loads subagent definitions from filesystem.
 *
 * TYPE-10: Subagents are defined in SUBAGENT.md files within directory hierarchies:
 *   1. Project — `.zora/subagents/<name>/SUBAGENT.md`
 *   2. Global  — `~/.zora/subagents/<name>/SUBAGENT.md`
 *
 * Each subagent definition specifies:
 *   - name: unique identifier
 *   - description: what the subagent does
 *   - allowedTools: subset of tools the subagent can use
 *   - systemPrompt: optional system prompt override
 *
 * Subagent isolation rules (from ia-agents pattern):
 *   - Each subagent gets its own execution context
 *   - Declared tool subset (not the full tool set)
 *   - No access to parent conversation history
 *   - Cannot spawn nested subagents (delegate_to_subagent is excluded)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { SkillLayer } from './skill-loader.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface SubagentInfo {
  name: string;
  description: string;
  allowedTools: string[];
  systemPrompt: string;
  path: string;
  layer: SkillLayer;
}

// ─── Frontmatter Parser ─────────────────────────────────────────────

/**
 * Parses YAML frontmatter from a SUBAGENT.md file.
 * Extracts: description, allowed_tools (comma-separated), system_prompt.
 * The body of the markdown (after frontmatter) becomes the system prompt
 * if no explicit system_prompt frontmatter field is present.
 */
export function parseSubagentFrontmatter(content: string): {
  description: string;
  allowedTools: string[];
  systemPrompt: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)/);
  if (!match) {
    return { description: '', allowedTools: [], systemPrompt: content.trim() };
  }

  const frontmatter = match[1]!;
  const body = match[2]?.trim() ?? '';
  let description = '';
  let allowedTools: string[] = [];
  let systemPrompt = '';

  for (const line of frontmatter.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    switch (key) {
      case 'description':
        description = value;
        break;
      case 'allowed_tools':
        allowedTools = value.split(',').map(t => t.trim()).filter(Boolean);
        break;
      case 'system_prompt':
        systemPrompt = value;
        break;
    }
  }

  // Body becomes system prompt if no explicit system_prompt in frontmatter
  if (!systemPrompt && body) {
    systemPrompt = body;
  }

  return { description, allowedTools, systemPrompt };
}

// ─── Layer Directories ──────────────────────────────────────────────

/**
 * Returns subagent layer directories in precedence order.
 * Only project and global layers — no built-in subagents.
 */
export function getSubagentLayers(cwd?: string): Array<{ dir: string; layer: SkillLayer }> {
  const projectDir = path.join(cwd ?? process.cwd(), '.zora', 'subagents');
  const globalDir = path.join(os.homedir(), '.zora', 'subagents');

  return [
    { dir: projectDir, layer: 'project' as SkillLayer },
    { dir: globalDir, layer: 'global' as SkillLayer },
  ];
}

// ─── Subagent Scanner ───────────────────────────────────────────────

/** Blocked tools that subagents can never use (nesting prevention). */
const BLOCKED_SUBAGENT_TOOLS = ['delegate_to_subagent', 'spawn_subagent'];

/**
 * Scans a single directory for SUBAGENT.md files.
 */
async function scanSubagentLayer(dir: string, layer: SkillLayer): Promise<SubagentInfo[]> {
  const subagents: SubagentInfo[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return subagents;
  }

  for (const entry of entries) {
    const subagentPath = path.join(dir, entry, 'SUBAGENT.md');
    try {
      const stat = await fs.stat(path.join(dir, entry));
      if (!stat.isDirectory()) continue;

      const content = await fs.readFile(subagentPath, 'utf-8');
      const parsed = parseSubagentFrontmatter(content);

      // Filter out blocked tools (nesting prevention)
      const allowedTools = parsed.allowedTools.filter(
        t => !BLOCKED_SUBAGENT_TOOLS.includes(t)
      );

      subagents.push({
        name: entry,
        description: parsed.description || `Subagent: ${entry}`,
        allowedTools,
        systemPrompt: parsed.systemPrompt,
        path: subagentPath,
        layer,
      });
    } catch {
      // Skip directories without SUBAGENT.md
    }
  }

  return subagents;
}

/**
 * Loads subagent definitions from project and global layers.
 * First-match-wins deduplication (project overrides global).
 *
 * Subagent isolation is enforced:
 * - Tools like 'delegate_to_subagent' are always stripped from allowedTools
 * - Each subagent should be spawned with its own execution context
 *
 * @param options.cwd Override for project directory
 * @param options.layers Override layer directories (useful for testing)
 */
export async function loadSubagents(options?: {
  cwd?: string;
  layers?: Array<{ dir: string; layer: SkillLayer }>;
}): Promise<SubagentInfo[]> {
  const layers = options?.layers ?? getSubagentLayers(options?.cwd);
  const seen = new Set<string>();
  const result: SubagentInfo[] = [];

  for (const { dir, layer } of layers) {
    const subagents = await scanSubagentLayer(dir, layer);
    for (const subagent of subagents) {
      if (!seen.has(subagent.name)) {
        seen.add(subagent.name);
        result.push(subagent);
      }
    }
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}
