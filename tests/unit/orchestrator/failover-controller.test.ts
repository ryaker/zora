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

  describe('classifyError', () => {
    it('classifies by HTTP status code with high confidence', () => {
      const err = Object.assign(new Error('Something happened'), { status: 429 });
      const result = controller.classifyError(err);
      expect(result.category).toBe('rate_limit');
      expect(result.confidence).toBe('high');
      expect(result.retryable).toBe(true);
    });

    it('classifies auth errors by HTTP status 401', () => {
      const err = Object.assign(new Error('Forbidden'), { status: 401 });
      const result = controller.classifyError(err);
      expect(result.category).toBe('auth');
      expect(result.confidence).toBe('high');
      expect(result.retryable).toBe(false);
    });

    it('classifies auth errors by HTTP status 403', () => {
      const err = Object.assign(new Error('Forbidden'), { status: 403 });
      const result = controller.classifyError(err);
      expect(result.category).toBe('auth');
      expect(result.confidence).toBe('high');
    });

    it('classifies by structured error code', () => {
      const err = Object.assign(new Error('Error'), { code: 'RESOURCE_EXHAUSTED' });
      const result = controller.classifyError(err);
      expect(result.category).toBe('rate_limit');
      expect(result.confidence).toBe('high');
    });

    it('classifies by message patterns with medium confidence', () => {
      const err = new Error('Rate limit exceeded');
      const result = controller.classifyError(err);
      expect(result.category).toBe('rate_limit');
      expect(result.confidence).toBe('medium');
    });

    it('classifies authentication failed message', () => {
      const err = new Error('Authentication failed: session expired');
      const result = controller.classifyError(err);
      expect(result.category).toBe('auth');
      expect(result.confidence).toBe('medium');
    });

    it('avoids false positives on "limit" substring', () => {
      // "limit" in a non-rate-limit context should not match
      const err = new Error('You have reached the maximum item limit in your library');
      const result = controller.classifyError(err);
      expect(result.category).toBe('unknown');
    });

    it('avoids false positives on "token" substring', () => {
      // "token" in a non-auth context should not match
      const err = new Error('Credential token limited to 100 characters');
      const result = controller.classifyError(err);
      expect(result.category).toBe('unknown');
    });

    it('classifies unknown errors', () => {
      const err = new Error('Something completely unexpected');
      const result = controller.classifyError(err);
      expect(result.category).toBe('unknown');
      expect(result.confidence).toBe('low');
    });

    it('classifies timeout errors', () => {
      const err = new Error('Request timed out');
      const result = controller.classifyError(err);
      expect(result.category).toBe('timeout');
      expect(result.retryable).toBe(true);
    });

    it('classifies Gemini RESOURCE_EXHAUSTED code', () => {
      const err = Object.assign(new Error('Quota exhausted'), { code: 'resource_exhausted' });
      const result = controller.classifyError(err);
      expect(result.category).toBe('rate_limit');
      expect(result.confidence).toBe('high');
    });

    it('classifies OpenAI rate_limit_error code', () => {
      const err = Object.assign(new Error('Rate limited'), { code: 'rate_limit_error' });
      const result = controller.classifyError(err);
      expect(result.category).toBe('rate_limit');
      expect(result.confidence).toBe('high');
    });

    it('classifies server errors as transient', () => {
      const err = Object.assign(new Error('Internal Server Error'), { status: 500 });
      const result = controller.classifyError(err);
      expect(result.category).toBe('transient');
      expect(result.retryable).toBe(true);
    });

    it('extracts HTTP status from error message', () => {
      const err = new Error('Error 429: Too many requests');
      const result = controller.classifyError(err);
      expect(result.category).toBe('rate_limit');
      expect(result.httpStatus).toBe(429);
    });
  });
});
