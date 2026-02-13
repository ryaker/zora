import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseSkillFrontmatter, loadSkills } from '../../../src/skills/skill-loader.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('parseSkillFrontmatter', () => {
  it('extracts description from frontmatter', () => {
    const content = `---
name: test-skill
description: A test skill for testing.
---

Instructions here.`;

    const result = parseSkillFrontmatter(content);
    expect(result.description).toBe('A test skill for testing.');
  });

  it('returns empty description without frontmatter', () => {
    const result = parseSkillFrontmatter('Just plain markdown.');
    expect(result.description).toBe('');
  });

  it('returns empty description when no description key', () => {
    const content = `---
name: no-desc
---

Content.`;

    const result = parseSkillFrontmatter(content);
    expect(result.description).toBe('');
  });

  it('handles description with colons', () => {
    const content = `---
description: This skill does: many things
---`;

    const result = parseSkillFrontmatter(content);
    expect(result.description).toBe('This skill does: many things');
  });
});

describe('loadSkills', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-loader-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads skills from subdirectories with SKILL.md', async () => {
    const skillDir = path.join(tmpDir, 'my-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
description: My test skill.
---

Do the thing.`,
    );

    const skills = await loadSkills(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('my-skill');
    expect(skills[0]!.description).toBe('My test skill.');
    expect(skills[0]!.path).toBe(path.join(skillDir, 'SKILL.md'));
  });

  it('skips directories without SKILL.md', async () => {
    await fs.mkdir(path.join(tmpDir, 'no-skill'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'no-skill', 'README.md'), 'Not a skill.');

    const skills = await loadSkills(tmpDir);
    expect(skills).toHaveLength(0);
  });

  it('returns empty array for non-existent directory', async () => {
    const skills = await loadSkills('/nonexistent/path');
    expect(skills).toEqual([]);
  });

  it('sorts skills by name', async () => {
    for (const name of ['zebra', 'alpha', 'middle']) {
      const dir = path.join(tmpDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'SKILL.md'), `---\ndescription: ${name}\n---\n`);
    }

    const skills = await loadSkills(tmpDir);
    expect(skills.map((s) => s.name)).toEqual(['alpha', 'middle', 'zebra']);
  });

  it('uses default description when frontmatter has none', async () => {
    const dir = path.join(tmpDir, 'no-desc');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'SKILL.md'), 'Just instructions.');

    const skills = await loadSkills(tmpDir);
    expect(skills[0]!.description).toBe('Skill: no-desc');
  });
});
