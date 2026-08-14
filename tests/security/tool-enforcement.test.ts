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

import { describe, it, expect, vi } from 'vitest';
import { ClaudeProvider } from '../../src/providers/claude-provider.js';
import type { SDKMessage, SDKQuery } from '../../src/providers/claude-provider.js';
import { PolicyEngine } from '../../src/security/policy-engine.js';
import { ToolHookRunner, type ToolHook } from '../../src/hooks/tool-hook-runner.js';
import { buildSdkHooks, toolHookRunnerToPreToolUse } from '../../src/hooks/sdk-hook-bridge.js';
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

// ─── SEC-21: hook denials actually block ─────────────────────────────

/** A hook that refuses one specific command, standing in for ShellSafetyHook. */
const denyRmHook: ToolHook = {
  name: 'test-deny-rm',
  phase: 'before',
  async run(ctx) {
    const command = String(ctx.arguments['command'] ?? '');
    if (command.includes('rm ')) {
      return { allow: false, reason: 'rm is not permitted' };
    }
    return { allow: true };
  },
};

/** A hook that rewrites arguments rather than blocking, standing in for SecretRedactHook. */
const redactHook: ToolHook = {
  name: 'test-redact',
  phase: 'before',
  async run(ctx) {
    if (typeof ctx.arguments['token'] === 'string') {
      return { allow: true, modifiedArgs: { token: '[REDACTED]' } };
    }
    return { allow: true };
  },
};

describe('SEC-21 — a PreToolUse hook denial prevents execution', () => {
  it('returns a deny permission decision the SDK honours before running the tool', async () => {
    const runner = new ToolHookRunner();
    runner.register(denyRmHook);

    const preToolUse = toolHookRunnerToPreToolUse(runner, () => 'job-1');
    const decision = await preToolUse(
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } },
      undefined,
      { signal: new AbortController().signal },
    );

    // 'deny' is the SDK's short-circuit: the tool is not invoked at all.
    expect(decision.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(decision.hookSpecificOutput?.permissionDecisionReason).toContain('rm is not permitted');
  });

  it('lets a permitted call through without a decision that would block it', async () => {
    const runner = new ToolHookRunner();
    runner.register(denyRmHook);

    const preToolUse = toolHookRunnerToPreToolUse(runner, () => 'job-1');
    const decision = await preToolUse(
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls -la' } },
      undefined,
      { signal: new AbortController().signal },
    );

    expect(decision.hookSpecificOutput?.permissionDecision).not.toBe('deny');
  });

  it('propagates hook argument rewrites to what the tool actually receives', async () => {
    const runner = new ToolHookRunner();
    runner.register(redactHook);

    const preToolUse = toolHookRunnerToPreToolUse(runner, () => 'job-1');
    const decision = await preToolUse(
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { token: 'sk-secret', command: 'ls' } },
      undefined,
      { signal: new AbortController().signal },
    );

    const updated = decision.hookSpecificOutput?.updatedInput as Record<string, unknown> | undefined;
    expect(updated?.['token']).toBe('[REDACTED]');
    expect(updated?.['command']).toBe('ls');
  });

  it('fails closed: a hook that throws denies rather than silently allowing', async () => {
    const runner = new ToolHookRunner();
    runner.register({
      name: 'exploding-hook',
      phase: 'before',
      async run() { throw new Error('hook blew up'); },
    });

    const preToolUse = toolHookRunnerToPreToolUse(runner, () => 'job-1');
    const decision = await preToolUse(
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } },
      undefined,
      { signal: new AbortController().signal },
    );

    expect(decision.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('runs after-hooks on PostToolUse so audit and leak detection still fire', async () => {
    const seen: Array<{ tool: string; result: unknown }> = [];
    const runner = new ToolHookRunner();
    runner.register({
      name: 'test-audit',
      phase: 'after',
      async run(ctx) {
        seen.push({ tool: ctx.tool, result: ctx.result });
        return { allow: true };
      },
    });

    const hooks = buildSdkHooks(runner, () => 'job-1');
    const postToolUse = hooks.PostToolUse![0]!.hooks[0]!;
    await postToolUse(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
        tool_response: { stdout: 'a b c' },
      },
      undefined,
      { signal: new AbortController().signal },
    );

    expect(seen).toEqual([{ tool: 'Bash', result: { stdout: 'a b c' } }]);
  });
});

// ─── The two layers together, on the provider path ───────────────────

describe('the enforcement chain reaches the SDK', () => {
  it('wires PreToolUse and PostToolUse into the options the SDK receives', async () => {
    const runner = new ToolHookRunner();
    runner.register(denyRmHook);

    const options = await captureSdkOptions(makeTask(), {
      hooks: buildSdkHooks(runner, () => 'job-enforcement-1'),
    });

    const hooks = options['hooks'] as Record<string, Array<{ hooks: unknown[] }>>;
    expect(hooks?.['PreToolUse']?.[0]?.hooks).toHaveLength(1);
    expect(hooks?.['PostToolUse']?.[0]?.hooks).toHaveLength(1);
  });

  it('denies at the hook layer even when canUseTool would have allowed', async () => {
    // Defense in depth: PreToolUse runs ahead of canUseTool, so a hook denial
    // stands on its own. A permissive policy must not resurrect a blocked call.
    const permissive: ZoraPolicy = {
      ...policy,
      shell: { ...policy.shell, mode: 'denylist', allowed_commands: [], denied_commands: [] },
    };
    const engine = new PolicyEngine(permissive);
    const runner = new ToolHookRunner();
    runner.register(denyRmHook);

    const canUseTool = engine.createCanUseTool();
    const preToolUse = toolHookRunnerToPreToolUse(runner, () => 'job-1');

    const hookDecision = await preToolUse(
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } },
      undefined,
      { signal: new AbortController().signal },
    );

    expect(hookDecision.hookSpecificOutput?.permissionDecision).toBe('deny');
    // ...and it does not matter what the (deliberately permissive) policy says,
    // because the SDK never reaches canUseTool after a PreToolUse deny.
    void canUseTool;
  });

  it('calls the hook once per tool call, with the tool name and arguments intact', async () => {
    const runner = new ToolHookRunner();
    const spy = vi.fn(async () => ({ allow: true }));
    runner.register({ name: 'spy', phase: 'before', run: spy });

    const preToolUse = toolHookRunnerToPreToolUse(runner, () => 'job-42');
    await preToolUse(
      { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '/tmp/x', content: 'y' } },
      undefined,
      { signal: new AbortController().signal },
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({
      jobId: 'job-42',
      tool: 'Write',
      arguments: { file_path: '/tmp/x', content: 'y' },
    });
  });
});
