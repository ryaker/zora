import { describe, it, expect, beforeEach } from 'vitest';
import { FailoverController } from '../../../src/orchestrator/failover-controller.js';
import { Router } from '../../../src/orchestrator/router.js';
import { MockProvider } from '../../fixtures/mock-provider.js';
import type { TaskContext, FailoverConfig } from '../../../src/types.js';

describe('FailoverController', () => {
  let p1: MockProvider;
  let p2: MockProvider;
  let router: Router;
  let controller: FailoverController;
  const config: FailoverConfig = {
    enabled: true,
    auto_handoff: true,
    max_handoff_context_tokens: 50000,
    retry_after_cooldown: true,
    max_retries: 3,
    checkpoint_on_auth_failure: true,
    notify_on_failover: true,
  };

  beforeEach(() => {
    p1 = new MockProvider({ name: 'claude', rank: 1, capabilities: ['reasoning'] });
    p2 = new MockProvider({ name: 'gemini', rank: 2, capabilities: ['reasoning'] });
    router = new Router({ providers: [p1, p2] });
    controller = new FailoverController([p1, p2], router, config);
  });

  const task: TaskContext = {
    jobId: 'j1',
    task: 'do thing',
    requiredCapabilities: ['reasoning'],
    complexity: 'simple',
    resourceType: 'reasoning',
    systemPrompt: '',
    memoryContext: [],
    history: [
      { type: 'thinking', timestamp: new Date(), content: { text: 'Thinking...' } },
      { type: 'tool_call', timestamp: new Date(), content: { tool: 'ls', arguments: {}, toolCallId: 'c1' } },
      { type: 'tool_result', timestamp: new Date(), content: { toolCallId: 'c1', result: { success: true, content: 'file.txt' } } },
    ],
  };

  it('triggers failover on quota error (429)', async () => {
    const error = new Error('Rate limit exceeded (429)');
    const result = await controller.handleFailure(task, p1, error);

    expect(result).not.toBeNull();
    expect(result!.nextProvider.name).toBe('gemini');
    expect(result!.handoffBundle.fromProvider).toBe('claude');
    expect(result!.handoffBundle.toolHistory).toHaveLength(1);
    expect(result!.handoffBundle.toolHistory[0]!.result!.output).toBe('file.txt');
  });

  it('triggers failover on auth error', async () => {
    const error = new Error('Authentication failed: session expired');
    const result = await controller.handleFailure(task, p1, error);

    expect(result).not.toBeNull();
    expect(result!.nextProvider.name).toBe('gemini');
    expect(result!.handoffBundle.context.summary).toContain('auth failure');
  });

  it('returns null on general errors', async () => {
    const error = new Error('Network timeout');
    const result = await controller.handleFailure(task, p1, error);

    expect(result).toBeNull();
  });

  it('returns null if no other provider is capable', async () => {
    // p2 doesn't have 'coding'
    const codingTask = { ...task, resourceType: 'coding' as any };
    const error = new Error('429');
    const result = await controller.handleFailure(codingTask, p1, error);

    expect(result).toBeNull();
  });

  it('respects disabled failover config', async () => {
    const disabledController = new FailoverController([p1, p2], router, { ...config, enabled: false });
    const error = new Error('429');
    const result = await disabledController.handleFailure(task, p1, error);

    expect(result).toBeNull();
  });
});
