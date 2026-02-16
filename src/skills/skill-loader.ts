/**
 * SkillLoader — Scans skill directories for available skills.
 *
 * Zora v0.6: Skills are .zora/skills/<name>/SKILL.md markdown files.
 * The SDK loads and invokes them automatically via settingSources.
 * This loader provides CLI introspection (list, info).
 *
 * TYPE-09: Three-layer precedence — project > global > built-in.
 * First-match-wins deduplication ensures project skills override global,
 * and global overrides built-in.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// ─── Types ───────────────────────────────────────────────────────────

export type SkillLayer = 'project' | 'global' | 'builtin';

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

export interface LayeredSkillInfo extends SkillInfo {
  layer: SkillLayer;
}

// ─── Frontmatter Parser ─────────────────────────────────────────────

/**
 * Extracts a description from SKILL.md YAML frontmatter.
 */
export function parseSkillFrontmatter(content: string): { description: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { description: '' };

  for (const line of match[1]!.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      if (key === 'description') {
        return { description: line.slice(colonIdx + 1).trim() };
      }
    }
  }

  return { description: '' };
}

// ─── Skill Scanner ──────────────────────────────────────────────────

/**
 * Scans a skills directory for SKILL.md files.
 * @param skillsDir Path to the skills parent directory (e.g. ~/.claude/skills)
 * @returns Sorted array of SkillInfo
 */
export async function loadSkills(skillsDir: string): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  let dirs: string[];
  try {
    dirs = await fs.readdir(skillsDir);
  } catch {
    return skills; // Directory doesn't exist
  }

  for (const dir of dirs) {
    const skillPath = path.join(skillsDir, dir, 'SKILL.md');
    try {
      const stat = await fs.stat(path.join(skillsDir, dir));
      if (!stat.isDirectory()) continue;

      const content = await fs.readFile(skillPath, 'utf-8');
      const { description } = parseSkillFrontmatter(content);
      skills.push({
        name: dir,
        description: description || `Skill: ${dir}`,
        path: skillPath,
      });
    } catch {
      // Skip directories without SKILL.md
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Three-Layer Skill Precedence (TYPE-09) ─────────────────────────

/**
 * Returns the default skill layer directories in precedence order.
 * 1. Project — `.zora/skills/` relative to cwd
 * 2. Global — `~/.zora/skills/`
 * 3. Built-in — `skills/` inside the package root
 *
 * @param cwd Override for the current working directory (useful for testing)
 */
export function getSkillLayers(cwd?: string): Array<{ dir: string; layer: SkillLayer }> {
  const projectDir = path.join(cwd ?? process.cwd(), '.zora', 'skills');
  const globalDir = path.join(os.homedir(), '.zora', 'skills');
  const builtinDir = path.resolve(path.join(path.dirname(import.meta.url.replace('file://', '')), '..', 'skills'));

  return [
    { dir: projectDir, layer: 'project' as SkillLayer },
    { dir: globalDir, layer: 'global' as SkillLayer },
    { dir: builtinDir, layer: 'builtin' as SkillLayer },
  ];
}

/**
 * Scans a single skills directory and returns LayeredSkillInfo entries.
 */
async function scanSkillLayer(skillsDir: string, layer: SkillLayer): Promise<LayeredSkillInfo[]> {
  const skills: LayeredSkillInfo[] = [];

  let dirs: string[];
  try {
    dirs = await fs.readdir(skillsDir);
  } catch {
    return skills; // Directory doesn't exist
  }

  for (const dir of dirs) {
    const skillPath = path.join(skillsDir, dir, 'SKILL.md');
    try {
      const stat = await fs.stat(path.join(skillsDir, dir));
      if (!stat.isDirectory()) continue;

      const content = await fs.readFile(skillPath, 'utf-8');
      const { description } = parseSkillFrontmatter(content);
      skills.push({
        name: dir,
        description: description || `Skill: ${dir}`,
        path: skillPath,
        layer,
      });
    } catch {
      // Skip directories without SKILL.md
    }
  }

  return skills;
}

/**
 * Loads skills from all three precedence layers (project > global > built-in).
 * First-match-wins: if a skill name appears in a higher-precedence layer,
 * the lower-precedence version is excluded.
 *
 * @param options.cwd Override for project directory (defaults to process.cwd())
 * @param options.layers Override the layer directories (useful for testing)
 * @returns Sorted array of LayeredSkillInfo with layer annotation
 */
export async function loadSkillsLayered(options?: {
  cwd?: string;
  layers?: Array<{ dir: string; layer: SkillLayer }>;
}): Promise<LayeredSkillInfo[]> {
  const layers = options?.layers ?? getSkillLayers(options?.cwd);
  const seen = new Set<string>();
  const result: LayeredSkillInfo[] = [];

  for (const { dir, layer } of layers) {
    const skills = await scanSkillLayer(dir, layer);
    for (const skill of skills) {
      if (!seen.has(skill.name)) {
        seen.add(skill.name);
        result.push(skill);
      }
    }
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}
