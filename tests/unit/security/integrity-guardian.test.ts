import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IntegrityGuardian } from '../../../src/security/integrity-guardian.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

describe('IntegrityGuardian', () => {
  let tmpDir: string;
  let guardian: IntegrityGuardian;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `zora-integrity-test-${crypto.randomUUID()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    // Create critical files
    await fs.writeFile(path.join(tmpDir, 'SOUL.md'), '# Soul\nI am Zora.');
    await fs.writeFile(path.join(tmpDir, 'MEMORY.md'), '# Memory\n');
    await fs.writeFile(path.join(tmpDir, 'policy.toml'), '[filesystem]\nallowed = ["/tmp"]');
    await fs.writeFile(path.join(tmpDir, 'config.toml'), '[agent]\nname = "zora"');

    guardian = new IntegrityGuardian(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('computes baselines for all critical files', async () => {
    const baselines = await guardian.computeBaseline();
    const filePaths = baselines.map(b => b.filePath);

    expect(filePaths).toContain('SOUL.md');
    expect(filePaths).toContain('MEMORY.md');
    expect(filePaths).toContain('policy.toml');
    expect(filePaths).toContain('config.toml');
  });

  it('produces valid SHA-256 hashes', async () => {
    const baselines = await guardian.computeBaseline();
    const soulBaseline = baselines.find(b => b.filePath === 'SOUL.md')!;

    const expected = crypto
      .createHash('sha256')
      .update('# Soul\nI am Zora.')
      .digest('hex');

    expect(soulBaseline.hash).toBe(expected);
  });

  it('saves and loads baselines', async () => {
    await guardian.saveBaseline();

    const savedPath = path.join(tmpDir, 'state', 'integrity-baselines.json');
    const exists = await fs.access(savedPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    const data = JSON.parse(await fs.readFile(savedPath, 'utf-8'));
    expect(data.length).toBeGreaterThanOrEqual(4);
  });

  it('checkIntegrity passes when files unchanged', async () => {
    await guardian.saveBaseline();
    const result = await guardian.checkIntegrity();

    expect(result.valid).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it('detects file modification', async () => {
    await guardian.saveBaseline();

    // Tamper with SOUL.md
    await fs.writeFile(path.join(tmpDir, 'SOUL.md'), '# Compromised Soul');

    const result = await guardian.checkIntegrity();
    expect(result.valid).toBe(false);
    expect(result.mismatches.some(m => m.file === 'SOUL.md')).toBe(true);
  });

  it('detects file deletion', async () => {
    await guardian.saveBaseline();

    // Delete config.toml
    await fs.unlink(path.join(tmpDir, 'config.toml'));

    const result = await guardian.checkIntegrity();
    expect(result.valid).toBe(false);
    expect(result.mismatches.some(m => m.file === 'config.toml')).toBe(true);
  });

  it('includes tool registry hash when provided', async () => {
    const guardianWithTools = new IntegrityGuardian(tmpDir, {
      'read_file': 'function readFile(path: string) {}',
      'write_file': 'function writeFile(path: string) {}',
    });

    const baselines = await guardianWithTools.computeBaseline();
    const registryBaseline = baselines.find(b => b.filePath === '__tool_registry__');

    expect(registryBaseline).toBeDefined();
    expect(registryBaseline!.hash).toHaveLength(64); // SHA-256 hex
  });

  it('quarantines a file to the quarantine directory', async () => {
    const quarantinePath = await guardian.quarantineFile('SOUL.md');

    expect(quarantinePath).toContain('quarantine');
    expect(quarantinePath).toContain('SOUL.md');

    const quarantinedContent = await fs.readFile(quarantinePath, 'utf-8');
    expect(quarantinedContent).toBe('# Soul\nI am Zora.');
  });

  it('reports missing baselines file as integrity failure', async () => {
    // Don't save baselines first
    const result = await guardian.checkIntegrity();
    expect(result.valid).toBe(false);
  });

  it('records FILE_NOT_FOUND for missing critical files', async () => {
    // Remove one critical file before computing baselines
    await fs.unlink(path.join(tmpDir, 'MEMORY.md'));

    const baselines = await guardian.computeBaseline();
    const memoryBaseline = baselines.find(b => b.filePath === 'MEMORY.md');

    expect(memoryBaseline!.hash).toBe('FILE_NOT_FOUND');
  });
});
