/**
 * ContextCompressor — Rolling context compression with three tiers.
 *
 * Manages a rolling window of conversation history:
 *   - Working tier: Recent raw messages (full fidelity)
 *   - Session tier: Compressed observations from older messages
 *   - Cross-session tier: Key facts from prior sessions
 *
 * Background compression ensures the agent never blocks.
 * Append-only session observations maximize prompt cache hits.
 */

import type { AgentEvent, CompressionConfig } from '../types.js';
import { estimateEventTokens, estimateTokens } from './token-estimator.js';
import { ObserverWorker, type CompressFn } from './observer-worker.js';
import { ObservationStore, type ObservationBlock } from './observation-store.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('context-compressor');

export interface CompressionStats {
  workingTokens: number;
  sessionTokens: number;
  crossSessionTokens: number;
  compressionsPending: number;
  totalMessagesIngested: number;
  totalCompressions: number;
}

export interface BuiltContext {
  /** Compressed session-tier observations (append-only text block) */
  sessionObservations: string;
  /** Cross-session context (key facts from prior sessions) */
  crossSessionContext: string;
  /** Recent raw messages (working tier) */
  workingMessages: AgentEvent[];
  /** Current stats */
  stats: CompressionStats;
}

export class ContextCompressor {
  private readonly _config: CompressionConfig;
  private readonly _observer: ObserverWorker;
  private readonly _store: ObservationStore;

  /** Working tier: recent raw messages */
  private _workingMessages: AgentEvent[] = [];
  /** Running token count for working tier */
  private _workingTokens = 0;
  /** Global message index (total messages ingested) */
  private _messageIndex = 0;

  /** Session-tier observations (text blocks, append-only) */
  private _sessionObservations: string[] = [];
  private _sessionTokens = 0;

  /** Cross-session context (loaded once at start) */
  private _crossSessionContext = '';
  private _crossSessionTokens = 0;

  /** Pending background compressions (tracked for synchronous settlement check) */
  private _pendingCompressions: { promise: Promise<void>; settled: boolean }[] = [];
  private _totalCompressions = 0;

  /** Session ID for this compressor instance */
  private readonly _sessionId: string;

  /** Async buffer: pre-computed observations ready to activate */
  private _precomputedBlock: ObservationBlock | null = null;
  private _precomputePromise: Promise<void> | null = null;
  private _precomputeThreshold: number;
  /** Track session tier size when precompute started to detect staleness */
  private _precomputeSessionObsCount = 0;

