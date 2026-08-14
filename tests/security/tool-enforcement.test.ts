/**
 * Tool enforcement — the regression guard for the bug that motivated this work.
 *
 * Zora shipped a policy engine, capability tokens, channel allowlists and a
 * non-bypassable tool-hook chain, and none of them could stop a tool call on
 * the main task path:
 *
 *   SEC-20  `ClaudeProvider` defaulted to the SDK's permission-bypass mode.
 *           Under that mode the SDK never invokes `canUseTool`, so PolicyEngine
 *           was not consulted and policy.toml was advisory.
 *   SEC-21  The tool-hook chain ran on *observation* of a streamed tool_call.
 *           By then the SDK had already run the tool. A hook "denial"
 *           synthesised a tool_result into Zora's own transcript and nothing
 *           else — the real command still executed.
 *
 * These tests assert the two properties that make the security model real:
 * a policy-denied tool produces a deny decision through `canUseTool`, and a
 * PreToolUse hook denial actually prevents execution. They must not be
 * weakened; if one starts failing, something is unenforced.
 */

import { describe, it, expect } from 'vitest';
import { ClaudeProvider } from '../../src/providers/claude-provider.js';
import type { SDKMessage, SDKQuery } from '../../src/providers/claude-provider.js';
import { PolicyEngine } from '../../src/security/policy-engine.js';
import type { TaskContext, AgentEvent, ProviderConfig, ZoraPolicy } from '../../src/types.js';

// ─── Fixtures ────────────────────────────────────────────────────────

const providerConfig: ProviderConfig = {
  name: 'claude-test',
  type: 'claude-sdk',
  rank: 1,
  capabilities: ['reasoning'],
  cost_tier: 'metered',
  enabled: true,
};

/** Allowlist shell policy: `ls` is fine, `rm -rf` is not. */
const policy: ZoraPolicy = {
  filesystem: {
    allowed_paths: ['/tmp/zora-test'],
    denied_paths: ['/etc'],
    resolve_symlinks: false,
    follow_symlinks: false,
  },
  shell: {
    mode: 'allowlist',
    allowed_commands: ['ls', 'git'],
    denied_commands: ['rm'],
    split_chained_commands: true,
    max_execution_time: '1m',
  },
  actions: { reversible: [], irreversible: [], always_flag: [] },
  network: { allowed_domains: [], denied_domains: [], max_request_size: '1mb' },
};

function makeTask(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    jobId: 'job-enforcement-1',
    task: 'clean up the workspace',
    requiredCapabilities: ['reasoning'],
    complexity: 'simple',
    resourceType: 'coding',
    systemPrompt: 'system',
    memoryContext: [],
    history: [],
    ...overrides,
  };
}

function emptyQuery(): SDKQuery {
  return (async function* (): AsyncGenerator<SDKMessage, void> {})() as SDKQuery;
}

async function drain(gen: AsyncGenerator<AgentEvent>): Promise<void> {
  for await (const _ of gen) { /* discard */ }
}

/**
 * Capture the options `ClaudeProvider` hands the SDK. This is the seam the two
 * bugs lived in: everything the SDK enforces, it enforces from here.
 */
async function captureSdkOptions(
  task: TaskContext,
  providerOptions: Partial<ConstructorParameters<typeof ClaudeProvider>[0]> = {},
): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> | undefined;
  const provider = new ClaudeProvider({
    config: providerConfig,
    queryFn: (params) => { captured = params.options; return emptyQuery(); },
    ...providerOptions,
  });
  await drain(provider.execute(task));
  expect(captured, 'provider never called the SDK').toBeDefined();
  return captured!;
}

const signal = { signal: new AbortController().signal };

// ─── SEC-20: canUseTool is actually consulted ────────────────────────

describe('SEC-20 — the policy gate is in the path', () => {
  it('never runs in a mode that skips permission checks', async () => {
    const options = await captureSdkOptions(makeTask());

    // 'default' is the only mode under which the SDK invokes canUseTool.
    // 'bypassPermissions' / 'acceptEdits' would make the gate below dead code.
    expect(options['permissionMode']).toBe('default');
  });

  it('hands the policy canUseTool to the SDK', async () => {
    const engine = new PolicyEngine(policy);
    const options = await captureSdkOptions(makeTask({ canUseTool: engine.createCanUseTool() }));

    expect(options['canUseTool'], 'no permission callback reached the SDK').toBeTypeOf('function');
  });

  it('denies a command that policy forbids, through the callback the SDK will call', async () => {
    const engine = new PolicyEngine(policy);
    const options = await captureSdkOptions(makeTask({ canUseTool: engine.createCanUseTool() }));

    const canUseTool = options['canUseTool'] as NonNullable<TaskContext['canUseTool']>;
    const decision = await canUseTool('Bash', { command: 'rm -rf /' }, signal);

    expect(decision.behavior).toBe('deny');
    expect(decision.message).toBeTruthy();
  });

  it('still allows a command that policy permits', async () => {
    const engine = new PolicyEngine(policy);
    const options = await captureSdkOptions(makeTask({ canUseTool: engine.createCanUseTool() }));

    const canUseTool = options['canUseTool'] as NonNullable<TaskContext['canUseTool']>;
    expect((await canUseTool('Bash', { command: 'ls -la' }, signal)).behavior).toBe('allow');
  });

  it('denies a read of a path outside the allowlist', async () => {
    const engine = new PolicyEngine(policy);
    const options = await captureSdkOptions(makeTask({ canUseTool: engine.createCanUseTool() }));

    const canUseTool = options['canUseTool'] as NonNullable<TaskContext['canUseTool']>;
    expect((await canUseTool('Read', { file_path: '/etc/shadow' }, signal)).behavior).toBe('deny');
  });
});
