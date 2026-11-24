/**
 * #216: PolicyEngine.validatePath must judge the CANONICAL path. A symlinked
 * ANCESTOR (allowed/link -> outside) used to pass because only the final path
 * component was checked for being a symlink. Real filesystem, synthetic paths.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PolicyEngine } from '../../src/security/policy-engine.js';
import type { ZoraPolicy } from '../../src/types.js';

let root: string;
let allowed: string;
let outside: string;
let denied: string;

function engine(opts: { follow?: boolean; allowedPaths?: string[]; deniedPaths?: string[] } = {}): PolicyEngine {
  const policy = {
    filesystem: {
      allowed_paths: opts.allowedPaths ?? [allowed],
      denied_paths: opts.deniedPaths ?? [denied],
      resolve_symlinks: true,
      follow_symlinks: opts.follow ?? false,
    },
    shell: { mode: 'deny_all', allowed_commands: [], denied_commands: [], split_chained_commands: true, max_execution_time: '1m' },
    actions: { reversible: [], irreversible: [], always_flag: [] },
    network: { allowed_domains: [], denied_domains: [], max_request_size: '1mb' },
  } as unknown as ZoraPolicy;
  return new PolicyEngine(policy);
}

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zora-symanc-')));
  allowed = path.join(root, 'allowed');
  outside = path.join(root, 'outside');
  denied = path.join(allowed, 'secret');
  fs.mkdirSync(denied, { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'data.txt'), 'x');
  fs.writeFileSync(path.join(denied, 'key.txt'), 'x');
  fs.symlinkSync(outside, path.join(allowed, 'ancestor-link'));
  fs.symlinkSync(denied, path.join(allowed, 'to-secret'));
  fs.symlinkSync(path.join(allowed, 'ancestor-link'), path.join(allowed, 'chain'));
  fs.mkdirSync(path.join(allowed, 'real'));
  fs.symlinkSync(path.join(allowed, 'real'), path.join(allowed, 'inside-link'));
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('#216 symlinked-ancestor handling in validatePath', () => {
  it('denies a file reached through a symlinked ancestor that leaves the allowed root', () => {
    expect(engine().validatePath(path.join(allowed, 'ancestor-link', 'data.txt')).allowed).toBe(false);
  });

  it('denies a NOT-YET-EXISTING write target under a symlinked ancestor', () => {
    expect(engine().validatePath(path.join(allowed, 'ancestor-link', 'new-file.txt')).allowed).toBe(false);
  });

  it('denies a chain of symlinks that ends outside', () => {
    expect(engine().validatePath(path.join(allowed, 'chain', 'data.txt')).allowed).toBe(false);
  });

  it('denies reaching a denied path via a symlinked ancestor', () => {
    expect(engine().validatePath(path.join(allowed, 'to-secret', 'key.txt')).allowed).toBe(false);
  });

  it('still denies the denied path via symlink when follow_symlinks is true', () => {
    expect(engine({ follow: true }).validatePath(path.join(allowed, 'to-secret', 'key.txt')).allowed).toBe(false);
  });

  it('allows a symlinked ancestor that stays inside the allowed root', () => {
    expect(engine().validatePath(path.join(allowed, 'inside-link', 'f.txt')).allowed).toBe(true);
  });

  it('allows ordinary paths and new files in real directories', () => {
    expect(engine().validatePath(path.join(allowed, 'real', 'new.txt')).allowed).toBe(true);
  });

  it('allows an explicitly configured symlinked workspace root', () => {
    const wsLink = path.join(root, 'ws-link');
    fs.symlinkSync(outside, wsLink);
    const e = engine({ allowedPaths: [wsLink] });
    expect(e.validatePath(path.join(wsLink, 'data.txt')).allowed).toBe(true);
    expect(e.validatePath(path.join(outside, 'data.txt')).allowed).toBe(true);
  });

  it('fails closed on an unresolvable ancestor (symlink loop)', () => {
    const a = path.join(allowed, 'loop-a');
    const b = path.join(allowed, 'loop-b');
    fs.symlinkSync(b, a);
    fs.symlinkSync(a, b);
    expect(engine().validatePath(path.join(a, 'x')).allowed).toBe(false);
  });
});