  constructor(
    config: CompressionConfig,
    store: ObservationStore,
    compressFn: CompressFn,
    sessionId?: string,
  ) {
    this._config = config;
    this._store = store;
    this._observer = new ObserverWorker(compressFn);
    this._sessionId = sessionId ?? `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    // Start pre-computing when working tier reaches 70% of threshold
    this._precomputeThreshold = Math.floor(config.working_tier_max_tokens * 0.7);
  }

  /**
   * Load existing observations for this session (e.g., after restart).
   */
  async loadExisting(): Promise<void> {
    const sessionBlocks = await this._store.loadSession(this._sessionId);
    for (const block of sessionBlocks) {
      this._sessionObservations.push(block.observations);
      this._sessionTokens += block.estimatedTokens;
    }

    this._crossSessionContext = await this._store.buildCrossSessionContext();
    this._crossSessionTokens = estimateTokens(this._crossSessionContext);

    log.info(
      {
        sessionId: this._sessionId,
        sessionBlocks: sessionBlocks.length,
        sessionTokens: this._sessionTokens,
        crossSessionTokens: this._crossSessionTokens,
      },
      'Loaded existing observations',
    );
  }

  /**
   * Ingest a new event from the execution stream.
   * Non-blocking — just appends and updates token count.
   */
  ingest(event: AgentEvent): void {
    this._workingMessages.push(event);
    this._workingTokens += estimateEventTokens(event);
    this._messageIndex++;
  }

  /**
   * Check thresholds and trigger background compression if needed.
   * Call this periodically (e.g., every N events or on a timer).
   *
   * If async_buffer is enabled, also manages pre-computation.
   */
  async tick(): Promise<void> {
    // Clean up completed compressions
    this._pendingCompressions = this._pendingCompressions.filter(t => !t.settled);

    // Safety valve: if working tier exceeds blockAfter, do synchronous compression
    const blockAfter = this._config.block_after_tokens ?? (this._config.working_tier_max_tokens * 2);
    if (this._workingTokens > blockAfter) {
      log.warn(
        { workingTokens: this._workingTokens, blockAfter },
        'Working tier exceeded blockAfter threshold — forcing synchronous compression',
      );
      await this._compressChunk();
      return;
    }

    // Normal threshold: trigger background compression
    if (this._workingTokens > this._config.working_tier_max_tokens) {
      // Check if we have a pre-computed block ready
      if (this._precomputedBlock) {
        this._activatePrecomputed();
      } else {
        // Fire and forget background compression
        this._trackPromise(this._compressChunk());
      }
      return;
    }

    // Async buffer: start pre-computing when approaching threshold
    if (
      this._config.async_buffer &&
      this._workingTokens > this._precomputeThreshold &&
      !this._precomputePromise &&
      !this._precomputedBlock &&
      this._workingMessages.length >= this._config.chunk_size
    ) {
      this._startPrecompute();
    }
  }

  /**
   * Build the current context for the next API call.
   * Always returns immediately with the latest available state.
   */
  buildContext(): BuiltContext {
    return {
      sessionObservations: this._sessionObservations.join('\n\n'),
      crossSessionContext: this._crossSessionContext,
      workingMessages: [...this._workingMessages],
      stats: {
        workingTokens: this._workingTokens,
        sessionTokens: this._sessionTokens,
        crossSessionTokens: this._crossSessionTokens,
        compressionsPending: this._pendingCompressions.filter(t => !t.settled).length,
        totalMessagesIngested: this._messageIndex,
        totalCompressions: this._totalCompressions,
      },
    };
  }

  /**
   * Flush: wait for all pending compressions to complete.
   * Call this on session end.
   */
  async flush(): Promise<void> {
    // Wait for any pre-computation
    if (this._precomputePromise) {
      await this._precomputePromise;
      if (this._precomputedBlock) {
        this._activatePrecomputed();
      }
    }

    // Compress any remaining working messages that exceed a minimum
    if (this._workingMessages.length > 5) {
      await this._compressChunk();
    }

    // Wait for all pending compressions
    await Promise.allSettled(this._pendingCompressions.map(t => t.promise));
    this._pendingCompressions = [];

    log.info(
      {
        sessionId: this._sessionId,
        totalCompressions: this._totalCompressions,
        sessionTokens: this._sessionTokens,
        remainingWorking: this._workingMessages.length,
      },
      'Context compressor flushed',
    );
  }

  /** Get the session ID for this compressor instance. */
  get sessionId(): string {
    return this._sessionId;
  }

  /** Get current stats without building full context. */
  get stats(): CompressionStats {
    return {
      workingTokens: this._workingTokens,
      sessionTokens: this._sessionTokens,
      crossSessionTokens: this._crossSessionTokens,
      compressionsPending: this._pendingCompressions.filter(t => !t.settled).length,
      totalMessagesIngested: this._messageIndex,
      totalCompressions: this._totalCompressions,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────

  /** Track a promise for settlement so tick() can clean it up synchronously. */
  private _trackPromise(p: Promise<void>): void {
    const tracked = { promise: p, settled: false };
    p.finally(() => { tracked.settled = true; });
    this._pendingCompressions.push(tracked);
  }

  /**
   * Compress the oldest chunk of working messages into a session observation.
   */
  private async _compressChunk(): Promise<void> {
    const chunkSize = Math.min(this._config.chunk_size, this._workingMessages.length);
    if (chunkSize === 0) return;

    // Dequeue the oldest chunk
    const chunk = this._workingMessages.splice(0, chunkSize);
    const startIndex = this._messageIndex - this._workingMessages.length - chunk.length;

    // Recalculate working tier tokens
    this._workingTokens = 0;
    for (const msg of this._workingMessages) {
      this._workingTokens += estimateEventTokens(msg);
    }

    const existingObs = this._sessionObservations.join('\n\n');

    try {
      const block = await this._observer.compress(chunk, startIndex, existingObs, this._sessionId);

      // Append to session tier
      this._sessionObservations.push(block.observations);
      this._sessionTokens += block.estimatedTokens;

      // Persist
      await this._store.append(block);

      this._totalCompressions++;

      log.info(
        {
          chunkSize: chunk.length,
          observationTokens: block.estimatedTokens,
          sessionTokens: this._sessionTokens,
          workingTokens: this._workingTokens,
        },
        'Chunk compressed',
      );

      // Check if session tier needs condensation
      if (this._sessionTokens > this._config.session_tier_max_tokens) {
        log.info(
          { sessionTokens: this._sessionTokens, max: this._config.session_tier_max_tokens },
          'Session tier exceeds threshold — reflector pass needed',
        );
        // Reflector integration is handled by the orchestrator (OM-05/OM-07)
      }
    } catch (err) {
      // On failure, put the chunk back at the front of working messages
      this._workingMessages.unshift(...chunk);
      this._workingTokens = 0;
      for (const msg of this._workingMessages) {
        this._workingTokens += estimateEventTokens(msg);
      }
      log.error({ err }, 'Compression failed, chunk returned to working tier');
    }
  }

  /**
   * Start pre-computing observations in the background (async buffering).
   * The pre-computed block is held until the threshold is actually hit.
   */
  private _startPrecompute(): void {
    const chunkSize = Math.min(this._config.chunk_size, this._workingMessages.length);
    if (chunkSize === 0) return;

    // Snapshot the messages to pre-compute (don't remove from working tier yet)
    const chunk = this._workingMessages.slice(0, chunkSize);
    const startIndex = this._messageIndex - this._workingMessages.length;
    const existingObs = this._sessionObservations.join('\n\n');

    // Snapshot session tier size to detect race condition with _compressChunk
    this._precomputeSessionObsCount = this._sessionObservations.length;

    this._precomputePromise = (async () => {
      try {
        this._precomputedBlock = await this._observer.compress(
          chunk, startIndex, existingObs, this._sessionId,
        );
        log.info(
          { tokens: this._precomputedBlock.estimatedTokens },
          'Pre-computed observation block ready',
        );
      } catch (err) {
        log.warn({ err }, 'Pre-computation failed (will compress normally when threshold hits)');
        this._precomputedBlock = null;
      } finally {
        this._precomputePromise = null;
      }
    })();
  }

  /**
   * Activate a pre-computed observation block.
   * Removes the corresponding messages from the working tier.
   */
  private _activatePrecomputed(): void {
    const block = this._precomputedBlock;
    if (!block) return;

    // Check for staleness: if session tier changed since precompute started, discard
    if (this._sessionObservations.length !== this._precomputeSessionObsCount) {
      log.warn(
        {
          expectedCount: this._precomputeSessionObsCount,
          actualCount: this._sessionObservations.length,
        },
        'Pre-computed block is stale (session tier changed), discarding',
      );
      this._precomputedBlock = null;
      return;
    }

    const [start, end] = block.sourceMessageRange;
    const chunkSize = end - start;

    // Remove the pre-computed messages from working tier
    this._workingMessages.splice(0, Math.min(chunkSize, this._workingMessages.length));
    this._workingTokens = 0;
    for (const msg of this._workingMessages) {
      this._workingTokens += estimateEventTokens(msg);
    }

    // Append to session tier
    this._sessionObservations.push(block.observations);
    this._sessionTokens += block.estimatedTokens;

    // Persist (tracked so flush() awaits it)
    this._trackPromise(
      this._store.append(block).catch(err => {
        log.error({ err }, 'Failed to persist pre-computed observation block');
      }) as Promise<void>,
    );

    this._precomputedBlock = null;
    this._totalCompressions++;

    log.info(
      {
        chunkSize,
        observationTokens: block.estimatedTokens,
        sessionTokens: this._sessionTokens,
        workingTokens: this._workingTokens,
      },
      'Pre-computed block activated',
    );
  }
}
