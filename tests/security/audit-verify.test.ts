/**
 * SEC-25 — `audit --verify` must verify the file that actually has a chain.
 *
 * The bug: `registerAuditCommands` built an `AuditLogger` over
 * `security.audit_log` (`~/.zora/audit/audit.jsonl`). That file is written by
 * `AuditLogHook` with no hash fields at all. The hash-chained log is the
 * `-security.jsonl` sibling, written by a different `AuditLogger` in the
 * orchestrator. So the tamper-detection command reported on a file with no chain
 * — and on a fresh install, where that file does not exist yet, printed
 * "Audit chain verified: 0 entries, all valid."
 *
 * These tests fail against that behaviour in both directions: the old code said
 * "verified" for an unverifiable file, and never looked at the chained one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { registerAuditCommands } from '../../src/cli/audit-commands.js';
import { AuditLogger, securityAuditLogPath } from '../../src/security/audit-logger.js';
import type { AuditEntryInput } from '../../src/security/audit-logger.js';

function makeEntry(overrides: Partial<AuditEntryInput> = {}): AuditEntryInput {
  return {
    jobId: overrides.jobId ?? 'job-1',
    eventType: overrides.eventType ?? 'tool_invocation',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    provider: overrides.provider ?? 'claude',
    toolName: overrides.toolName ?? 'read_file',
    parameters: overrides.parameters ?? { path: '/tmp/test' },
    result: overrides.result ?? { status: 'ok' },
  };
}

/** One line in the shape AuditLogHook writes — no hash, no previousHash. */
function toolLogLine(tool: string): string {
  return JSON.stringify({
    ts: new Date().toISOString(),
    jobId: 'job-tool',
    tool,
    arguments: { path: '/tmp/x' },
    result: { ok: true },
    durationMs: 12,
  });
}

describe('SEC-25 — securityAuditLogPath', () => {
  it('derives the chained sibling the orchestrator writes', () => {
    expect(securityAuditLogPath('/home/u/.zora/audit/audit.jsonl')).toBe(
      '/home/u/.zora/audit/audit-security.jsonl',
    );
  });

  it('matches the legacy inline derivation for the default path', () => {
    const base = '/home/u/.zora/audit/audit.jsonl';
    expect(securityAuditLogPath(base)).toBe(base.replace('.jsonl', '-security.jsonl'));
  });

  it('still produces a distinct path when the log has no extension', () => {
    expect(securityAuditLogPath('/var/log/zora-audit')).toBe('/var/log/zora-audit-security.jsonl');
  });
});

