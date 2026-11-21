/**
 * Tests for SkillSynthesizer — autonomous post-session skill generation.
 *
 * Covers:
 *   - shouldSynthesize: all threshold boundary cases
 *   - findExistingSkill: match / no-match against mock filesystem
 *   - writeSkill: atomic write + lock file update
 *   - updateLockFile: SHA-256 hash persisted correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SkillSynthesizer, SKILL_THRESHOLD } from '../../../src/skills/SkillSynthesizer.js';
import { hashContent } from '../../../src/skills/SkillsLock.js';
import { ApprovalQueue } from '../../../src/core/approval-queue.js';

// ─── shouldSynthesize ────────────────────────────────────────────────

describe('SkillSynthesizer.shouldSynthesize', () => {
  const synth = new SkillSynthesizer();

  it('returns false when both toolCalls and turns are 0', () => {
    expect(synth.shouldSynthesize(0, 0)).toBe(false);
  });

  it('returns false when toolCalls=7 and turns=7 (both below threshold)', () => {
    expect(synth.shouldSynthesize(7, 7)).toBe(false);
  });

  it('returns true when toolCalls meets threshold (8) and turns is below', () => {
    expect(synth.shouldSynthesize(SKILL_THRESHOLD.toolCalls, 0)).toBe(true);
  });

  it('returns true when turns meets threshold (8) and toolCalls is below', () => {
    expect(synth.shouldSynthesize(0, SKILL_THRESHOLD.turns)).toBe(true);
  });

  it('returns true when both toolCalls and turns meet threshold', () => {
    expect(synth.shouldSynthesize(SKILL_THRESHOLD.toolCalls, SKILL_THRESHOLD.turns)).toBe(true);
  });

  it('returns true when toolCalls exceeds threshold', () => {
    expect(synth.shouldSynthesize(100, 0)).toBe(true);
  });

  it('returns true when turns exceeds threshold', () => {
    expect(synth.shouldSynthesize(0, 100)).toBe(true);
  });

  it('returns false at toolCalls=7, turns=0', () => {
    expect(synth.shouldSynthesize(7, 0)).toBe(false);
  });

  it('returns false at toolCalls=0, turns=7', () => {
    expect(synth.shouldSynthesize(0, 7)).toBe(false);
  });
});

// ─── findExistingSkill ───────────────────────────────────────────────

describe('SkillSynthesizer.findExistingSkill', () => {
  let tmpDir: string;
  let synth: SkillSynthesizer;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-synth-test-'));
    synth = new SkillSynthesizer({ baseDir: tmpDir });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns null when skills directory does not exist', async () => {
    const result = await synth.findExistingSkill('deploy docker container');
    expect(result).toBeNull();
  });

  it('returns null when no skills match the description', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    const skillDir = path.join(skillsDir, 'git-branch-tool');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: git-branch-tool\ndescription: Manage git branches and merges\n---\n## When to use\nGit operations.\n`,
    );

    const result = await synth.findExistingSkill('deploy kubernetes cluster on aws');
    expect(result).toBeNull();
  });

  it('returns the skill path when description strongly overlaps', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    const skillDir = path.join(skillsDir, 'docker-deploy');
    await fs.mkdir(skillDir, { recursive: true });
    const skillPath = path.join(skillDir, 'SKILL.md');
    await fs.writeFile(
      skillPath,
      `---\nname: docker-deploy\ndescription: Deploy docker containers to production\n---\n## When to use\nDocker deployment workflows.\n`,
    );

    // Description shares 'deploy' and 'docker' — should exceed 0.5 overlap ratio
    const result = await synth.findExistingSkill('deploy docker container to server');
    expect(result).toBe(skillPath);
  });

  it('skips directories without SKILL.md', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    // Create a directory without SKILL.md
    await fs.mkdir(path.join(skillsDir, 'incomplete-skill'), { recursive: true });

    const result = await synth.findExistingSkill('deploy docker container');
    expect(result).toBeNull();
  });

  it('skips non-directory entries in skills dir', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    await fs.mkdir(skillsDir, { recursive: true });
    // Write a plain file (not a directory)
    await fs.writeFile(path.join(skillsDir, 'not-a-dir.md'), 'stray file');

    const result = await synth.findExistingSkill('anything');
    expect(result).toBeNull();
  });
});

// ─── writeSkill ──────────────────────────────────────────────────────

describe('SkillSynthesizer.writeSkill', () => {
  let tmpDir: string;
  let synth: SkillSynthesizer;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-write-test-'));
    synth = new SkillSynthesizer({ baseDir: tmpDir });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes the SKILL.md file in the correct location', async () => {
    const content = `---\nname: test-skill\ndescription: A test skill\n---\n## When to use\nTesting.\n`;
    await synth.writeSkill('test-skill', content);

    const written = await fs.readFile(
      path.join(tmpDir, 'skills', 'test-skill', 'SKILL.md'),
      'utf-8',
    );
    expect(written).toBe(content);
  });

  it('updates the lock file after writing', async () => {
    const content = `---\nname: lock-test\ndescription: Lock file test\n---\n## When to use\nTesting.\n`;
    await synth.writeSkill('lock-test', content);

    const lockPath = path.join(tmpDir, 'skills', 'skills.lock.json');
    const lockRaw = await fs.readFile(lockPath, 'utf-8');
    const lockData: Record<string, string> = JSON.parse(lockRaw);

    expect(lockData['lock-test']).toBe(hashContent(content));
  });

  it('throws on invalid slug', async () => {
    const content = `---\nname: INVALID SLUG\ndescription: bad\n---\n`;
    await expect(synth.writeSkill('INVALID SLUG', content)).rejects.toThrow('Invalid skill slug');
  });

  it('creates intermediate directories if they do not exist', async () => {
    const content = `---\nname: nested-test\ndescription: Nested directory test\n---\n## When to use\nCreation.\n`;
    // tmpDir/skills/nested-test/ does not exist yet
    await expect(synth.writeSkill('nested-test', content)).resolves.toBeUndefined();
    const exists = await fs
      .access(path.join(tmpDir, 'skills', 'nested-test', 'SKILL.md'))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });
});

// ─── updateLockFile ──────────────────────────────────────────────────

describe('SkillSynthesizer.updateLockFile', () => {
  let tmpDir: string;
  let synth: SkillSynthesizer;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-lock-test-'));
    synth = new SkillSynthesizer({ baseDir: tmpDir });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes SHA-256 hash to skills.lock.json', async () => {
    const content = 'skill content here';
    await synth.updateLockFile('my-skill', content);

    const lockPath = path.join(tmpDir, 'skills', 'skills.lock.json');
    const raw = await fs.readFile(lockPath, 'utf-8');
    const data: Record<string, string> = JSON.parse(raw);

    expect(data['my-skill']).toBe(hashContent(content));
  });

  it('preserves existing entries when updating a new skill', async () => {
    await synth.updateLockFile('skill-a', 'content-a');
    await synth.updateLockFile('skill-b', 'content-b');

    const lockPath = path.join(tmpDir, 'skills', 'skills.lock.json');
    const raw = await fs.readFile(lockPath, 'utf-8');
    const data: Record<string, string> = JSON.parse(raw);

    expect(data['skill-a']).toBe(hashContent('content-a'));
    expect(data['skill-b']).toBe(hashContent('content-b'));
  });

  it('overwrites hash when same skill is updated with new content', async () => {
    await synth.updateLockFile('skill-x', 'old-content');
    await synth.updateLockFile('skill-x', 'new-content');

    const lockPath = path.join(tmpDir, 'skills', 'skills.lock.json');
    const raw = await fs.readFile(lockPath, 'utf-8');
    const data: Record<string, string> = JSON.parse(raw);

    expect(data['skill-x']).toBe(hashContent('new-content'));
    expect(data['skill-x']).not.toBe(hashContent('old-content'));
  });
});

// ─── maybeGenerateSkill ──────────────────────────────────────────────

describe('SkillSynthesizer.maybeGenerateSkill', () => {
  it('is a no-op when threshold is not met', async () => {
    // No provider — if it tried to synthesize, it would throw
    const synth = new SkillSynthesizer({ skipConfirmation: true });
    await expect(
      synth.maybeGenerateSkill({ taskDescription: 'simple task', toolCalls: 2, turns: 2 }),
    ).resolves.toBeUndefined();
  });

  it('is a no-op when no provider is configured and threshold is met', async () => {
    const synth = new SkillSynthesizer({ skipConfirmation: true });
    // Should not throw even though threshold is met — provider is missing
    await expect(
      synth.maybeGenerateSkill({ taskDescription: 'complex deploy task', toolCalls: 10, turns: 10 }),
    ).resolves.toBeUndefined();
  });
});

// ─── LEAN-204: no wasted LLM call when nobody can confirm ────────────

describe('SkillSynthesizer.maybeGenerateSkill without a confirmation route (LEAN-204)', () => {
  const longSession = { taskDescription: 'deploy the thing', toolCalls: 20, turns: 20 };

  function fakeProvider() {
    const execute = vi.fn(async function* () { /* no events */ });
    return { execute, provider: { name: 'fake', execute } as unknown as import('../../../src/types.js').LLMProvider };
  }

  it('makes no provider call with no TTY and no approval queue', async () => {
    const tty = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const { execute, provider } = fakeProvider();
      const synth = new SkillSynthesizer({ baseDir: await fs.mkdtemp(path.join(os.tmpdir(), 'zs-')), provider });
      await synth.maybeGenerateSkill(longSession);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: tty, configurable: true });
    }
  });

  it('still calls the provider when skipConfirmation is set', async () => {
    const { execute, provider } = fakeProvider();
    const synth = new SkillSynthesizer({ baseDir: await fs.mkdtemp(path.join(os.tmpdir(), 'zs-')), provider, skipConfirmation: true });
    await synth.maybeGenerateSkill(longSession);
    expect(execute).toHaveBeenCalled();
  });
});

