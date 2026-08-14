/**
 * SDK-04 — model defaults and the effort dial.
 *
 * The provider defaulted to `claude-sonnet-4-6` and the generated config wrote
 * the same string, two generations behind the current family. Separately,
 * nothing in the codebase set `effort` — the main intelligence/latency/cost
 * dial was unexposed, so a heartbeat and a refactor ran at the same depth.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ClaudeProvider, DEFAULT_CLAUDE_MODEL } from '../../../src/providers/claude-provider.js';
import type { SDKMessage, SDKQuery } from '../../../src/providers/claude-provider.js';
import type { TaskContext, AgentEvent, ProviderConfig } from '../../../src/types.js';

const baseConfig: ProviderConfig = {
  name: 'claude-test',
  type: 'claude-sdk',
  rank: 1,
  capabilities: ['reasoning'],
  cost_tier: 'metered',
  enabled: true,
};

function makeTask(): TaskContext {
  return {
    jobId: 'job-model-1',
    task: 'think hard',
    requiredCapabilities: ['reasoning'],
    complexity: 'complex',
    resourceType: 'coding',
    systemPrompt: 'system',
    memoryContext: [],
    history: [],
  };
}

async function sdkOptionsFor(config: ProviderConfig): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> | undefined;
  const provider = new ClaudeProvider({
    config,
    queryFn: (params) => {
      captured = params.options;
      return (async function* (): AsyncGenerator<SDKMessage, void> {})() as SDKQuery;
    },
  });
  for await (const _ of provider.execute(makeTask()) as AsyncGenerator<AgentEvent>) { /* drain */ }
  return captured!;
}

describe('Claude model default (SDK-04)', () => {
  it('defaults to the current Opus generation', async () => {
    expect(DEFAULT_CLAUDE_MODEL).toBe('claude-opus-5');
    expect((await sdkOptionsFor(baseConfig))['model']).toBe('claude-opus-5');
  });

  it('does not fall back to a previous-generation model', async () => {
    expect((await sdkOptionsFor(baseConfig))['model']).not.toBe('claude-sonnet-4-6');
  });

  it('lets config.model override the default', async () => {
    const options = await sdkOptionsFor({ ...baseConfig, model: 'claude-sonnet-5' });
    expect(options['model']).toBe('claude-sonnet-5');
  });

  it('generates a config that matches the runtime default', () => {
    // These drifted before: a fresh install got one model if `model` was written
    // into config.toml and a different one if it was omitted.
    const initCommand = fs.readFileSync(
      path.join(process.cwd(), 'src/cli/init-command.ts'),
      'utf8',
    );
    expect(initCommand).toContain(`model = "${DEFAULT_CLAUDE_MODEL}"`);
    expect(initCommand).not.toContain('model = "claude-sonnet-4-6"');
  });
});

describe('effort passthrough (SDK-04)', () => {
  it('forwards a configured effort level to the SDK', async () => {
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
      const options = await sdkOptionsFor({ ...baseConfig, effort });
      // The SDK takes effort as a top-level option and maps it to the API's
      // `output_config.effort` itself.
      expect(options['effort']).toBe(effort);
    }
  });

  it('leaves effort unset when not configured, so the SDK default applies', async () => {
    expect(await sdkOptionsFor(baseConfig)).not.toHaveProperty('effort');
  });
});
