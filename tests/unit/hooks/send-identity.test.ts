/**
 * #265 — connector actions classified by effect, and whose voice a send is in.
 *
 * Richard, 2026-11-28: "Communicating in a channel, conversing shouldn't need
 * approval as a send, if done as Zora. That's different than posting as me."
 * So a send through a server marked `acts_as = "zora"` (or Zora's own
 * `zora-tools`) runs without asking, and a send through any other server asks.
 */
import { describe, it, expect } from 'vitest';
import {
  IrreversibilityScorerHook,
  toolToAction,
  classifyByEffect,
  DEFAULT_IRREVERSIBILITY_SCORES,
  DEFAULT_IRREVERSIBILITY_THRESHOLDS,
} from '../../../src/hooks/built-in/irreversibility-scorer.js';

function hook(selfIdentityServers: string[] = []): IrreversibilityScorerHook {
  return new IrreversibilityScorerHook({
    scores: { ...DEFAULT_IRREVERSIBILITY_SCORES },
    thresholds: { ...DEFAULT_IRREVERSIBILITY_THRESHOLDS },
    selfIdentityServers,
  });
}

const run = (h: IrreversibilityScorerHook, tool: string) =>
  h.run({ jobId: 'send-identity-265', tool, arguments: {} });

describe('#265 send identity', () => {
  it('lets Zora talk in Slack as itself without asking', async () => {
    const res = await run(hook(['zora-slack']), 'mcp__zora-slack__slack_send_message');
    expect(toolToAction('mcp__zora-slack__slack_send_message', ['zora-slack'])).toBe('send_as_zora');
    expect(res.allow).toBe(true);
  });

  it('asks before posting through a connector that acts as Richard', async () => {
    // No queue registered, so asking denies, with the approval reason.
    const res = await run(hook(['zora-slack']), 'mcp__rich-slack__slack_send_message');
    expect(res.allow).toBe(false);
    expect(res.reason).toMatch(/^approval_required:80/);
  });

  it('treats a server with no acts_as as acting for the user', async () => {
    const res = await run(hook(), 'mcp__gmail__send_email');
    expect(res.allow).toBe(false);
    expect(res.reason).toMatch(/^approval_required:80/);
  });

  it('never trusts a bare tool name as Zora speaking, since it names no server', () => {
    expect(toolToAction('slack_send_message', ['zora-slack'])).toBe('send_message');
  });

  it('matches server names case-insensitively', () => {
    expect(toolToAction('mcp__Zora-Slack__post_message', ['zora-slack'])).toBe('send_as_zora');
  });

  it('asks before a connector delete', async () => {
    const res = await run(hook(['zora-slack']), 'mcp__zora-slack__delete_message');
    // Speaking as Zora does not cover deleting: identity only exempts sends.
    expect(toolToAction('mcp__zora-slack__delete_message', ['zora-slack'])).toBe('remote_delete');
    expect(res.allow).toBe(false);
    expect(res.reason).toMatch(/^approval_required:85/);
  });
});

describe('#265 classifyByEffect', () => {
  it.each([
    ['slack_send_message', 'send'],
    ['send_email', 'send'],
    ['reply', 'send'],
    ['post_tweet', 'send'],
    ['delete_event', 'delete'],
    ['gmail_trash_thread', 'delete'],
  ] as const)('%s is a %s', (name, effect) => {
    expect(classifyByEffect(name)).toBe(effect);
  });

  it.each([
    'get_message',
    'list_scheduled_posts',
    'read_channel',
    'search_messages',
    'create_draft',
    'remove_label',
    'archive_thread',
    'memory_save',
  ])('%s is neither a send nor a delete', (name) => {
    expect(classifyByEffect(name)).toBeNull();
  });
});
