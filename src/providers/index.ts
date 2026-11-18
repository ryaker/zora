/**
 * Providers module barrel exports.
 *
 * Re-exports all provider implementations: Claude, Gemini, Ollama, and OpenAI.
 * Also OpenAI (text-only, API-key auth).
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

export {
  EchoProvider,
  type EchoProviderOptions,
} from './echo-provider.js';

export {
  OpenAIProvider,
  OPENAI_DEFAULT_MODEL,
  OPENAI_DEFAULT_ENDPOINT,
  type OpenAIProviderOptions,
} from './openai-provider.js';
