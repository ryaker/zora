import { describe, it, expect, vi } from 'vitest';
import {
  ClaudeProvider,
  extractSettingsNotice,
  SETTINGS_NOTICE_MAX_CHARS,
} from '../../../src/providers/claude-provider.js';
import type { SDKMessage, SDKQuery, ProviderConfig } from '../../../src/providers/claude-provider.js';

const config = {
  name: 'claude', type: 'claude-sdk', rank: 1, capabilities: ['reasoning'],
  cost_tier: 'premium', enabled: true,
} as unknown as ProviderConfig;

const notice = { type: 'system', subtype: 'informational', tag: 'settings_not_in_effect', content: 'hooks skipped' };

function q(messages: unknown[]): SDKQuery {
  return {
    async *[Symbol.asyncIterator]() { for (const m of messages) yield m as SDKMessage; },
    interrupt: async () => {},
  } as unknown as SDKQuery;
}

const task = {
  jobId: 'j', task: 't', requiredCapabilities: ['reasoning'], complexity: 'simple',
  resourceType: 'coding', systemPrompt: '', memoryContext: [], history: [],
} as never;

describe('settings_not_in_effect notice (#219)', () => {
  it('extracts only the exact tagged informational message', () => {
    expect(extractSettingsNotice(notice)?.content).toBe('hooks skipped');
    expect(extractSettingsNotice({ ...notice, tag: 'other' })).toBeNull();
    expect(extractSettingsNotice({ ...notice, subtype: 'init' })).toBeNull();
    expect(extractSettingsNotice({ ...notice, type: 'assistant' })).toBeNull();
    expect(extractSettingsNotice(null)).toBeNull();
  });

  it('caps the carried text and tolerates non-string content', () => {
    expect(extractSettingsNotice({ ...notice, content: 'x'.repeat(5000) })!.content)
      .toHaveLength(SETTINGS_NOTICE_MAX_CHARS);
    expect(extractSettingsNotice({ ...notice, content: 42 })!.content).toBe('');
  });

  it('invokes the handler during execute and a throwing handler does not break the task', async () => {
    const handler = vi.fn(() => { throw new Error('audit down'); });
    const provider = new ClaudeProvider({ config, queryFn: () => q([notice]) });
    provider.setSystemNoticeHandler(handler);
    const events: unknown[] = [];
    for await (const e of provider.execute(task)) events.push(e);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(events.length).toBeGreaterThan(0);
  });

  it('does nothing without a handler', async () => {
    const provider = new ClaudeProvider({ config, queryFn: () => q([notice]) });
    for await (const _ of provider.execute(task)) { /* drain */ }
  });
});
