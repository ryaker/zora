import { describe, it, expect, vi } from 'vitest';
import { ApprovalQueue, DEFAULT_APPROVAL_CONFIG } from '../../../src/core/approval-queue.js';

// #218: a request nobody can answer must deny at once, not after the timeout.
const REQ = { action: 'rm', score: 95, jobId: 'j1', tool: 'bash' };

function queue(timeoutMs = 60_000) {
  return new ApprovalQueue({ ...DEFAULT_APPROVAL_CONFIG, enabled: true, timeoutMs });
}

describe('ApprovalQueue unreachable approver (#218)', () => {
  it('denies immediately when the send handler reaches zero approvers', async () => {
    const q = queue();
    q.setSendHandler(async () => 0);
    await expect(q.request(REQ)).resolves.toBe(false);
    expect(q.getPendingCount()).toBe(0);
  });

  it('denies immediately when the send handler rejects', async () => {
    const q = queue();
    q.setSendHandler(async () => { throw new Error('offline'); });
    await expect(q.request(REQ)).resolves.toBe(false);
    expect(q.getPendingCount()).toBe(0);
  });

  it('keeps waiting (and approves on reply) when an approver was reached', async () => {
    const q = queue();
    let msg = '';
    q.setSendHandler(async (m) => { msg = m; return 1; });
    const p = q.request(REQ);
    await vi.waitFor(() => expect(msg).not.toBe(''));
    expect(q.getPendingCount()).toBe(1);
    q.handleReply(/ZORA-[A-Z0-9]{4}/.exec(msg)![0], 'allow');
    await expect(p).resolves.toBe(true);
  });

  it('a void-returning handler is treated as delivered (legacy handlers)', async () => {
    const q = queue();
    q.setSendHandler(async () => {});
    const p = q.request(REQ);
    await new Promise((r) => setTimeout(r, 10));
    expect(q.getPendingCount()).toBe(1);
    q.clearSendHandler();
    await expect(p).resolves.toBe(false);
  });

  it('clearSendHandler denies every pending request and later requests', async () => {
    const q = queue();
    q.setSendHandler(async () => 1);
    const a = q.request(REQ);
    const b = q.request({ ...REQ, jobId: 'j2' });
    await new Promise((r) => setTimeout(r, 10));
    expect(q.getPendingCount()).toBe(2);
    q.clearSendHandler();
    await expect(Promise.all([a, b])).resolves.toEqual([false, false]);
    expect(q.getPendingCount()).toBe(0);
    await expect(q.request(REQ)).resolves.toBe(false);
  });

  it('does not change blanket-grant semantics', async () => {
    const q = queue();
    q.setSendHandler(async () => 0);
    q.setSessionBlanketAllow(99);
    await expect(q.request(REQ)).resolves.toBe(true);
    await expect(q.request({ ...REQ, bypassBlanketAllow: true })).resolves.toBe(false);
  });
});