// ─── #174: enabled-but-senderless approval queue ──────────────────────

describe('SkillSynthesizer.maybeGenerateSkill with an approval queue that cannot ask (#174)', () => {
  const longSession = { taskDescription: 'deploy the thing', toolCalls: 20, turns: 20 };
  const cfg = { enabled: true, timeoutMs: 1000, retryAsApproval: false, retryWindowMs: 0 };

  async function run(queue: ApprovalQueue) {
    const tty = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const execute = vi.fn(async function* () { /* no events */ });
      const provider = { name: 'fake', execute } as unknown as import('../../../src/types.js').LLMProvider;
      const synth = new SkillSynthesizer({ baseDir: await fs.mkdtemp(path.join(os.tmpdir(), 'zs-')), provider });
      synth.setApprovalQueue(queue);
      await synth.maybeGenerateSkill(longSession);
      return execute;
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: tty, configurable: true });
    }
  }

  it('skips synthesis when the queue is enabled but has no send handler', async () => {
    expect(await run(new ApprovalQueue(cfg))).not.toHaveBeenCalled();
  });

  it('still synthesizes once a send handler is wired', async () => {
    const q = new ApprovalQueue(cfg);
    q.setSendHandler(async () => {});
    expect(await run(q)).toHaveBeenCalled();
  });

  it('still synthesizes when a blanket grant covers it, even with no sender', async () => {
    const q = new ApprovalQueue(cfg);
    q.setSessionBlanketAllow(80);
    expect(await run(q)).toHaveBeenCalled();
  });

  it('canDecide is false for a disabled queue and never approves anything itself', () => {
    const q = new ApprovalQueue({ ...cfg, enabled: false });
    q.setSendHandler(async () => {});
    expect(q.canDecide({ score: 50 })).toBe(false);
  });
});
