import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseSubagentFrontmatter,
  loadSubagents,
  getSubagentLayers,
} from '../../../src/skills/subagent-loader.js';
import type { SkillLayer } from '../../../src/skills/skill-loader.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// ─── Frontmatter Parsing ─────────────────────────────────────────────

describe('parseSubagentFrontmatter', () => {
  it('extracts description and allowed_tools from frontmatter', () => {
    const content = `---
description: A code review agent
allowed_tools: Read, Grep, Glob
---

You are a code reviewer.`;

    const result = parseSubagentFrontmatter(content);
    expect(result.description).toBe('A code review agent');
    expect(result.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
    expect(result.systemPrompt).toBe('You are a code reviewer.');
  });

  it('uses body as system prompt when no explicit system_prompt field', () => {
    const content = `---
description: Test agent
allowed_tools: Bash
---

Multi-line
system prompt.`;

    const result = parseSubagentFrontmatter(content);
    expect(result.systemPrompt).toBe('Multi-line\nsystem prompt.');
  });

  it('prefers explicit system_prompt over body', () => {
    const content = `---
description: Test
system_prompt: Explicit prompt
allowed_tools: Read
---

This body should be ignored for system prompt.`;

    const result = parseSubagentFrontmatter(content);
    expect(result.systemPrompt).toBe('Explicit prompt');
  });

  it('returns empty values for content without frontmatter', () => {
    const result = parseSubagentFrontmatter('Just instructions.');
    expect(result.description).toBe('');
    expect(result.allowedTools).toEqual([]);
    expect(result.systemPrompt).toBe('Just instructions.');
  });

  it('handles empty allowed_tools', () => {
    const content = `---
description: No tools agent
allowed_tools:
---`;

    const result = parseSubagentFrontmatter(content);
    expect(result.allowedTools).toEqual([]);
  });
});

// ─── Layer Discovery ──────────────────────────────────────────────────

describe('getSubagentLayers', () => {
  it('returns two layers in project > global order', () => {
    const layers = getSubagentLayers('/test/project');
    expect(layers).toHaveLength(2);
    expect(layers[0]!.layer).toBe('project');
    expect(layers[1]!.layer).toBe('global');
    expect(layers[0]!.dir).toContain('/test/project/.zora/subagents');
  });
});

// ─── Subagent Loading ─────────────────────────────────────────────────

describe('loadSubagents', () => {
  let projectDir: string;
  let globalDir: string;

  beforeEach(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'subagent-test-'));
    projectDir = path.join(base, 'project-subagents');
    globalDir = path.join(base, 'global-subagents');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(globalDir, { recursive: true });
  });

  afterEach(async () => {
    const base = path.dirname(projectDir);
    await fs.rm(base, { recursive: true, force: true });
  });

  function makeLayers(): Array<{ dir: string; layer: SkillLayer }> {
    return [
      { dir: projectDir, layer: 'project' },
      { dir: globalDir, layer: 'global' },
    ];
  }

  async function createSubagent(
    parentDir: string,
    name: string,
    desc: string,
    tools: string[] = [],
  ): Promise<void> {
    const dir = path.join(parentDir, name);
    await fs.mkdir(dir, { recursive: true });
    const toolsLine = tools.length > 0 ? `allowed_tools: ${tools.join(', ')}` : 'allowed_tools:';
    await fs.writeFile(
      path.join(dir, 'SUBAGENT.md'),
      `---\ndescription: ${desc}\n${toolsLine}\n---\n\nSystem prompt for ${name}.`,
    );
  }

  it('loads subagents from project and global layers', async () => {
    await createSubagent(projectDir, 'reviewer', 'Code reviewer', ['Read', 'Grep']);
    await createSubagent(globalDir, 'writer', 'Writer agent', ['Write', 'Edit']);

    const subagents = await loadSubagents({ layers: makeLayers() });
    expect(subagents).toHaveLength(2);
    expect(subagents.map(s => s.name)).toEqual(['reviewer', 'writer']);
  });

  it('project subagent overrides global with same name', async () => {
    await createSubagent(projectDir, 'shared', 'Project version', ['Read']);
    await createSubagent(globalDir, 'shared', 'Global version', ['Write']);

    const subagents = await loadSubagents({ layers: makeLayers() });
    expect(subagents).toHaveLength(1);
    expect(subagents[0]!.description).toBe('Project version');
    expect(subagents[0]!.layer).toBe('project');
  });

  it('strips blocked tools (nesting prevention)', async () => {
    await createSubagent(projectDir, 'evil', 'Nested agent', [
      'Read',
      'delegate_to_subagent',
      'Grep',
      'spawn_subagent',
    ]);

    const subagents = await loadSubagents({ layers: makeLayers() });
    expect(subagents[0]!.allowedTools).toEqual(['Read', 'Grep']);
  });

  it('handles missing directories gracefully', async () => {
    const layers: Array<{ dir: string; layer: SkillLayer }> = [
      { dir: '/nonexistent/project', layer: 'project' },
      { dir: '/nonexistent/global', layer: 'global' },
    ];

    const subagents = await loadSubagents({ layers });
    expect(subagents).toEqual([]);
  });

  it('includes system prompt from body', async () => {
    await createSubagent(projectDir, 'helper', 'Help agent', ['Read']);

    const subagents = await loadSubagents({ layers: makeLayers() });
    expect(subagents[0]!.systemPrompt).toBe('System prompt for helper.');
  });

  it('uses default description when frontmatter has none', async () => {
    const dir = path.join(projectDir, 'no-desc');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'SUBAGENT.md'), 'Just a body.');

    const subagents = await loadSubagents({ layers: makeLayers() });
    expect(subagents[0]!.description).toBe('Subagent: no-desc');
  });

  it('sorts results alphabetically', async () => {
    await createSubagent(projectDir, 'zebra', 'Z', []);
    await createSubagent(globalDir, 'alpha', 'A', []);

    const subagents = await loadSubagents({ layers: makeLayers() });
    expect(subagents.map(s => s.name)).toEqual(['alpha', 'zebra']);
  });
});
