import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseFrontmatter, loadAgents, toSdkAgents } from '../../../src/teams/agent-loader.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('parseFrontmatter', () => {
  it('parses valid frontmatter', () => {
    const content = `---
name: code-reviewer
description: Review code for quality and security.
tools: Read, Grep, Glob, Bash
model: sonnet
---

You are a code review specialist.`;

    const { meta, body } = parseFrontmatter(content);
    expect(meta['name']).toBe('code-reviewer');
    expect(meta['description']).toBe('Review code for quality and security.');
    expect(meta['tools']).toBe('Read, Grep, Glob, Bash');
    expect(meta['model']).toBe('sonnet');
    expect(body).toBe('You are a code review specialist.');
  });

  it('returns empty meta for content without frontmatter', () => {
    const content = 'Just a plain markdown file.';
    const { meta, body } = parseFrontmatter(content);
    expect(meta).toEqual({});
    expect(body).toBe('Just a plain markdown file.');
  });

  it('handles empty body', () => {
    const content = `---
name: empty-agent
description: An agent with no body.
---
`;
    const { meta, body } = parseFrontmatter(content);
    expect(meta['name']).toBe('empty-agent');
    expect(body).toBe('');
  });

  it('handles colons in values', () => {
    const content = `---
description: This: has a colon in the value
---

Body text.`;

    const { meta } = parseFrontmatter(content);
    expect(meta['description']).toBe('This: has a colon in the value');
  });
});

describe('loadAgents', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loader-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads agents from .md files', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'test-agent.md'),
      `---
name: test-agent
description: A test agent.
tools: Read, Grep
model: haiku
---

You are a test agent.`,
    );

    const agents = await loadAgents(tmpDir);
    expect(agents['test-agent']).toBeDefined();
    expect(agents['test-agent']!.description).toBe('A test agent.');
    expect(agents['test-agent']!.tools).toEqual(['Read', 'Grep']);
    expect(agents['test-agent']!.model).toBe('haiku');
    expect(agents['test-agent']!.prompt).toBe('You are a test agent.');
  });

  it('uses filename as name when frontmatter name is missing', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'my-agent.md'),
      'Just a prompt without frontmatter.',
    );

    const agents = await loadAgents(tmpDir);
    expect(agents['my-agent']).toBeDefined();
    expect(agents['my-agent']!.name).toBe('my-agent');
    expect(agents['my-agent']!.prompt).toBe('Just a prompt without frontmatter.');
  });

  it('skips non-.md files', async () => {
    await fs.writeFile(path.join(tmpDir, 'README.txt'), 'Not an agent.');
    await fs.writeFile(
      path.join(tmpDir, 'real-agent.md'),
      `---
name: real-agent
description: A real agent.
---

Prompt here.`,
    );

    const agents = await loadAgents(tmpDir);
    expect(Object.keys(agents)).toEqual(['real-agent']);
  });

  it('returns empty record for non-existent directory', async () => {
    const agents = await loadAgents('/nonexistent/path');
    expect(agents).toEqual({});
  });

  it('ignores invalid model values', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'bad-model.md'),
      `---
name: bad-model
description: Agent with bad model.
model: gpt-4
---

Prompt.`,
    );

    const agents = await loadAgents(tmpDir);
    expect(agents['bad-model']!.model).toBeUndefined();
  });
});

describe('toSdkAgents', () => {
  it('converts loaded agents to SDK format', () => {
    const result = toSdkAgents({
      'test-agent': {
        name: 'test-agent',
        description: 'A test agent.',
        prompt: 'You are a test agent.',
        tools: ['Read', 'Grep'],
        model: 'sonnet',
      },
    });

    expect(result['test-agent']).toEqual({
      description: 'A test agent.',
      prompt: 'You are a test agent.',
      tools: ['Read', 'Grep'],
      model: 'sonnet',
    });
  });

  it('omits undefined tools and model', () => {
    const result = toSdkAgents({
      minimal: {
        name: 'minimal',
        description: 'Minimal agent.',
        prompt: 'Do stuff.',
      },
    });

    expect(result['minimal']).toEqual({
      description: 'Minimal agent.',
      prompt: 'Do stuff.',
    });
    expect('tools' in result['minimal']!).toBe(false);
    expect('model' in result['minimal']!).toBe(false);
  });
});
