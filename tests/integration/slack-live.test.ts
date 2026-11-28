import { describe, it, expect } from 'vitest';
import { WebClient } from '@slack/web-api';
import { SlackAdapter } from '../../src/channels/slack/slack-adapter.js';

// Real Slack round trip; needs provisioned tokens, so it is opt-in.
const live = process.env['SLACK_LIVE'] === '1' &&
  process.env['SLACK_BOT_TOKEN'] && process.env['SLACK_APP_TOKEN'] && process.env['SLACK_TEST_CHANNEL'];

describe.skipIf(!live)('Slack live', () => {
  it('connects over Socket Mode and posts to the test channel', async () => {
    const adapter = new SlackAdapter(process.env['SLACK_BOT_TOKEN']!, process.env['SLACK_APP_TOKEN']!);
    await adapter.start();
    try {
      await adapter.send({ type: 'slack', phoneNumber: '', isLinkedDevice: false },
        process.env['SLACK_TEST_CHANNEL']!, 'Zora Slack adapter smoke test');
      const hist = await new WebClient(process.env['SLACK_BOT_TOKEN']).conversations.history({
        channel: process.env['SLACK_TEST_CHANNEL']!, limit: 1 });
      expect(hist.messages?.[0]?.text).toContain('smoke test');
    } finally {
      await adapter.stop();
    }
  }, 30000);
});
