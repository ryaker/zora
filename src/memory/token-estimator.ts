/**
 * TokenEstimator — Fast, dependency-free token count estimation.
 *
 * Uses character-based heuristics instead of tiktoken/WASM.
 * Intentionally approximate — thresholds are soft, and we'd rather
 * compress slightly early than slightly late.
 *
 * Accuracy target: within 20% of actual token count for English text.
 */

import type { AgentEvent } from '../types.js';

/** Chars-per-token ratio for natural language text. */
const TEXT_RATIO = 3.5;

/** Chars-per-token ratio for structured content (JSON, tool results). */
const STRUCTURED_RATIO = 3.0;

/**
 * Estimate token count for a string.
 * Uses conservative char/token ratios (lower ratio = higher estimate).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / TEXT_RATIO);
}

/**
 * Estimate token count for structured/JSON content.
 * Structured text has more punctuation and shorter words, so uses a
 * tighter ratio.
 */
export function estimateStructuredTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / STRUCTURED_RATIO);
}

/**
 * Estimate token count for a single AgentEvent.
 * Routes to the appropriate estimator based on event type.
 */
export function estimateEventTokens(event: AgentEvent): number {
  const content = event.content;
  if (content === null || content === undefined) return 0;

  if (typeof content === 'string') {
    return estimateTokens(content);
  }

  if (typeof content !== 'object') {
    return estimateTokens(String(content));
  }

  const obj = content as Record<string, unknown>;

  switch (event.type) {
    case 'text':
    case 'thinking':
    case 'steering':
      return estimateTokens(typeof obj['text'] === 'string' ? obj['text'] : JSON.stringify(content));

    case 'tool_call':
      // Tool name + serialized arguments
      return estimateStructuredTokens(
        `${typeof obj['tool'] === 'string' ? obj['tool'] : ''} ${JSON.stringify(obj['arguments'] ?? {})}`,
      );

    case 'tool_result':
      // Tool results are often large structured data
      return estimateStructuredTokens(JSON.stringify(obj['result'] ?? ''));

    case 'error':
      return estimateTokens(typeof obj['message'] === 'string' ? obj['message'] : JSON.stringify(content));

    case 'done':
      return estimateTokens(typeof obj['text'] === 'string' ? obj['text'] : '');

    default:
      return estimateStructuredTokens(JSON.stringify(content));
  }
}

/**
 * Estimate total token count for an array of AgentEvents.
 */
export function estimateMessagesTokens(messages: AgentEvent[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateEventTokens(msg);
  }
  return total;
}
