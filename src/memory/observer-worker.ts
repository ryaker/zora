/**
 * ObserverWorker — Background agent that compresses raw messages
 * into dated, priority-tagged observations.
 *
 * Runs asynchronously so the agent never blocks during compression.
 * Uses a cheap/fast model (e.g., Gemini Flash) for cost efficiency.
 */

import type { AgentEvent } from '../types.js';
import type { ObservationBlock } from './observation-store.js';
import { ObservationStore } from './observation-store.js';
import { estimateTokens } from './token-estimator.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('observer-worker');

/**
 * Function signature for the LLM compression call.
 * Accepts a prompt string, returns the compressed observations.
 */
export type CompressFn = (prompt: string) => Promise<string>;

/**
 * Serializes an AgentEvent into a human-readable string for the observer prompt.
 */
function serializeEvent(event: AgentEvent, index: number): string {
  const ts = event.timestamp instanceof Date
    ? event.timestamp.toISOString()
    : String(event.timestamp);
  const content = event.content;

  if (typeof content === 'string') {
    return `[${index}] ${ts} [${event.type}] ${content}`;
  }

  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    switch (event.type) {
      case 'text':
      case 'thinking':
      case 'steering':
        return `[${index}] ${ts} [${event.type}] ${String(obj['text'] ?? '')}`;

      case 'tool_call':
        return `[${index}] ${ts} [tool_call] ${String(obj['tool'] ?? 'unknown')}(${JSON.stringify(obj['arguments'] ?? {}).substring(0, 500)})`;

      case 'tool_result': {
        const resultStr = JSON.stringify(obj['result'] ?? '');
        const truncated = resultStr.length > 500 ? resultStr.substring(0, 500) + '...' : resultStr;
        return `[${index}] ${ts} [tool_result] ${truncated}`;
      }

      case 'error':
        return `[${index}] ${ts} [error] ${String(obj['message'] ?? JSON.stringify(content))}`;

      case 'done':
        return `[${index}] ${ts} [done] ${String(obj['text'] ?? '')}`;

      default:
        return `[${index}] ${ts} [${event.type}] ${JSON.stringify(content).substring(0, 500)}`;
    }
  }

  return `[${index}] ${ts} [${event.type}] ${String(content)}`;
}

/**
 * Build the observer prompt.
 */
function buildObserverPrompt(
  messages: AgentEvent[],
  startIndex: number,
  existingObservations: string,
): string {
  const serialized = messages.map((m, i) => serializeEvent(m, startIndex + i)).join('\n');

  const existingBlock = existingObservations
    ? `\nExisting observations (for context, do NOT repeat these):\n${existingObservations}\n`
    : '';

  return `You are a conversation observer. Compress the following messages into concise, dated observations. Preserve:
- Decisions made and their reasoning
- Key facts learned or stated
- Tool results that inform future actions
- Errors encountered and how they were resolved
- User preferences expressed

Format each observation as:
[YYYY-MM-DD HH:MM] <PRIORITY> <observation>

Priority levels:
  CRITICAL — Decisions, errors, blockers that affect future actions
  IMPORTANT — Key facts, preferences, tool outcomes
  NOTE — Background context, minor details

Rules:
- Be concise. Target 3-6x compression ratio.
- Preserve exact names, paths, IDs, and values (never paraphrase these).
- Group related observations by topic when possible.
- If a tool result is very large, summarize the outcome, not the raw output.
- Do not repeat information from existing observations.
${existingBlock}
Messages to compress:
${serialized}`;
}

export class ObserverWorker {
  private readonly _compressFn: CompressFn;

  constructor(compressFn: CompressFn) {
    this._compressFn = compressFn;
  }

  /**
   * Compress a chunk of messages into an observation block.
   * This is the core compression operation — called in the background by ContextCompressor.
   *
   * @param messages The raw messages to compress
   * @param startIndex The global message index of the first message (for the prompt)
   * @param existingObservations Previously compressed observations (for dedup context)
   * @param sessionId The session these messages belong to
   */
  async compress(
    messages: AgentEvent[],
    startIndex: number,
    existingObservations: string,
    sessionId: string,
  ): Promise<ObservationBlock> {
    const prompt = buildObserverPrompt(messages, startIndex, existingObservations);

    let observations: string;
    try {
      observations = await this._compressFn(prompt);
    } catch (err) {
      // On failure, fall back to a basic summary
      log.error({ err, messageCount: messages.length }, 'Observer compression failed, using fallback');
      observations = this._fallbackCompress(messages, startIndex);
    }

    const block: ObservationBlock = {
      id: ObservationStore.generateId(),
      sessionId,
      createdAt: new Date().toISOString(),
      tier: 'session',
      observations,
      sourceMessageRange: [startIndex, startIndex + messages.length],
      estimatedTokens: estimateTokens(observations),
    };

    log.info(
      {
        sessionId,
        inputMessages: messages.length,
        outputTokens: block.estimatedTokens,
        range: block.sourceMessageRange,
      },
      'Observation block created',
    );

    return block;
  }

  /**
   * Fallback compression when the LLM call fails.
   * Produces a minimal summary from event types and timestamps.
   */
  private _fallbackCompress(messages: AgentEvent[], startIndex: number): string {
    const first = messages[0];
    const last = messages[messages.length - 1];
    const firstTs = first?.timestamp instanceof Date
      ? first.timestamp.toISOString().substring(0, 16).replace('T', ' ')
      : 'unknown';
    const lastTs = last?.timestamp instanceof Date
      ? last.timestamp.toISOString().substring(0, 16).replace('T', ' ')
      : 'unknown';

    const typeCounts = new Map<string, number>();
    for (const m of messages) {
      typeCounts.set(m.type, (typeCounts.get(m.type) ?? 0) + 1);
    }
    const typeBreakdown = [...typeCounts.entries()]
      .map(([type, count]) => `${count} ${type}`)
      .join(', ');

    // Extract text content from text events for minimal context
    const textSnippets: string[] = [];
    for (const m of messages) {
      if (m.type === 'text' && m.content && typeof m.content === 'object') {
        const text = (m.content as Record<string, unknown>)['text'];
        if (typeof text === 'string' && text.length > 0) {
          textSnippets.push(text.substring(0, 100));
          if (textSnippets.length >= 3) break;
        }
      }
    }

    let summary = `[${firstTs}] NOTE — Compressed ${messages.length} messages (indices ${startIndex}-${startIndex + messages.length - 1}): ${typeBreakdown}`;
    if (textSnippets.length > 0) {
      summary += `\n[${lastTs}] NOTE — Key content: ${textSnippets.join(' | ')}`;
    }

    return summary;
  }
}
