import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FilesystemTools } from '../../../src/tools/filesystem.js';
import { PolicyEngine } from '../../../src/security/policy-engine.js';
import { ZoraPolicy } from '../../../src/types.js';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    lstatSync: actual.lstatSync, // use actual for path tests
    realpathSync: actual.realpathSync,
  };
});

describe('FilesystemTools', () => {
  let engine: PolicyEngine;
  let tools: FilesystemTools;
  const policy: ZoraPolicy = {
    filesystem: {
      allowed_paths: ['/tmp/allowed'],
      denied_paths: ['/tmp/allowed/denied'],
      resolve_symlinks: true,
      follow_symlinks: false,
    },
    shell: { mode: 'allowlist', allowed_commands: [], denied_commands: [], split_chained_commands: true, max_execution_time: '1m' },
    actions: { reversible: [], irreversible: [], always_flag: [] },
    network: { allowed_domains: [], denied_domains: [], max_request_size: '1mb' },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(fs, 'readFileSync');
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'readdirSync');
    engine = new PolicyEngine(policy);
    tools = new FilesystemTools(engine);
  });

  describe('readFile', () => {
    it('reads file if allowed', () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue('hello world');
      const result = tools.readFile('/tmp/allowed/file.txt');
      expect(result.success).toBe(true);
      expect(result.content).toBe('hello world');
    });

    it('returns error if denied', () => {
      const result = tools.readFile('/etc/passwd');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not permitted');
    });
  });

  describe('writeFile', () => {
    it('writes file if allowed', () => {
      const result = tools.writeFile('/tmp/allowed/new.txt', 'data');
      expect(result.success).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('editFile', () => {
    it('replaces string if found once', () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue('foo bar baz');
      const result = tools.editFile('/tmp/allowed/file.txt', 'bar', 'qux');
      expect(result.success).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalledWith(expect.any(String), 'foo qux baz', 'utf8');
    });

    it('fails if string not found', () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue('foo bar baz');
      const result = tools.editFile('/tmp/allowed/file.txt', 'missing', 'qux');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('fails if multiple occurrences found', () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue('foo bar foo');
      const result = tools.editFile('/tmp/allowed/file.txt', 'foo', 'qux');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Multiple occurrences');
    });
  });
});
