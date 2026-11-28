/**
 * #233 — approve a job once, not every action.
 *
 * Guards: a grant skips only the questions it names; a targeted grant never
 * covers an unknown target; a session-risk intercept is never covered; the
 * grant ends with the job; `allow-job` adds the asked-about action to the
 * job's grant; blankets now reach the actions that actually ask.
 */
import { describe, it, expect } from 'vitest';
import { ApprovalQueue, DEFAULT_APPROVAL_CONFIG, grantCovers } from '../../../src/core/approval-queue.js';
import { PolicyEngine, gitPushBranch } from '../../../src/security/policy-engine.js';
import {
  IrreversibilityScorerHook,
  DEFAULT_IRREVERSIBILITY_SCORES,
  DEFAULT_IRREVERSIBILITY_THRESHOLDS,
} from '../../../src/hooks/built-in/irreversibility-scorer.js';
import type { ZoraPolicy } from '../../../src/types.js';

function queue(): { q: ApprovalQueue; sent: string[]; answer: (d: 'allow' | 'deny' | 'allow-job' | 'allow-30m') => void } {
  const q = new ApprovalQueue({ ...DEFAULT_APPROVAL_CONFIG, enabled: true, timeoutMs: 5_000 });
  const sent: string[] = [];
  let decision: 'allow' | 'deny' | 'allow-job' | 'allow-30m' = 'deny';
  q.setSendHandler(async (message) => {
    sent.push(message);
    const token = /ZORA-[A-Z0-9]{4}/.exec(message)?.[0];
    if (token) setImmediate(() => q.handleReply(token, decision));
  });
  return { q, sent, answer: (d) => { decision = d; } };
}

describe('#233 grantCovers', () => {
  it('matches a bare action and a targeted one', () => {
    expect(grantCovers(['git_push'], 'git_push', 'main')).toBe(true);
    expect(grantCovers(['git_push:agent/*'], 'git_push', 'agent/233-grants')).toBe(true);
    expect(grantCovers(['git_push:agent/*'], 'git_push', 'main')).toBe(false);
    expect(grantCovers(['git_push:agent/*'], 'git_push', 'agent/a/b')).toBe(false);
    expect(grantCovers(['git_push:agent/**'], 'git_push', 'agent/a/b')).toBe(true);
  });

  it('never covers an unknown target with a targeted grant, or another action', () => {
    expect(grantCovers(['git_push:agent/*'], 'git_push', undefined)).toBe(false);
    expect(grantCovers(['git_push'], 'send_message')).toBe(false);
  });

  it('treats regex characters in a glob literally', () => {
    expect(grantCovers(['git_push:fix.1'], 'git_push', 'fixx1')).toBe(false);
    expect(grantCovers(['git_push:fix?'], 'git_push', 'fixx')).toBe(false);
  });
});

describe('#233 gitPushBranch', () => {
  it.each([
    ['git push origin agent/x', 'agent/x'],
    ['git push -u origin agent/x', 'agent/x'],
    ['git push origin HEAD:refs/heads/agent/x', 'agent/x'],
    ['git push --force origin +agent/x', 'agent/x'],
  ])('%s → %s', (cmd, branch) => {
    expect(gitPushBranch(cmd)).toBe(branch);
  });

  it.each(['git push', 'git push origin', 'git push origin agent/x && git push origin main', 'git push origin $(echo main)'])(
    'cannot tell for %s',
    (cmd) => expect(gitPushBranch(cmd)).toBeUndefined(),
  );
});

