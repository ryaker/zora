/**
 * AgentLoader — Loads agent definitions from .claude/agents/*.md files.
 *
 * Zora v0.6: Agent .md files use YAML-like frontmatter to define:
 *   - name, description, tools (comma-separated), model
 * The body of the file becomes the agent's system prompt.
 *
 * These are converted to SDK AgentDefinition records for the
 * `agents` option in query().
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { SdkAgentDefinition } from '../orchestrator/execution-loop.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface LoadedAgent {
  name: string;
  description: string;
  prompt: string;
  tools?: string[];
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
}

// ─── Frontmatter Parser ─────────────────────────────────────────────

/**
 * Parses YAML-like frontmatter from a markdown file.
 * Handles: name, description, tools (comma-separated string), model.
 */
export function parseFrontmatter(content: string): {
  meta: Record<string, string>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      meta[key] = value;
    }
  }

  return { meta, body: match[2]!.trim() };
}

// ─── Agent Loader ───────────────────────────────────────────────────

const VALID_MODELS = new Set(['sonnet', 'opus', 'haiku', 'inherit']);

/**
 * Loads all agent definitions from a directory of .md files.
 * @param agentsDir Path to directory containing agent .md files
 * @returns Record of agent name → LoadedAgent
 */
export async function loadAgents(
  agentsDir: string,
): Promise<Record<string, LoadedAgent>> {
  const agents: Record<string, LoadedAgent> = {};

  let files: string[];
  try {
    files = await fs.readdir(agentsDir);
  } catch {
    return agents; // Directory doesn't exist or can't be read
  }

  for (const file of files) {
    if (!file.endsWith('.md')) continue;

    const filePath = path.join(agentsDir, file);
    const content = await fs.readFile(filePath, 'utf-8');
    const { meta, body } = parseFrontmatter(content);

    const name = meta['name'] || path.basename(file, '.md');
    const description = meta['description'] || '';
    const toolsStr = meta['tools'] || '';
    const modelStr = meta['model'];

    const tools = toolsStr
      ? toolsStr.split(',').map((t) => t.trim()).filter(Boolean)
      : undefined;

    const model = modelStr && VALID_MODELS.has(modelStr)
      ? (modelStr as LoadedAgent['model'])
      : undefined;

    agents[name] = { name, description, prompt: body, tools, model };
  }

  return agents;
}

/**
 * Converts loaded agents to SDK AgentDefinition format.
 * This is the shape expected by query()'s `agents` option.
 */
export function toSdkAgents(
  agents: Record<string, LoadedAgent>,
): Record<string, SdkAgentDefinition> {
  const result: Record<string, SdkAgentDefinition> = {};

  for (const [name, agent] of Object.entries(agents)) {
    result[name] = {
      description: agent.description,
      prompt: agent.prompt,
      ...(agent.tools && { tools: agent.tools }),
      ...(agent.model && { model: agent.model }),
    };
  }

  return result;
}
