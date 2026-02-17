import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextCompressor } from '../../../src/memory/context-compressor.js';
import { ObservationStore } from '../../../src/memory/observation-store.js';
import type { AgentEvent, CompressionConfig } from '../../../src/types.js';

function makeConfig(overrides: Partial<CompressionConfig> = {}): CompressionConfig {
  return {
    enabled: true,
    working_tier_max_tokens: 500,  // Low threshold for testing
    session_tier_max_tokens: 300,
    cross_session_tier_max_tokens: 200,
    chunk_size: 5,
    async_buffer: false,  // Disable for deterministic tests
    ...overrides,
  };
}

function makeEvent(text: string): AgentEvent {
  return {
    type: 'text',
    timestamp: new Date(),
    content: { text },
  };
}

// Create a mock store that doesn't touch disk
function createMockStore() {
  const blocks: Array<{ tier: string; observations: string }> = [];
  return {
    store: {
      init: vi.fn(),
      append: vi.fn().mockImplementation(async (block: { tier: string; observations: string }) => {
        blocks.push(block);
      }),
      loadSession: vi.fn().mockResolvedValue([]),
      loadCrossSession: vi.fn().mockResolvedValue([]),
      buildSessionContext: vi.fn().mockResolvedValue(''),
      buildCrossSessionContext: vi.fn().mockResolvedValue(''),
      getSessionTokenCount: vi.fn().mockResolvedValue(0),
      pruneOldSessions: vi.fn().mockResolvedValue(0),
    } as unknown as ObservationStore,
    blocks,
  };
}

describe('ContextCompressor', () => {
  let config: CompressionConfig;
  let compressFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    config = makeConfig();
    compressFn = vi.fn().mockResolvedValue('[2026-02-16 14:00] NOTE — Compressed observations');
  });

  it('ingests events and tracks working tier tokens', () => {
    const { store } = createMockStore();
    const compressor = new ContextCompressor(config, store, compressFn);

    compressor.ingest(makeEvent('Hello world'));
    compressor.ingest(makeEvent('How are you?'));

    const ctx = compressor.buildContext();
    expect(ctx.workingMessages).toHaveLength(2);
    expect(ctx.stats.workingTokens).toBeGreaterThan(0);
    expect(ctx.stats.totalMessagesIngested).toBe(2);
  });

  it('returns empty context initially', () => {
    const { store } = createMockStore();
    const compressor = new ContextCompressor(config, store, compressFn);

    const ctx = compressor.buildContext();
    expect(ctx.sessionObservations).toBe('');
    expect(ctx.crossSessionContext).toBe('');
    expect(ctx.workingMessages).toHaveLength(0);
    expect(ctx.stats.compressionsPending).toBe(0);
  });

  it('triggers compression when working tier exceeds threshold', async () => {
    const { store } = createMockStore();
    // Very low threshold so it triggers quickly
    const lowConfig = makeConfig({ working_tier_max_tokens: 50, chunk_size: 3 });
    const compressor = new ContextCompressor(lowConfig, store, compressFn);

    // Ingest enough events to exceed 50 tokens
    for (let i = 0; i < 10; i++) {
      compressor.ingest(makeEvent(`Message ${i} with some longer text to push token count up`));
    }

    await compressor.tick();

    // CompressFn should have been called
    expect(compressFn).toHaveBeenCalled();
  });

  it('does not trigger compression below threshold', async () => {
    const { store } = createMockStore();
    const compressor = new ContextCompressor(config, store, compressFn);

    compressor.ingest(makeEvent('Short'));
    await compressor.tick();

    expect(compressFn).not.toHaveBeenCalled();
  });

  it('moves compressed messages from working to session tier', async () => {
    const { store } = createMockStore();
    const lowConfig = makeConfig({ working_tier_max_tokens: 50, chunk_size: 3 });
    const compressor = new ContextCompressor(lowConfig, store, compressFn);

    for (let i = 0; i < 6; i++) {
      compressor.ingest(makeEvent(`Message ${i} with enough text to trigger compression threshold`));
    }

    await compressor.tick();

    const ctx = compressor.buildContext();
    // Some messages should have been compressed out of working tier
    expect(ctx.workingMessages.length).toBeLessThan(6);
    // Session observations should now have content
    expect(ctx.sessionObservations).toContain('Compressed observations');
    expect(ctx.stats.totalCompressions).toBeGreaterThan(0);
  });

  it('forces sync compression at blockAfter threshold', async () => {
    const { store } = createMockStore();
    const lowConfig = makeConfig({
      working_tier_max_tokens: 50,
      block_after_tokens: 100,
      chunk_size: 3,
    });
    const compressor = new ContextCompressor(lowConfig, store, compressFn);

    // Ingest a lot to exceed blockAfter
    for (let i = 0; i < 20; i++) {
      compressor.ingest(makeEvent(`Message ${i} padding text here for tokens`));
    }

    // tick() should force synchronous compression
    await compressor.tick();
    expect(compressFn).toHaveBeenCalled();
  });

  it('flush compresses remaining messages', async () => {
    const { store } = createMockStore();
    const compressor = new ContextCompressor(config, store, compressFn);

    for (let i = 0; i < 10; i++) {
      compressor.ingest(makeEvent(`Message ${i}`));
    }

    await compressor.flush();

    // After flush, compression should have been attempted
    expect(compressFn).toHaveBeenCalled();
  });

  it('persists observation blocks to store', async () => {
    const { store, blocks } = createMockStore();
    const lowConfig = makeConfig({ working_tier_max_tokens: 50, chunk_size: 3 });
    const compressor = new ContextCompressor(lowConfig, store, compressFn);

    for (let i = 0; i < 10; i++) {
      compressor.ingest(makeEvent(`Message ${i} extra text for tokens`));
    }

    // Use flush to ensure all compressions complete (tick may fire async)
    await compressor.flush();

    // Observation should have been persisted to store
    expect(store.append).toHaveBeenCalled();
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('recovers from compressFn failure', async () => {
    const { store } = createMockStore();
    const failingFn = vi.fn().mockRejectedValue(new Error('LLM down'));
    const lowConfig = makeConfig({ working_tier_max_tokens: 50, chunk_size: 3 });
    const compressor = new ContextCompressor(lowConfig, store, failingFn);

    for (let i = 0; i < 10; i++) {
      compressor.ingest(makeEvent(`Message ${i} padding`));
    }

    // Should not throw — chunk returned to working tier
    await compressor.tick();

    const ctx = compressor.buildContext();
    // Messages should still be in working tier
    expect(ctx.workingMessages.length).toBeGreaterThan(0);
  });

  it('generates unique session IDs', () => {
    const { store } = createMockStore();
    const c1 = new ContextCompressor(config, store, compressFn);
    const c2 = new ContextCompressor(config, store, compressFn);

    expect(c1.sessionId).not.toBe(c2.sessionId);
  });

  it('loads existing observations on init', async () => {
    const { store } = createMockStore();
    (store.loadSession as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'obs_existing',
        sessionId: 'test',
        createdAt: new Date().toISOString(),
        tier: 'session',
        observations: 'Existing observation',
        sourceMessageRange: [0, 5],
        estimatedTokens: 10,
      },
    ]);
    (store.buildCrossSessionContext as ReturnType<typeof vi.fn>).mockResolvedValue('Cross session fact');

    const compressor = new ContextCompressor(config, store, compressFn, 'test');
    await compressor.loadExisting();

    const ctx = compressor.buildContext();
    expect(ctx.sessionObservations).toContain('Existing observation');
    expect(ctx.crossSessionContext).toContain('Cross session fact');
  });
});
