/**
 * SkillLoader — Scans ~/.claude/skills/ for available skills.
 *
 * Zora v0.6: Skills are .claude/skills/<name>/SKILL.md markdown files.
 * The SDK loads and invokes them automatically via settingSources.
 * This loader provides CLI introspection (list, info).
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// ─── Types ───────────────────────────────────────────────────────────

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
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