describe('#233 ApprovalQueue job grants', () => {
  it('skips the question for a granted action, and asks for anything else', async () => {
    const { q, sent } = queue();
    q.grantJob('job-1', ['git_push:agent/*']);
    expect(await q.request({ action: 'git_push', score: 85, jobId: 'job-1', tool: 'Bash', target: 'agent/x' })).toBe(true);
    expect(sent).toEqual([]);
    expect(await q.request({ action: 'git_push', score: 85, jobId: 'job-1', tool: 'Bash', target: 'main' })).toBe(false);
    expect(sent.length).toBe(1);
  });

  it('is scoped to its job and ends with it', async () => {
    const { q, sent } = queue();
    q.grantJob('job-1', ['send_message']);
    expect(await q.request({ action: 'send_message', score: 80, jobId: 'job-2', tool: 't' })).toBe(false);
    q.revokeJob('job-1');
    expect(await q.request({ action: 'send_message', score: 80, jobId: 'job-1', tool: 't' })).toBe(false);
    expect(sent.length).toBe(2);
  });

  it('never covers a session-risk intercept', async () => {
    const { q, sent } = queue();
    q.grantJob('job-1', ['send_message']);
    await q.request({ action: 'send_message', score: 75, jobId: 'job-1', tool: 't', bypassBlanketAllow: true });
    expect(sent.length).toBe(1);
  });

  it('allow-job approves and stops asking for that action in that job', async () => {
    const { q, sent, answer } = queue();
    answer('allow-job');
    expect(await q.request({ action: 'file_delete', score: 85, jobId: 'job-1', tool: 'rm' })).toBe(true);
    expect(q.getJobGrant('job-1')).toEqual(['file_delete']);
    expect(await q.request({ action: 'file_delete', score: 85, jobId: 'job-1', tool: 'rm' })).toBe(true);
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain('allow-job');
    expect(q.parseApprovalCommand('approve ZORA-ABCD allow-job')).toEqual({ token: 'ZORA-ABCD', decision: 'allow-job' });
  });

  it('allow-30m now covers actions that actually ask, up to auto-deny', async () => {
    const { q, sent, answer } = queue();
    answer('allow-30m');
    await q.request({ action: 'git_push', score: 85, jobId: 'job-1', tool: 'Bash' });
    expect(await q.request({ action: 'send_message', score: 80, jobId: 'job-9', tool: 't' })).toBe(true);
    expect(sent.length).toBe(1);
  });
});

describe('#233 grants inside the enforcement chain', () => {
  const policy: ZoraPolicy = {
    filesystem: { allowed_paths: ['/tmp'], denied_paths: [], resolve_symlinks: false, follow_symlinks: false },
    shell: { mode: 'allowlist', allowed_commands: ['git'], denied_commands: [], split_chained_commands: true, max_execution_time: '30s' },
    actions: { reversible: [], irreversible: [], always_flag: ['git_push'] },
    network: { allowed_domains: [], denied_domains: [], max_request_size: '10MB' },
  };
  const signal = new AbortController().signal;

  it('PolicyEngine always_flag honours a grant keyed by the trusted job id, not tool input', async () => {
    const { q, sent } = queue();
    q.grantJob('job-1', ['git_push:agent/*']);
    const engine = new PolicyEngine(policy);
    engine.setApprovalQueue(q);

    const granted = await engine.createCanUseTool({ jobId: 'job-1' })('Bash', { command: 'git push origin agent/x' }, { signal });
    expect(granted.behavior).toBe('allow');
    expect(sent).toEqual([]);

    // A model that puts a granted job id in its own input gains nothing.
    const spoofed = await engine.createCanUseTool()('Bash', { command: 'git push origin agent/x', __jobId: 'job-1' }, { signal });
    expect(spoofed.behavior).toBe('deny');
    expect(sent.length).toBe(1);
  });

  it('a grant cannot lift a human-only refusal or an auto-deny', async () => {
    const { q } = queue();
    q.grantJob('job-1', ['credential_change', 'file_delete']);
    const hook = new IrreversibilityScorerHook({
      scores: { ...DEFAULT_IRREVERSIBILITY_SCORES, file_delete: 95 },
      thresholds: { ...DEFAULT_IRREVERSIBILITY_THRESHOLDS },
    });
    hook.setApprovalQueue(q);
    const cred = await hook.run({ jobId: 'job-1', tool: 'mcp__vault__rotate_api_key', arguments: {} });
    expect(cred.reason).toMatch(/^human_only:/);
    const del = await hook.run({ jobId: 'job-1', tool: 'delete_file', arguments: {} });
    expect(del.reason).toMatch(/^auto_denied:95/);
  });
});
