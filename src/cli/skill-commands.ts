/**
 * Skill CLI Commands — List and inspect available Claude Code skills.
 *
 * Zora v0.6: Skills live at ~/.claude/skills/<name>/SKILL.md.
 * The SDK invokes them automatically; these commands provide
 * CLI introspection for discovery.
 */

import type { Command } from 'commander';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { loadSkills } from '../skills/skill-loader.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('skill-commands');

export function registerSkillCommands(program: Command): void {
  const skill = program
    .command('skill')
    .description('List and inspect available Claude Code skills');

  skill
    .command('list')
    .description('List all available skills from ~/.claude/skills/')
    .action(async () => {
      const skillsDir = path.join(os.homedir(), '.claude', 'skills');
      const skills = await loadSkills(skillsDir);

      if (skills.length === 0) {
        console.log('No skills found in ' + skillsDir);
        return;
      }

      console.log(`Found ${skills.length} skill(s):\n`);
      const maxNameLen = Math.max(...skills.map((s) => s.name.length));

      for (const s of skills) {
        const paddedName = s.name.padEnd(maxNameLen + 2);
        console.log(`  ${paddedName}${s.description}`);
      }
    });

  skill
    .command('info')
    .description('Show details about a specific skill')
    .argument('<name>', 'Skill name')
    .action(async (name: string) => {
      const skillsDir = path.join(os.homedir(), '.claude', 'skills');
      const skills = await loadSkills(skillsDir);
      const found = skills.find((s) => s.name === name);

      if (!found) {
        log.error({ name, skillsDir }, 'Skill not found');
        const similar = skills.filter((s) => s.name.includes(name));
        if (similar.length > 0) {
          log.info({ suggestions: similar.map((s) => s.name) }, 'Did you mean one of these?');
        }
        process.exit(1);
      }

      console.log(`Name:        ${found.name}`);
      console.log(`Description: ${found.description}`);
      console.log(`Path:        ${found.path}`);

      // Show first few lines of the skill content
      try {
        const content = await fs.readFile(found.path, 'utf-8');
        const lines = content.split('\n');
        // Skip frontmatter
        let startLine = 0;
        if (lines[0] === '---') {
          const endIdx = lines.indexOf('---', 1);
          if (endIdx > 0) startLine = endIdx + 1;
        }
        const preview = lines.slice(startLine, startLine + 5).join('\n').trim();
        if (preview) {
          console.log(`\nPreview:\n  ${preview.split('\n').join('\n  ')}`);
        }
      } catch {
        // Skip preview on read error
      }
    });
}
