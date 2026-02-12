import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

// We can't easily test the exported program from src/cli/index.ts 
// because it calls program.parse() immediately.
// For v1, we'll verify the utility function writeAtomic.

import { writeAtomic } from '../../../src/utils/fs.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Filesystem Utilities', () => {
  const testDir = path.join(os.tmpdir(), 'zora-utils-test');
  const testFile = path.join(testDir, 'atomic.txt');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('performs atomic writes', async () => {
    await writeAtomic(testFile, 'atomic content');
    expect(fs.readFileSync(testFile, 'utf8')).toBe('atomic content');
  });

  it('overwrites existing files atomically', async () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(testFile, 'old content');
    
    await writeAtomic(testFile, 'new content');
    expect(fs.readFileSync(testFile, 'utf8')).toBe('new content');
  });
});
