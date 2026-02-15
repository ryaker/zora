/**
 * Providers module barrel exports.
 *
 * Re-exports all provider implementations: Claude, Gemini, and Ollama.
 * Future providers (OpenAI, custom) will be added here.
 */

export {
  CircuitBreaker,
  type CircuitBreakerOptions,
  type CircuitState,
} from './circuit-breaker.js';

export {
  ClaudeProvider,
  type ClaudeProviderOptions,
  type QueryFn,
  type SDKQuery,
  type SDKMessage,
  type SDKAssistantMessage,
  type SDKResultMessage,
  type SDKSystemMessage,
  type SDKUserMessage,
} from './claude-provider.js';

export {
  GeminiProvider,
  type GeminiProviderOptions,
} from './gemini-provider.js';

export {
  OllamaProvider,
  type OllamaProviderOptions,
} from './ollama-provider.js';