describe('SEC-25 — verifyChain never reports success for an unverifiable file', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `zora-sec25-${crypto.randomUUID()}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reports a missing log as unverifiable, not valid', async () => {
    const result = await new AuditLogger(path.join(tmpDir, 'nope.jsonl')).verifyChain();

    expect(result.status).toBe('unverifiable');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/nothing to verify/i);
  });

  it('reports an empty log as unverifiable, not valid', async () => {
    const logPath = path.join(tmpDir, 'empty.jsonl');
    await fs.writeFile(logPath, '', 'utf-8');

    const result = await new AuditLogger(logPath).verifyChain();

    expect(result.status).toBe('unverifiable');
    expect(result.valid).toBe(false);
  });

  it('reports the unchained tool log as unverifiable, not broken and not valid', async () => {
    const logPath = path.join(tmpDir, 'audit.jsonl');
    await fs.writeFile(logPath, `${toolLogLine('bash')}\n${toolLogLine('read_file')}\n`, 'utf-8');

    const result = await new AuditLogger(logPath).verifyChain();

    expect(result.valid).toBe(false);
    // Not "broken": nothing was tampered with — this file was never chained.
    expect(result.status).toBe('unverifiable');
    expect(result.reason).toMatch(/not hash-chained/i);
  });

  it('reports a hash-chaining-disabled logger as unverifiable, not valid', async () => {
    const logPath = path.join(tmpDir, 'unchained.jsonl');
    const writer = new AuditLogger(logPath, { hashChain: false });
    await writer.log(makeEntry());

    const result = await writer.verifyChain();

    expect(result.valid).toBe(false);
    expect(result.status).toBe('unverifiable');
    expect(result.reason).toMatch(/audit_hash_chain/);
  });

  it('still verifies a real chain and still detects tampering in it', async () => {
    const logPath = path.join(tmpDir, 'audit-security.jsonl');
    const writer = new AuditLogger(logPath);
    await writer.log(makeEntry({ toolName: 'a' }));
    await writer.log(makeEntry({ toolName: 'b' }));

    const clean = await new AuditLogger(logPath).verifyChain();
    expect(clean.status).toBe('verified');
    expect(clean.valid).toBe(true);
    expect(clean.entries).toBe(2);

    const lines = (await fs.readFile(logPath, 'utf-8')).trim().split('\n');
    const tampered = JSON.parse(lines[0]!) as Record<string, unknown>;
    tampered['toolName'] = 'rm_rf';
    lines[0] = JSON.stringify(tampered);
    await fs.writeFile(logPath, `${lines.join('\n')}\n`, 'utf-8');

    const dirty = await new AuditLogger(logPath).verifyChain();
    expect(dirty.status).toBe('broken');
    expect(dirty.valid).toBe(false);
    expect(dirty.brokenAt).toBe(0);
  });
});

describe('SEC-25 — `audit --verify` targets the chained log', () => {
  let tmpDir: string;
  let toolLogPath: string;
  let chainedLogPath: string;
  let out: string[];
  let err: string[];

  async function runVerify(): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerAuditCommands(program, () => toolLogPath);
    await program.parseAsync(['audit', '--verify'], { from: 'user' });
  }

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `zora-sec25-cli-${crypto.randomUUID()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    toolLogPath = path.join(tmpDir, 'audit.jsonl');
    chainedLogPath = securityAuditLogPath(toolLogPath);
    out = [];
    err = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void err.push(a.join(' ')));
    process.exitCode = undefined;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('does not claim success when only the unchained tool log exists', async () => {
    await fs.writeFile(toolLogPath, `${toolLogLine('bash')}\n`, 'utf-8');

    await runVerify();

    const all = [...out, ...err].join('\n');
    expect(all).not.toMatch(/chain verified/i);
    expect(all).toMatch(/cannot verify/i);
    expect(process.exitCode).toBeTruthy();
  });

  it('does not claim success on a fresh install with no logs at all', async () => {
    await runVerify();

    expect([...out, ...err].join('\n')).not.toMatch(/verified/i);
    expect(process.exitCode).toBeTruthy();
  });

  it('verifies the chained security log, not the tool log', async () => {
    // A tool log that would fail any chain check sits next to a good chained log.
    await fs.writeFile(toolLogPath, `${toolLogLine('bash')}\n`, 'utf-8');
    const writer = new AuditLogger(chainedLogPath);
    await writer.log(makeEntry());
    await writer.log(makeEntry());

    await runVerify();

    expect(out.join('\n')).toMatch(/Chain verified: 2 entries/);
    expect(process.exitCode).toBeFalsy();
  });

  it('labels the tool log as not chain-verifiable in the same report', async () => {
    await fs.writeFile(toolLogPath, `${toolLogLine('bash')}\n${toolLogLine('git')}\n`, 'utf-8');
    await new AuditLogger(chainedLogPath).log(makeEntry());

    await runVerify();

    const all = out.join('\n');
    expect(all).toMatch(/Not chain-verifiable/i);
    expect(all).toContain(toolLogPath);
    expect(all).toMatch(/2 tool-call entries/);
  });

  it('detects a tampered entry in the chained log and exits non-zero', async () => {
    const writer = new AuditLogger(chainedLogPath);
    await writer.log(makeEntry({ toolName: 'read_file' }));
    await writer.log(makeEntry({ toolName: 'write_file' }));

    const lines = (await fs.readFile(chainedLogPath, 'utf-8')).trim().split('\n');
    const entry = JSON.parse(lines[1]!) as Record<string, unknown>;
    entry['toolName'] = 'shell_exec';
    lines[1] = JSON.stringify(entry);
    await fs.writeFile(chainedLogPath, `${lines.join('\n')}\n`, 'utf-8');

    await runVerify();

    expect(err.join('\n')).toMatch(/CHAIN BROKEN at entry 1/);
    expect(process.exitCode).toBe(1);
  });
});
