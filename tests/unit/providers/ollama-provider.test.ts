import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaProvider } from '../../../src/providers/ollama-provider.js';
import type { ProviderConfig, TaskContext, AgentEvent } from '../../../src/types.js';

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    name: 'ollama',
    type: 'ollama',
    rank: 5,
    capabilities: ['creative', 'reasoning', 'fast'],
    cost_tier: 'free',
    enabled: true,
    model: 'llama3.2',
    endpoint: 'http://localhost:11434',
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    jobId: 'test-job',
    task: 'Say hello',
    requiredCapabilities: [],
    complexity: 'simple',
    resourceType: 'reasoning',
    systemPrompt: 'You are a helpful assistant.',
    memoryContext: [],
    history: [],
    ...overrides,
  };
}

describe('OllamaProvider', () => {
  describe('constructor', () => {
    it('initializes from config', () => {
      const provider = new OllamaProvider({ config: makeConfig() });
      expect(provider.name).toBe('ollama');
      expect(provider.rank).toBe(5);
      expect(provider.costTier).toBe('free');
      expect(provider.capabilities).toContain('creative');
    });

    it('uses default endpoint when not specified', () => {
      const config = makeConfig({ endpoint: undefined });
      const provider = new OllamaProvider({ config });
      // We can't directly access the private _endpoint, but the provider should still construct
      expect(provider.name).toBe('ollama');
    });

    it('uses default model when not specified', () => {
      const config = makeConfig({ model: undefined });
      const provider = new OllamaProvider({ config });
      expect(provider.name).toBe('ollama');
    });
  });

  describe('isAvailable', () => {
    it('returns false when disabled', async () => {
      const provider = new OllamaProvider({ config: makeConfig({ enabled: false }) });
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('checkAuth', () => {
    it('returns invalid when server is unreachable', async () => {
      // Use a port that is unlikely to be running Ollama
      const provider = new OllamaProvider({
        config: makeConfig(),
        endpoint: 'http://localhost:19999',
      });
      const status = await provider.checkAuth();
      expect(status.valid).toBe(false);
      expect(status.requiresInteraction).toBe(false);
    });
  });

  describe('getQuotaStatus', () => {
    it('always returns non-exhausted (local model)', async () => {
      const provider = new OllamaProvider({ config: makeConfig() });
      const status = await provider.getQuotaStatus();
      expect(status.isExhausted).toBe(false);
      expect(status.healthScore).toBe(1.0);
    });
  });

  describe('abort', () => {
    it('does not throw for unknown jobId', async () => {
      const provider = new OllamaProvider({ config: makeConfig() });
      await expect(provider.abort('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('execute', () => {
    it('yields error event when server is unreachable', async () => {
      const provider = new OllamaProvider({
        config: makeConfig(),
        endpoint: 'http://localhost:19999',
      });

      const events: AgentEvent[] = [];
      for await (const event of provider.execute(makeTask())) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]!.type).toBe('error');
      expect((events[0]!.content as any).message).toContain('Ollama connection failed');
    });
  });

  describe('resetStatus', () => {
    it('clears cached auth status', async () => {
      const provider = new OllamaProvider({
        config: makeConfig(),
        endpoint: 'http://localhost:19999',
      });
      // First call caches an invalid status
      await provider.checkAuth();
      // Reset should clear it
      provider.resetStatus();
      // After reset, a new check should re-evaluate
      const status = await provider.checkAuth();
      expect(status.valid).toBe(false); // Still unreachable
    });
  });
});
