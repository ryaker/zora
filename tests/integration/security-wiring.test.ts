/**
 * Integration tests: security wiring introduced in PR #165.
 *
 * 1. SecretsManager secret names reach SecretRedactHook (key-name redaction)
 * 2. Dynamic value-pattern redacts values even when the key doesn't match
 * 3. SkillSynthesizer routes approval through ApprovalQueue when stdin is not a TTY
 *
 * SecretRedactHook is a module-level singleton whose pattern arrays are additive.
 * We can't use vi.isolateModules (not available in vitest 3.x) so instead each test
 * uses vi.resetModules() + a fresh dynamic import() to get a clean instance.
 * The SecretsManager is purely a data store (no singleton state) so it is imported
 * once at the top level.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { SecretsManager } from '../../src/security/secrets-manager.js';

// ─── Helpers ──────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return path.join(os.tmpdir(), `zora-sec-wiring-${crypto.randomUUID()}`);
}

function makeToolCallContext(args: Record<string, unknown>) {
  return {
    jobId: 'test-job',
    tool: 'test-tool',
    arguments: args,
  };
}

/** Return a fresh SecretRedactHook singleton by resetting the module registry. */
async function freshSecretRedactHook() {
  vi.resetModules();
  const mod = await import('../../src/hooks/built-in/secret-redact.js');
  return mod.SecretRedactHook;
}

// ─── 1. SecretRedactHook: secret names from SecretsManager reach the hook ──

describe('SecretRedactHook: secret names wired from SecretsManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('redacts a tool arg whose key matches a stored secret name', async () => {
    const hook = await freshSecretRedactHook();

    const sm = new SecretsManager(tmpDir, 'test-master-pw');
    await sm.init();
    await sm.storeSecret('my_db_password', 'supersecret123');

    // Mirror the orchestrator wiring: list names → register each as a key pattern.
    const names = await sm.listSecretNames();
    for (const name of names) {
      hook.addPattern(new RegExp(`^${name}$`, 'i'));
    }

    const ctx = makeToolCallContext({ my_db_password: 'supersecret123' });
    const result = await hook.run(ctx);

    expect(result.allow).toBe(true);
    expect(result.modifiedArgs).toBeDefined();
    expect((result.modifiedArgs as Record<string, unknown>)['my_db_password']).toBe('[REDACTED]');
  });

  it('does NOT redact an unrelated arg key', async () => {
    const hook = await freshSecretRedactHook();

    const sm = new SecretsManager(tmpDir, 'test-master-pw');
    await sm.init();
    await sm.storeSecret('my_db_password', 'supersecret123');

    const names = await sm.listSecretNames();
    for (const name of names) {
      hook.addPattern(new RegExp(`^${name}$`, 'i'));
    }

    // Arg key 'output_file' should NOT be redacted — it doesn't match any name
    const ctx = makeToolCallContext({ output_file: '/tmp/result.json', my_db_password: 'val' });
    const result = await hook.run(ctx);

    const modified = result.modifiedArgs as Record<string, unknown> | undefined;
    // output_file should pass through unmodified
    const outputValue = modified?.['output_file'] ?? ctx.arguments['output_file'];
    expect(outputValue).toBe('/tmp/result.json');
  });

  it('is case-insensitive: MY_DB_PASSWORD key is redacted when secret name is my_db_password', async () => {
    const hook = await freshSecretRedactHook();

    const sm = new SecretsManager(tmpDir, 'test-master-pw');
    await sm.init();
    await sm.storeSecret('my_db_password', 'supersecret123');

    const names = await sm.listSecretNames();
    for (const name of names) {
      hook.addPattern(new RegExp(`^${name}$`, 'i'));
    }

    // Use upper-case key — the /i flag on the regex should still match
    const ctx = makeToolCallContext({ MY_DB_PASSWORD: 'somevalue' });
    const result = await hook.run(ctx);

    expect(result.modifiedArgs).toBeDefined();
    expect((result.modifiedArgs as Record<string, unknown>)['MY_DB_PASSWORD']).toBe('[REDACTED]');
  });

  it('multiple stored secrets: all matching keys are redacted', async () => {
    const hook = await freshSecretRedactHook();

    const sm = new SecretsManager(tmpDir, 'test-master-pw');
    await sm.init();
    await sm.storeSecret('db_pass', 'abc123');
    await sm.storeSecret('stripe_key', 'xyz789');

    const names = await sm.listSecretNames();
    for (const name of names) {
      hook.addPattern(new RegExp(`^${name}$`, 'i'));
    }

    const ctx = makeToolCallContext({ db_pass: 'abc123', stripe_key: 'xyz789', safe_field: 'hello' });
    const result = await hook.run(ctx);

    const modified = result.modifiedArgs as Record<string, unknown>;
    expect(modified['db_pass']).toBe('[REDACTED]');
    expect(modified['stripe_key']).toBe('[REDACTED]');
    expect(modified['safe_field']).toBe('hello');
  });
});

