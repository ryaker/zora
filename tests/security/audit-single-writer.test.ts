/**
 * One audit log, one writer — SEC-28.
 *
 * Zora used to write two audit files under one config key. `AuditLogger` wrote
 * the hash-chained `-security` log; `AuditLogHook` did its own `fs.appendFile`
 * into the configured path, in its own schema. The file recording what the
 * agent actually *did* was the unchained one, which meant:
 *
 *   - editing the record of a tool call left no evidence, because there was no
 *     chain over it — `audit --verify` could only ever report that file
 *     `unverifiable` (SEC-25 made it say so out loud instead of "verified");
 *   - tool-call writes bypassed the single write queue that exists precisely
 *     because `_appendEntry()` mutates shared state.
 *
 * These tests fail against that arrangement in both directions: tool calls must
 * land in the chained log, and the hook must not own a file of its own.
 *
 * The behavioural test asserts on the runner a *booted* Orchestrator holds. A
 * test that registers its own `AuditLogHook` supplies exactly the wiring it is
 * meant to be checking — the ARCH-02 lesson, one layer down: it would pass with
 * the orchestrator's registration deleted.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Orchestrator } from '../../src/orchestrator/orchestrator.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { MockProvider } from '../fixtures/mock-provider.js';
import { AuditLogger, securityAuditLogPath } from '../../src/security/audit-logger.js';
import { AuditLogHook } from '../../src/hooks/built-in/audit-log.js';
import { ToolHookRunner } from '../../src/hooks/tool-hook-runner.js';
import type { AuditEntry } from '../../src/security/security-types.js';
import type { ZoraPolicy } from '../../src/types.js';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

const testPolicy: ZoraPolicy = {
  filesystem: { allowed_paths: ['/tmp'], denied_paths: [], resolve_symlinks: false, follow_symlinks: false },
  shell: { mode: 'allowlist', allowed_commands: ['echo'], denied_commands: [], split_chained_commands: true, max_execution_time: '30s' },
  actions: { reversible: [], irreversible: [], always_flag: [] },
  network: { allowed_domains: [], denied_domains: [], max_request_size: '10MB' },
};

const readEntries = (file: string): AuditEntry[] =>
  fs
    .readFileSync(file, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as AuditEntry);

describe('SEC-28 — the tool hook writes through the chained logger', () => {
  let baseDir: string | null = null;
  let orchestrator: Orchestrator | null = null;

  afterEach(async () => {
    await orchestrator?.shutdown().catch(() => { /* teardown is not under test */ });
    if (baseDir) await fsp.rm(baseDir, { recursive: true, force: true }).catch(() => { /* temp dir */ });
    orchestrator = null;
    baseDir = null;
  });

  async function bootWithAuditIn(dir: string): Promise<{ configured: string; chained: string }> {
    const configured = path.join(dir, 'audit', 'audit.jsonl');
    const config = structuredClone(DEFAULT_CONFIG);
    config.agent.log_level = 'error';
    config.agent.workspace = path.join(dir, 'workspace');
    config.security.audit_log = configured;

    orchestrator = new Orchestrator({
      config,
      policy: testPolicy,
      providers: [new MockProvider({ name: 'primary', rank: 1 })],
      baseDir: dir,
      skipChannels: true,
    });
    await orchestrator.boot();
    return { configured, chained: securityAuditLogPath(configured) };
  }

  it('records a tool call in the chained log, and leaves the legacy file unwritten', async () => {
    baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zora-audit-writer-'));
    const { configured, chained } = await bootWithAuditIn(baseDir);

    const before = readEntries(chained).length; // boot writes its own entry

    // The chain a booted Orchestrator holds — not one this test assembled.
    await orchestrator!.toolHookRunner.runAfter({
      jobId: 'job-audit-1',
      tool: 'bash',
      arguments: { command: 'echo hi', api_key: 'sk-live-must-not-appear' },
      result: 'hi\n',
      durationMs: 42,
    });

    const entries = readEntries(chained);
    expect(
      entries.length,
      'the tool call produced no entry in the chained log — AuditLogHook is not ' +
        'registered on the booted runner, or is not writing through the logger',
    ).toBe(before + 1);

    const entry = entries[entries.length - 1]!;
    expect(entry.toolName).toBe('bash');
    expect(entry.jobId).toBe('job-audit-1');
    expect(entry.eventType).toBe('tool_invocation');
    // The point of the gap: this record is tamper-evident, which it never was
    // while it lived in the hook's own file.
    expect(entry.hash, 'tool-call entry carries no hash — it is not chained').toBeTruthy();
    expect(entry.previousHash).toBeTruthy();
    expect(entry.result.durationMs).toBe(42);

    const verdict = await orchestrator!.auditLogger.verifyChain();
    expect(verdict.status, verdict.reason ?? '').toBe('verified');

    // Nothing writes the configured path any more. `audit` still reads it for
    // pre-SEC-28 history, so the file may exist on a real install — here it
    // must not have been created at all.
    expect(
      fs.existsSync(configured),
      `${configured} was written — there is a second audit writer again`,
    ).toBe(false);
  }, 40_000);

  it('redacts secrets before they reach the log', async () => {
    baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zora-audit-redact-'));
    const { chained } = await bootWithAuditIn(baseDir);

    await orchestrator!.toolHookRunner.runAfter({
      jobId: 'job-audit-2',
      tool: 'http_request',
      arguments: { url: 'https://api.example.com', api_key: 'sk-live-must-not-appear' },
      result: { ok: true },
      durationMs: 3,
    });

    // Redaction moved along with the write path; if it had been dropped in the
    // move, the secret would now be sitting in the *chained* log, where it is
    // harder to expunge without breaking the chain.
    const raw = fs.readFileSync(chained, 'utf-8');
    expect(raw).not.toContain('sk-live-must-not-appear');
    expect(raw).toContain('[REDACTED]');
  }, 40_000);

  it('serialises concurrent tool calls into a sound chain', async () => {
    baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zora-audit-concurrent-'));
    const { chained } = await bootWithAuditIn(baseDir);
    const before = readEntries(chained).length;

    // What this does and does not prove, because the difference matters:
    //
    // It proves no concurrent tool call is lost, duplicated, or written outside
    // the chain — 25 calls, 25 distinct entry IDs, chain still verifying.
    //
    // It does NOT prove the write queue is doing that work, and it is not
    // evidence that removing the queue is safe. Verified by deleting the queue
    // and running this test: it still passes. `_appendEntry` mutates
    // `_entryCounter` and `_previousHash` in one synchronous block with no
    // await between them, so single-threaded JS already makes that particular
    // interleaving impossible. What the queue additionally guarantees is that
    // append *order* matches chain order; unqueued, the appends are issued
    // concurrently and the file can order differently from the hashes, which
    // does not reproduce on demand. The mechanism is therefore pinned
    // structurally by the test below rather than raced for here.
    const calls = 25;
    await Promise.all(
      Array.from({ length: calls }, (_, i) =>
        orchestrator!.toolHookRunner.runAfter({
          jobId: `job-concurrent-${i}`,
          tool: 'read_file',
          arguments: { path: `/tmp/f-${i}` },
          result: { ok: true },
          durationMs: i,
        }),
      ),
    );

    const entries = readEntries(chained);
    expect(entries.length).toBe(before + calls);
    expect(new Set(entries.map(e => e.entryId)).size).toBe(entries.length);

    const verdict = await orchestrator!.auditLogger.verifyChain();
    expect(verdict.status, verdict.reason ?? '').toBe('verified');
  }, 40_000);
});

