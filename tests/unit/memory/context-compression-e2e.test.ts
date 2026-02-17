/**
 * End-to-end integration test for the context compression pipeline.
 *
 * Simulates a long conversation flowing through ContextCompressor:
 *   1. Feed many messages → working tier grows
 *   2. Threshold triggers → observer compresses in background
 *   3. Session observations appear in context
 *   4. Flush → remaining messages compressed
 *   5. Reflector extracts persistent facts
 *   6. Restart → observations restored from disk
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ContextCompressor } from '../../../src/memory/context-compressor.js';
import { ObservationStore } from '../../../src/memory/observation-store.js';
import { ReflectorWorker } from '../../../src/memory/reflector-worker.js';
import type { AgentEvent, CompressionConfig } from '../../../src/types.js';

function makeConfig(overrides: Partial<CompressionConfig> = {}): CompressionConfig {
  return {
    enabled: true,
    working_tier_max_tokens: 200,   // Very low for testing
    session_tier_max_tokens: 500,
    cross_session_tier_max_tokens: 300,
    chunk_size: 5,
    async_buffer: false,
    ...overrides,
  };
}

function makeTextEvent(text: string, minutesAgo: number = 0): AgentEvent {
  return {
    type: 'text',
    timestamp: new Date(Date.now() - minutesAgo * 60000),
    content: { text },
  };
}

function makeToolEvent(tool: string, args: Record<string, unknown>): AgentEvent {
  return {
    type: 'tool_call',
    timestamp: new Date(),
    content: { toolCallId: `tc_${Date.now()}`, tool, arguments: args },
  };
}

describe('Context Compression E2E', () => {
  let tmpDir: string;
  let store: ObservationStore;
  let compressFn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zora-compression-e2e-'));
    store = new ObservationStore(tmpDir);
    await store.init();

    compressFn = vi.fn().mockImplementation(async (prompt: string) => {
      // Simple mock that extracts key info from the prompt
      const messageCount = (prompt.match(/\[text\]/g) || []).length +
        (prompt.match(/\[tool_call\]/g) || []).length;
      return `[${new Date().toISOString().substring(0, 16).replace('T', ' ')}] NOTE — Compressed ${messageCount} messages about project work`;
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('full compression lifecycle: ingest → compress → flush → persist', async () => {
    const config = makeConfig();
    const sessionId = 'e2e-test-session';
    const compressor = new ContextCompressor(config, store, compressFn, sessionId);

    // Phase 1: Ingest messages (simulates a conversation)
    const messages = [
      makeTextEvent('User: Help me set up a new project'),
      makeTextEvent('Agent: Sure, I can help with that. What kind of project?'),
      makeToolEvent('Bash', { command: 'mkdir my-project' }),
      makeTextEvent('Agent: Created the project directory'),
      makeTextEvent('User: Great, now initialize npm'),
      makeToolEvent('Bash', { command: 'npm init -y' }),
      makeTextEvent('Agent: Package.json created'),
      makeTextEvent('User: Add TypeScript'),
      makeToolEvent('Bash', { command: 'npm install typescript' }),
      makeTextEvent('Agent: TypeScript installed'),
      makeTextEvent('User: Create a tsconfig'),
      makeToolEvent('Bash', { command: 'npx tsc --init' }),
      makeTextEvent('Agent: tsconfig.json created with default settings'),
      makeTextEvent('User: Perfect, now let me write some code'),
      makeTextEvent('Agent: Go ahead, I am here to help'),
      makeTextEvent('User: Can you create an index.ts with a hello world?'),
    ];

    for (const msg of messages) {
      compressor.ingest(msg);
    }

    // Phase 2: Flush triggers compression (ensures all async work completes)
    await compressor.flush();

    const ctx2 = compressor.buildContext();
    expect(ctx2.stats.compressionsPending).toBe(0);
    // After flush, compressions should have occurred
    expect(ctx2.stats.totalCompressions).toBeGreaterThan(0);

    // Phase 4: Verify observations persisted to disk
    const loaded = await store.loadSession(sessionId);
    expect(loaded.length).toBeGreaterThan(0);

    const sessionContext = await store.buildSessionContext(sessionId);
    expect(sessionContext).toContain('Compressed');
  });

  it('context survives simulated restart', async () => {
    const config = makeConfig();
    const sessionId = 'restart-test';

    // First session: ingest and compress
    const compressor1 = new ContextCompressor(config, store, compressFn, sessionId);
    for (let i = 0; i < 15; i++) {
      compressor1.ingest(makeTextEvent(`Message ${i} with enough content to trigger compression threshold`));
    }
    await compressor1.flush();

    // Simulate restart: create new compressor with same session ID
    const compressor2 = new ContextCompressor(config, store, compressFn, sessionId);
    await compressor2.loadExisting();

    const ctx = compressor2.buildContext();
    // Should have session observations from the first compressor
    expect(ctx.sessionObservations).toContain('Compressed');
    expect(ctx.stats.sessionTokens).toBeGreaterThan(0);
  });

  it('three tiers coexist in context', async () => {
    const config = makeConfig();
    const sessionId = 'tiers-test';

    // Set up cross-session context
    await store.append({
      id: 'obs_cross',
      sessionId: 'prior-session',
      createdAt: new Date().toISOString(),
      tier: 'cross-session',
      observations: '[2026-02-15] IMPORTANT — User works on TypeScript projects',
      sourceMessageRange: [0, 0],
      estimatedTokens: 15,
    });

    const compressor = new ContextCompressor(config, store, compressFn, sessionId);
    await compressor.loadExisting();

    // Ingest enough to trigger session-tier compression
    for (let i = 0; i < 12; i++) {
      compressor.ingest(makeTextEvent(`Current session message ${i} about project setup work with enough content to push token count up`));
    }

    // Flush to ensure compression happens
    await compressor.flush();

    // Ingest a few more for working tier
    compressor.ingest(makeTextEvent('Most recent message still in working tier'));

    const ctx = compressor.buildContext();

    // All three tiers should be present
    expect(ctx.crossSessionContext).toContain('TypeScript projects');
    expect(ctx.stats.totalCompressions).toBeGreaterThan(0);
    expect(ctx.workingMessages.length).toBeGreaterThan(0);
  });

  it('mixed event types are handled correctly', async () => {
    const config = makeConfig();
    const compressor = new ContextCompressor(config, store, compressFn, 'mixed-test');

    const events: AgentEvent[] = [
      makeTextEvent('User asks about something'),
      { type: 'thinking', timestamp: new Date(), content: { text: 'Thinking about the approach...' } },
      makeToolEvent('Read', { file_path: '/test.ts' }),
      { type: 'tool_result', timestamp: new Date(), content: { toolCallId: 'tc1', result: 'file contents here' } },
      { type: 'error', timestamp: new Date(), content: { message: 'File not found' } },
      makeTextEvent('Agent explains the error'),
      { type: 'steering', timestamp: new Date(), content: { text: 'User corrects approach', source: 'dashboard', author: 'user' } },
      makeTextEvent('Agent adjusts'),
      { type: 'done', timestamp: new Date(), content: { text: 'Task completed', duration_ms: 5000 } },
    ];

    for (const event of events) {
      compressor.ingest(event);
    }

    await compressor.flush();

    // Should not throw — all event types handled
    const ctx = compressor.buildContext();
    expect(ctx.stats.totalMessagesIngested).toBe(events.length);
  });

  it('reflector extracts facts from session observations', async () => {
    const reflectorFn = vi.fn().mockResolvedValue(
      'FACTS: [{"summary": "Project uses TypeScript with strict mode", "type": "knowledge", "tags": ["typescript"]}]\n\n' +
      'CONDENSED:\n[2026-02-16 14:00] NOTE — Project setup completed',
    );

    const mockMemoryManager = {
      structuredMemory: {
        createItem: vi.fn().mockResolvedValue({ id: 'mem_new' }),
      },
      invalidateIndex: vi.fn(),
    };

    const reflector = new ReflectorWorker(reflectorFn, mockMemoryManager as never);

    const result = await reflector.reflectAndPersist(
      '[2026-02-16 14:00] IMPORTANT — Set up TypeScript project with strict mode enabled',
      'test-session',
      store,
    );

    expect(result.itemsCreated).toBe(1);
    expect(result.condensedObservations).toContain('Project setup completed');

    // Cross-session observation should be persisted
    const crossSession = await store.loadCrossSession();
    expect(crossSession.length).toBeGreaterThan(0);
    expect(crossSession[0]!.tier).toBe('cross-session');
  });

  it('handles high message volume without errors', async () => {
    const config = makeConfig({ working_tier_max_tokens: 100, chunk_size: 10 });
    const compressor = new ContextCompressor(config, store, compressFn, 'volume-test');

    // Ingest 100 messages
    for (let i = 0; i < 100; i++) {
      compressor.ingest(makeTextEvent(`Message ${i}: The user is doing something important`));
      if (i % 15 === 0) {
        await compressor.tick();
      }
    }

    await compressor.flush();

    const ctx = compressor.buildContext();
    expect(ctx.stats.totalMessagesIngested).toBe(100);
    expect(ctx.stats.totalCompressions).toBeGreaterThan(0);
    // After flush, most messages should have been compressed
    expect(ctx.stats.sessionTokens).toBeGreaterThan(0);
  });
});
