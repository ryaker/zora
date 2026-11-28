/**
 * #200 — the never list. Credential changes and moving money are refused
 * before scoring, so no approval, blanket window or score override can let
 * them through. Payments ask instead.
 */
import { describe, it, expect } from 'vitest';
import {
  IrreversibilityScorerHook,
  toolToAction,
  classifyByEffect,
  DEFAULT_HUMAN_ONLY_KINDS,
  DEFAULT_IRREVERSIBILITY_SCORES,
  DEFAULT_IRREVERSIBILITY_THRESHOLDS,
} from '../../../src/hooks/built-in/irreversibility-scorer.js';
import { ApprovalQueue, DEFAULT_APPROVAL_CONFIG } from '../../../src/core/approval-queue.js';

function hook(opts: { humanOnly?: string[]; approveEverything?: boolean } = {}): IrreversibilityScorerHook {
  const h = new IrreversibilityScorerHook({
    scores: { ...DEFAULT_IRREVERSIBILITY_SCORES },
    thresholds: { ...DEFAULT_IRREVERSIBILITY_THRESHOLDS },
    ...(opts.humanOnly ? { humanOnly: opts.humanOnly } : {}),
  });
  if (opts.approveEverything) {
    const q = new ApprovalQueue({ ...DEFAULT_APPROVAL_CONFIG, enabled: true, timeoutMs: 5_000 });
    q.setSendHandler(async (message) => {
      const token = /ZORA-[A-Z0-9]{4}/.exec(message)?.[0];
      if (token) setImmediate(() => q.handleReply(token, 'allow'));
    });
    h.setApprovalQueue(q);
  }
  return h;
}

const run = (h: IrreversibilityScorerHook, tool: string, args: Record<string, unknown> = {}) =>
  h.run({ jobId: 'human-only-200', tool, arguments: args });

describe('#200 human-only kinds', () => {
  it('defaults to credential changes and moving money', () => {
    expect(DEFAULT_HUMAN_ONLY_KINDS).toEqual(['credential_change', 'money_movement']);
  });

  it.each([
    ['mcp__vault__rotate_api_key', 'credential_change'],
    ['mcp__google__change_password', 'credential_change'],
    ['mcp__github__delete_ssh_key', 'credential_change'],
    ['mcp__auth__disable_2fa', 'credential_change'],
    ['mcp__bank__transfer_funds', 'money_movement'],
    ['mcp__bank__send_wire', 'money_movement'],
    ['mcp__broker__place_trade', 'money_movement'],
  ])('%s is %s and is refused even when a human would approve', async (tool, kind) => {
    expect(toolToAction(tool)).toBe(kind);
    const res = await run(hook({ approveEverything: true }), tool);
    expect(res.allow).toBe(false);
    expect(res.reason).toMatch(new RegExp(`^human_only:${kind}`));
  });

  it('refuses passwd from the shell', async () => {
    const res = await run(hook({ approveEverything: true }), 'Bash', { command: 'sudo passwd rich' });
    expect(res.reason).toMatch(/^human_only:credential_change/);
  });

  it('does not mistake everyday tools for the never list', () => {
    for (const name of ['transfer_ownership', 'transfer_file', 'get_password_policy', 'list_api_keys', 'update_token_budget', 'order_list']) {
      const effect = classifyByEffect(name);
      expect(effect === 'credential_change' || effect === 'money_movement', name).toBe(false);
    }
  });

  it('asks before a payment rather than refusing it', async () => {
    expect(toolToAction('mcp__shop__checkout')).toBe('payment');
    const res = await run(hook({ approveEverything: true }), 'mcp__shop__checkout');
    expect(res.allow).toBe(true);
    const unapproved = await run(hook(), 'mcp__shop__checkout');
    expect(unapproved.reason).toMatch(/^approval_required:90/);
  });

  it('honours a policy that narrows the list', async () => {
    const res = await run(hook({ humanOnly: ['money_movement'], approveEverything: true }), 'mcp__vault__rotate_api_key');
    // Off the list, an unscored credential change falls to the 50-point
    // default in this bare hook; the orchestrator layers default scores in.
    expect(res.reason ?? '').not.toMatch(/^human_only/);
  });
});