describe('SEC-28 — a failed audit write cannot break the tool call', () => {
  it('swallows the write failure in the after-chain', async () => {
    // Carried forward from the deleted createPostToolUseHook tests, which held
    // this property for the writer SEC-28 removed. It belongs to whichever
    // component does the writing, so it moves with it.
    //
    // The unwritable path is a *file* standing where a directory must be, so
    // the logger's `mkdir` fails with ENOTDIR. An earlier draft used a path
    // under /proc: `mkdir` there does not fail, it hangs, and the test timed
    // out looking exactly like an audit write that never settles.
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zora-audit-unwritable-'));
    const blocker = path.join(dir, 'not-a-directory');
    await fsp.writeFile(blocker, 'x');

    const runner = new ToolHookRunner();
    runner.register(new AuditLogHook(new AuditLogger(path.join(blocker, 'audit.jsonl'))));

    await expect(
      runner.runAfter({ jobId: 'job-x', tool: 'bash', arguments: { command: 'ls' }, result: 'ok', durationMs: 1 }),
    ).resolves.toBeUndefined();

    await fsp.rm(dir, { recursive: true, force: true });
  });
});

describe('SEC-28 — the one writer still serialises', () => {
  it('routes log() through the write queue', () => {
    // The structural half of the concurrency property above, for the reason
    // given there: the race cannot be reproduced in-process, so what is pinned
    // is that the mechanism is still in place. `log()` must hand its work to
    // `_writeQueue` rather than call `_appendEntry` directly — that is what
    // keeps append order and chain order the same, and it matters more now
    // that every tool call goes through this path and not just lifecycle
    // events.
    const source = fs.readFileSync(path.join(SRC_ROOT, 'security', 'audit-logger.ts'), 'utf-8');
    const body = source.slice(source.indexOf('async log(input: AuditEntryInput)'));
    const logBody = body.slice(0, body.indexOf('\n  }\n'));

    expect(
      /this\._writeQueue\s*=\s*this\._writeQueue/.test(logBody),
      'AuditLogger.log() no longer chains onto _writeQueue — writes are no longer ' +
        'serialised, so append order can diverge from the hash chain',
    ).toBe(true);
    expect(
      /^\s*return this\._appendEntry\(/m.test(logBody),
      'AuditLogger.log() calls _appendEntry directly, bypassing the write queue',
    ).toBe(false);
  });
});

describe('SEC-28 — the hook owns no file', () => {
  it('does not import a filesystem module', () => {
    // The structural half of "one writer". The behavioural test above sees the
    // legacy file stay absent for the calls it makes; this one fails the moment
    // the hook regains the ability to write anywhere at all, which is how the
    // second log appeared in the first place.
    const source = fs.readFileSync(path.join(SRC_ROOT, 'hooks', 'built-in', 'audit-log.ts'), 'utf-8');
    const fsImport = /^\s*import[^;]*from\s*['"]node:fs(?:\/promises)?['"]/m.exec(source);
    expect(
      fsImport?.[0] ?? null,
      'AuditLogHook imports a filesystem module again — it must hand entries to ' +
        'AuditLogger rather than write its own log, or SEC-28 is undone',
    ).toBeNull();
  });
});
