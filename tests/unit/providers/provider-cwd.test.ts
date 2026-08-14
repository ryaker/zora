/**
 * PROV-10 — providers work in the configured workspace.
 *
 * `ClaudeProvider` fell back to `process.cwd()` and neither factory passed a
 * `cwd`, so the agent's filesystem tools operated relative to wherever the
 * daemon happened to be started rather than `agent.workspace`. Both
 * `ExecutionLoop` call sites resolved it correctly; the provider path did not.
 */

import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { ClaudeProvider } from '../../../src/providers/claude-provider.js';
import type { SDKMessage, SDKQuery } from '../../../src/providers/claude-provider.js';
import { expandHome } from '../../../src/utils/fs.js';
import type { TaskContext, AgentEvent, ProviderConfig } from '../../../src/types.js';

const config: ProviderConfig = {
  name: 'claude-test',
  type: 'claude-sdk',
  rank: 1,
  capabilities: ['reasoning'],
  cost_tier: 'metered',
  enabled: true,
};

function makeTask(): TaskContext {
  return {
    jobId: 'job-cwd-1',
    task: 'read a file',
    requiredCapabilities: ['reasoning'],
    complexity: 'simple',
    resourceType: 'coding',
    systemPrompt: 'system',
    memoryContext: [],
    history: [],
  };
}

async function sdkOptionsFor(cwd?: string): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> | undefined;
  const provider = new ClaudeProvider({
    config,
    ...(cwd !== undefined ? { cwd } : {}),
    queryFn: (params) => {
      captured = params.options;
      return (async function* (): AsyncGenerator<SDKMessage, void> {})() as SDKQuery;
    },
  });
  for await (const _ of provider.execute(makeTask()) as AsyncGenerator<AgentEvent>) { /* drain */ }
  return captured!;
}

describe('expandHome (PROV-10)', () => {
  it('expands a leading ~ to the home directory', () => {
    expect(expandHome('~/work')).toBe(path.join(os.homedir(), 'work'));
    expect(expandHome('~')).toBe(path.resolve(os.homedir()));
  });

  it('leaves absolute paths alone', () => {
    expect(expandHome('/srv/zora')).toBe('/srv/zora');
  });

  it('only expands a leading ~, not one in the middle of a path', () => {
    expect(expandHome('/srv/~backup')).toBe('/srv/~backup');
  });

  it('resolves relative paths to absolute', () => {
    expect(path.isAbsolute(expandHome('./workspace'))).toBe(true);
  });

  it('falls back when the configured workspace is missing or blank', () => {
    expect(expandHome(undefined, '/fallback')).toBe('/fallback');
    expect(expandHome('', '/fallback')).toBe('/fallback');
    expect(expandHome('   ', '/fallback')).toBe('/fallback');
    expect(expandHome(undefined)).toBe(process.cwd());
  });
});

describe('ClaudeProvider cwd (PROV-10)', () => {
  it('passes the configured workspace to the SDK', async () => {
    const options = await sdkOptionsFor('/srv/zora-workspace');
    expect(options['cwd']).toBe('/srv/zora-workspace');
  });

  it('still falls back to process.cwd() when no workspace is configured', async () => {
    const options = await sdkOptionsFor();
    expect(options['cwd']).toBe(process.cwd());
  });

  it('an expanded ~ workspace reaches the SDK as an absolute path', async () => {
    const options = await sdkOptionsFor(expandHome('~/zora-work'));
    expect(options['cwd']).toBe(path.join(os.homedir(), 'zora-work'));
  });
});
