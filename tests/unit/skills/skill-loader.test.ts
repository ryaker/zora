import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseSkillFrontmatter, loadSkills, loadSkillsLayered, getSkillLayers } from '../../../src/skills/skill-loader.js';
import type { SkillLayer } from '../../../src/skills/skill-loader.js';
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

// ─── TYPE-09: Three-Layer Skill Precedence ────────────────────────────

describe('getSkillLayers', () => {
  it('returns three layers in project > global > builtin order', () => {
    const layers = getSkillLayers('/test/project');
    expect(layers).toHaveLength(3);
    expect(layers[0]!.layer).toBe('project');
    expect(layers[1]!.layer).toBe('global');
    expect(layers[2]!.layer).toBe('builtin');
    expect(layers[0]!.dir).toContain('.zora/skills');
    expect(layers[0]!.dir).toContain('/test/project');
  });
});

describe('loadSkillsLayered', () => {
  let projectDir: string;
  let globalDir: string;
  let builtinDir: string;

  beforeEach(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'layered-skill-test-'));
    projectDir = path.join(base, 'project-skills');
    globalDir = path.join(base, 'global-skills');
    builtinDir = path.join(base, 'builtin-skills');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(globalDir, { recursive: true });
    await fs.mkdir(builtinDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up parent of projectDir
    const base = path.dirname(projectDir);
    await fs.rm(base, { recursive: true, force: true });
  });

  function makeLayers(): Array<{ dir: string; layer: SkillLayer }> {
    return [
      { dir: projectDir, layer: 'project' },
      { dir: globalDir, layer: 'global' },
      { dir: builtinDir, layer: 'builtin' },
    ];
  }

  async function createSkill(parentDir: string, name: string, desc: string): Promise<void> {
    const dir = path.join(parentDir, name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'SKILL.md'), `---\ndescription: ${desc}\n---\n`);
  }

  it('loads skills from all three layers', async () => {
    await createSkill(projectDir, 'proj-skill', 'Project skill');
    await createSkill(globalDir, 'global-skill', 'Global skill');
    await createSkill(builtinDir, 'builtin-skill', 'Built-in skill');

    const skills = await loadSkillsLayered({ layers: makeLayers() });
    expect(skills).toHaveLength(3);
    expect(skills.map(s => s.name)).toEqual(['builtin-skill', 'global-skill', 'proj-skill']);
    expect(skills.find(s => s.name === 'proj-skill')!.layer).toBe('project');
    expect(skills.find(s => s.name === 'global-skill')!.layer).toBe('global');
    expect(skills.find(s => s.name === 'builtin-skill')!.layer).toBe('builtin');
  });

  it('project skill overrides global skill with same name', async () => {
    await createSkill(projectDir, 'shared', 'Project version');
    await createSkill(globalDir, 'shared', 'Global version');

    const skills = await loadSkillsLayered({ layers: makeLayers() });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('shared');
    expect(skills[0]!.description).toBe('Project version');
    expect(skills[0]!.layer).toBe('project');
  });

  it('global skill overrides builtin skill with same name', async () => {
    await createSkill(globalDir, 'shared', 'Global version');
    await createSkill(builtinDir, 'shared', 'Builtin version');

    const skills = await loadSkillsLayered({ layers: makeLayers() });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.description).toBe('Global version');
    expect(skills[0]!.layer).toBe('global');
  });

  it('project skill overrides both global and builtin with same name', async () => {
    await createSkill(projectDir, 'shared', 'Project version');
    await createSkill(globalDir, 'shared', 'Global version');
    await createSkill(builtinDir, 'shared', 'Builtin version');

    const skills = await loadSkillsLayered({ layers: makeLayers() });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.description).toBe('Project version');
    expect(skills[0]!.layer).toBe('project');
  });

  it('handles missing layer directories gracefully', async () => {
    await createSkill(globalDir, 'only-global', 'The only skill');

    const layers: Array<{ dir: string; layer: SkillLayer }> = [
      { dir: '/nonexistent/project', layer: 'project' },
      { dir: globalDir, layer: 'global' },
      { dir: '/nonexistent/builtin', layer: 'builtin' },
    ];

    const skills = await loadSkillsLayered({ layers });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('only-global');
  });

  it('returns empty array when all layers are empty', async () => {
    const skills = await loadSkillsLayered({ layers: makeLayers() });
    expect(skills).toEqual([]);
  });

  it('sorts results alphabetically across layers', async () => {
    await createSkill(builtinDir, 'zebra', 'Z');
    await createSkill(projectDir, 'alpha', 'A');
    await createSkill(globalDir, 'middle', 'M');

    const skills = await loadSkillsLayered({ layers: makeLayers() });
    expect(skills.map(s => s.name)).toEqual(['alpha', 'middle', 'zebra']);
  });
});