// ─── 2. SecretRedactHook: dynamic value-pattern redacts by value ────────────

describe('SecretRedactHook: dynamic value-pattern (addPattern with valuePattern)', () => {
  it('redacts a value matching a supplied value regex, regardless of key name', async () => {
    const hook = await freshSecretRedactHook();

    // Key pattern /^ignored$/ won't match 'some_field'; value pattern /^supersecret/ will.
    hook.addPattern(/^ignored$/, /^supersecret/);

    const ctx = makeToolCallContext({ some_field: 'supersecret123' });
    const result = await hook.run(ctx);

    expect(result.modifiedArgs).toBeDefined();
    expect((result.modifiedArgs as Record<string, unknown>)['some_field']).toBe('[REDACTED]');
  });

  it('does NOT redact a value that only partially contains the pattern prefix', async () => {
    const hook = await freshSecretRedactHook();

    // Pattern anchored to ^xyzABC — a different prefix should NOT match
    hook.addPattern(/^ignored$/, /^xyzABC/);

    const ctx = makeToolCallContext({ some_field: 'ordinary-value' });
    const result = await hook.run(ctx);

    // modifiedArgs should be undefined (no change) or the field should be unchanged
    const value = result.modifiedArgs
      ? (result.modifiedArgs as Record<string, unknown>)['some_field']
      : ctx.arguments['some_field'];
    expect(value).toBe('ordinary-value');
  });
});

// ─── 3. SkillSynthesizer: ApprovalQueue used when stdin is not a TTY ─────────

