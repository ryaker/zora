import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuditLogger } from '../../../src/security/audit-logger.js';
import type { AuditEntryInput } from '../../../src/security/audit-logger.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

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

describe('AuditLogger', () => {
  let tmpDir: string;
  let logPath: string;
  let logger: AuditLogger;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `zora-audit-test-${crypto.randomUUID()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    logPath = path.join(tmpDir, 'audit.jsonl');
    logger = new AuditLogger(logPath);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('appends entries to JSONL file', async () => {
    await logger.log(makeEntry());
    await logger.log(makeEntry());

    const content = await fs.readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('assigns sequential entry IDs', async () => {
    const e1 = await logger.log(makeEntry());
    const e2 = await logger.log(makeEntry());

    expect(e1.entryId).toBe('audit-1');
    expect(e2.entryId).toBe('audit-2');
  });

  it('builds a valid hash chain', async () => {
    await logger.log(makeEntry());
    await logger.log(makeEntry());
    await logger.log(makeEntry());

    const result = await logger.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(3);
  });

  it('first entry has previousHash = "genesis"', async () => {
    const entry = await logger.log(makeEntry());
    expect(entry.previousHash).toBe('genesis');
  });

  it('each entry links to the previous entry hash', async () => {
    const e1 = await logger.log(makeEntry());
    const e2 = await logger.log(makeEntry());

    expect(e2.previousHash).toBe(e1.hash);
  });

  it('detects corrupted chain', async () => {
    await logger.log(makeEntry());
    await logger.log(makeEntry());

    // Tamper with the file — corrupt the first entry's hash
    const content = await fs.readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    const entry = JSON.parse(lines[0]!);
    entry.hash = 'tampered-hash';
    lines[0] = JSON.stringify(entry);
    await fs.writeFile(logPath, lines.join('\n') + '\n', 'utf-8');

    const result = await logger.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
    expect(result.reason).toContain('hash mismatch');
  });

  it('detects broken chain link', async () => {
    await logger.log(makeEntry());
    await logger.log(makeEntry());
    await logger.log(makeEntry());

    // Tamper with second entry's previousHash
    const content = await fs.readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    const entry = JSON.parse(lines[1]!);
    entry.previousHash = 'wrong-hash';
    lines[1] = JSON.stringify(entry);
    await fs.writeFile(logPath, lines.join('\n') + '\n', 'utf-8');

    const result = await logger.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it('handles concurrent writes via serialized queue', async () => {
    // Fire off many writes concurrently
    const promises = Array.from({ length: 10 }, (_, i) =>
      logger.log(makeEntry({ jobId: `concurrent-${i}` })),
    );
    const entries = await Promise.all(promises);

    // All entries should have unique IDs
    const ids = entries.map(e => e.entryId);
    expect(new Set(ids).size).toBe(10);

    // Chain should be valid
    const result = await logger.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(10);
  });

  it('filters entries by jobId', async () => {
    await logger.log(makeEntry({ jobId: 'job-a' }));
    await logger.log(makeEntry({ jobId: 'job-b' }));
    await logger.log(makeEntry({ jobId: 'job-a' }));

    const entries = await logger.readEntries({ jobId: 'job-a' });
    expect(entries).toHaveLength(2);
    expect(entries.every(e => e.jobId === 'job-a')).toBe(true);
  });

  it('filters entries by eventType', async () => {
    await logger.log(makeEntry({ eventType: 'tool_invocation' }));
    await logger.log(makeEntry({ eventType: 'policy_violation' }));

    const entries = await logger.readEntries({ eventType: 'policy_violation' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.eventType).toBe('policy_violation');
  });

  it('returns empty array for non-existent log file', async () => {
    const freshLogger = new AuditLogger(path.join(tmpDir, 'nope.jsonl'));
    const entries = await freshLogger.readEntries();
    expect(entries).toEqual([]);
  });
});
