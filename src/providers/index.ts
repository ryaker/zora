/**
 * Providers module barrel exports.
 *
 * Re-exports the ClaudeProvider and its supporting types.
 * Future providers (Gemini, OpenAI, Ollama) will be added here.
 */

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