describe('SkillSynthesizer: ApprovalQueue routing in non-TTY context', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('calls ApprovalQueue.request() instead of failing closed when queue is enabled', async () => {
    tmpDir = makeTmpDir();
    await fs.mkdir(tmpDir, { recursive: true });

    const { ApprovalQueue } = await import('../../src/core/approval-queue.js');
    const { SkillSynthesizer } = await import('../../src/skills/SkillSynthesizer.js');

    const queue = new ApprovalQueue({ enabled: true, timeoutMs: 5000, retryAsApproval: false, retryWindowMs: 0 });

    // Auto-approve: as soon as request() fires its send handler, immediately reply with 'allow'
    const sentMessages: string[] = [];
    let capturedToken: string | null = null;

    queue.setSendHandler(async (msg: string) => {
      sentMessages.push(msg);
      // Extract the ZORA-XXXX token from the message
      const match = /Token: `(ZORA-[A-Z0-9]{4})`/.exec(msg);
      if (match) {
        capturedToken = match[1]!;
        // Slight async tick so the pending map is populated before we reply
        setImmediate(() => {
          if (capturedToken) queue.handleReply(capturedToken, 'allow');
        });
      }
    });

    const synth = new SkillSynthesizer({
      baseDir: tmpDir,
      skipConfirmation: false,
      approvalQueue: queue,
    });

    // Spy on queue.request to assert it was called
    const requestSpy = vi.spyOn(queue, 'request');

    // Temporarily override process.stdin.isTTY so _confirmWithUser takes the daemon path
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });

    try {
      // _confirmWithUser is private, so we test it via the internal method directly
      // by calling the public maybeGenerateSkill with a mock provider.
      // We need a provider that returns valid SKILL.md content.
      const mockContent = `---
name: test-skill
description: A test skill for wiring verification
platforms: [macos, linux]
created: 2026-01-01T00:00:00.000Z
tool_calls: 10
turns: 10
---
## When to use
Use this when testing the SkillSynthesizer approval queue wiring.

## Steps
1. Step one

## Pitfalls
- None
`;

      // Mock provider that immediately returns the skill content
      const mockProvider = {
        name: 'mock',
        execute: async function* (_ctx: unknown) {
          yield { type: 'done', content: { text: mockContent } };
        },
      };

      synth.setProvider(mockProvider as Parameters<typeof synth.setProvider>[0]);

      await synth.maybeGenerateSkill({
        taskDescription: 'test skill synthesis task for wiring verification',
        toolCalls: 10,
        turns: 10,
      });

      expect(requestSpy).toHaveBeenCalledOnce();
      expect(requestSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'SkillSynthesizer',
          score: 50,
        })
      );
      expect(sentMessages.length).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    }
  });

  it('fails closed (returns false) when stdin is not TTY and no queue is set', async () => {
    tmpDir = makeTmpDir();
    await fs.mkdir(tmpDir, { recursive: true });

    const { SkillSynthesizer } = await import('../../src/skills/SkillSynthesizer.js');

    const synth = new SkillSynthesizer({
      baseDir: tmpDir,
      skipConfirmation: false,
      // no approvalQueue
    });

    const mockContent = `---
name: test-skill-no-queue
description: A test skill with no queue
platforms: [macos]
created: 2026-01-01T00:00:00.000Z
tool_calls: 10
turns: 10
---
## When to use
Testing fail-closed behaviour.

## Steps
1. Check it

## Pitfalls
- None
`;

    const mockProvider = {
      name: 'mock-no-queue',
      execute: async function* (_ctx: unknown) {
        yield { type: 'done', content: { text: mockContent } };
      },
    };

    synth.setProvider(mockProvider as Parameters<typeof synth.setProvider>[0]);

    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });

    let skillWritten = false;
    const originalWriteSkill = synth.writeSkill.bind(synth);
    vi.spyOn(synth, 'writeSkill').mockImplementation(async (...args) => {
      skillWritten = true;
      return originalWriteSkill(...args);
    });

    try {
      await synth.maybeGenerateSkill({
        taskDescription: 'test skill for fail-closed verification check',
        toolCalls: 10,
        turns: 10,
      });

      // Skill must NOT have been written — fail-closed means skip
      expect(skillWritten).toBe(false);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    }
  });

  it('setApprovalQueue() wires the queue into an existing instance', async () => {
    const { ApprovalQueue } = await import('../../src/core/approval-queue.js');
    const { SkillSynthesizer } = await import('../../src/skills/SkillSynthesizer.js');

    const synth = new SkillSynthesizer();
    const queue = new ApprovalQueue({ enabled: true, timeoutMs: 5000, retryAsApproval: false, retryWindowMs: 0 });

    // Before: isEnabled check verifies queue works
    expect(queue.isEnabled()).toBe(true);

    // Wire it in via the post-boot setter (mirrors Orchestrator wiring)
    synth.setApprovalQueue(queue);

    // Spy on queue.request — we can verify it would be invoked when isTTY is falsy
    // by calling setApprovalQueue after construction, same as Orchestrator does.
    // This test specifically verifies the setter doesn't throw and the reference is live.
    const requestSpy = vi.spyOn(queue, 'request').mockResolvedValue(true);

    tmpDir = makeTmpDir();
    await fs.mkdir(tmpDir, { recursive: true });

    const synthWithDir = new SkillSynthesizer({ baseDir: tmpDir, skipConfirmation: false });
    synthWithDir.setApprovalQueue(queue);

    const mockContent = `---
name: wiring-test-skill
description: Verifies setApprovalQueue wiring
platforms: [macos]
created: 2026-01-01T00:00:00.000Z
tool_calls: 10
turns: 10
---
## When to use
Use to verify the setApprovalQueue wiring path.

## Steps
1. Call setApprovalQueue after construction

## Pitfalls
- None
`;

    const mockProvider = {
      name: 'mock-wiring',
      execute: async function* (_ctx: unknown) {
        yield { type: 'done', content: { text: mockContent } };
      },
    };

    synthWithDir.setProvider(mockProvider as Parameters<typeof synthWithDir.setProvider>[0]);

    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });

    try {
      await synthWithDir.maybeGenerateSkill({
        taskDescription: 'wiring test skill synthesis for approval queue set method',
        toolCalls: 10,
        turns: 10,
      });

      expect(requestSpy).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    }
  });
});
