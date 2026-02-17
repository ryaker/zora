import { describe, it, expect, vi } from 'vitest';
import { ReflectorWorker } from '../../../src/memory/reflector-worker.js';

// Mock MemoryManager
function createMockMemoryManager() {
  const createdItems: Array<Record<string, unknown>> = [];
  return {
    manager: {
      structuredMemory: {
        createItem: vi.fn().mockImplementation(async (input: Record<string, unknown>) => {
          createdItems.push(input);
          return { id: `mem_${Date.now()}`, ...input };
        }),
      },
      invalidateIndex: vi.fn(),
    },
    createdItems,
  };
}

describe('ReflectorWorker', () => {
  it('extracts facts and creates memory items', async () => {
    const response =
      'FACTS: [{"summary": "User prefers dark mode", "type": "behavior", "tags": ["preferences", "ui"]}]\n\n' +
      'CONDENSED:\n[2026-02-16 14:00] CRITICAL — Project uses PostgreSQL';

    const compressFn = vi.fn().mockResolvedValue(response);
    const { manager, createdItems } = createMockMemoryManager();

    const worker = new ReflectorWorker(compressFn, manager as never);
    const result = await worker.reflect(
      '[2026-02-16 14:00] IMPORTANT — User said they prefer dark mode\n[2026-02-16 14:05] CRITICAL — Decided to use PostgreSQL',
      'test-session',
    );

    expect(result.itemsCreated).toBe(1);
    expect(result.condensedObservations).toContain('PostgreSQL');
    expect(result.condensedTokens).toBeGreaterThan(0);
    expect(createdItems).toHaveLength(1);
    expect(createdItems[0]!['summary']).toBe('User prefers dark mode');
    expect(createdItems[0]!['type']).toBe('behavior');
    expect(createdItems[0]!['source_type']).toBe('agent_analysis');
    expect(createdItems[0]!['category']).toBe('behavior/reflected');
  });

  it('handles empty observations', async () => {
    const compressFn = vi.fn();
    const { manager } = createMockMemoryManager();

    const worker = new ReflectorWorker(compressFn, manager as never);
    const result = await worker.reflect('', 'test-session');

    expect(result.itemsCreated).toBe(0);
    expect(result.condensedObservations).toBe('');
    expect(compressFn).not.toHaveBeenCalled();
  });

  it('returns original observations on compressFn failure', async () => {
    const compressFn = vi.fn().mockRejectedValue(new Error('LLM down'));
    const { manager } = createMockMemoryManager();

    const worker = new ReflectorWorker(compressFn, manager as never);
    const input = '[2026-02-16 14:00] NOTE — Some observation';
    const result = await worker.reflect(input, 'test-session');

    expect(result.itemsCreated).toBe(0);
    expect(result.condensedObservations).toBe(input);
  });

  it('handles response with no facts', async () => {
    const response = 'FACTS: []\n\nCONDENSED:\n[2026-02-16 14:00] NOTE — Nothing persistent here';
    const compressFn = vi.fn().mockResolvedValue(response);
    const { manager } = createMockMemoryManager();

    const worker = new ReflectorWorker(compressFn, manager as never);
    const result = await worker.reflect('Some observations', 'test-session');

    expect(result.itemsCreated).toBe(0);
    expect(result.condensedObservations).toContain('Nothing persistent here');
  });

  it('handles malformed FACTS JSON gracefully', async () => {
    const response = 'FACTS: {not valid json}\n\nCONDENSED:\n[2026-02-16 14:00] NOTE — Still here';
    const compressFn = vi.fn().mockResolvedValue(response);
    const { manager } = createMockMemoryManager();

    const worker = new ReflectorWorker(compressFn, manager as never);
    const result = await worker.reflect('Some observations', 'test-session');

    expect(result.itemsCreated).toBe(0);
    expect(result.condensedObservations).toContain('Still here');
  });

  it('defaults unknown types to knowledge', async () => {
    const response = 'FACTS: [{"summary": "Some fact", "type": "unknown_type", "tags": []}]\n\nCONDENSED:\nDone';
    const compressFn = vi.fn().mockResolvedValue(response);
    const { manager, createdItems } = createMockMemoryManager();

    const worker = new ReflectorWorker(compressFn, manager as never);
    await worker.reflect('Observations', 'test-session');

    expect(createdItems).toHaveLength(1);
    expect(createdItems[0]!['type']).toBe('knowledge');
  });

  it('extracts multiple facts', async () => {
    const response =
      'FACTS: [' +
      '{"summary": "Fact 1", "type": "knowledge", "tags": ["a"]},' +
      '{"summary": "Fact 2", "type": "profile", "tags": ["b"]},' +
      '{"summary": "Fact 3", "type": "skill", "tags": ["c"]}' +
      ']\n\nCONDENSED:\nAll condensed';

    const compressFn = vi.fn().mockResolvedValue(response);
    const { manager, createdItems } = createMockMemoryManager();

    const worker = new ReflectorWorker(compressFn, manager as never);
    const result = await worker.reflect('Many observations', 'test-session');

    expect(result.itemsCreated).toBe(3);
    expect(createdItems).toHaveLength(3);
  });

  it('invalidates memory index after creating items', async () => {
    const response = 'FACTS: [{"summary": "A fact", "type": "knowledge", "tags": []}]\n\nCONDENSED:\nDone';
    const compressFn = vi.fn().mockResolvedValue(response);
    const { manager } = createMockMemoryManager();

    const worker = new ReflectorWorker(compressFn, manager as never);
    await worker.reflect('Observations', 'test-session');

    expect(manager.invalidateIndex).toHaveBeenCalled();
  });

  it('handles response without CONDENSED marker', async () => {
    const response = 'FACTS: []\n\nSome leftover text that is the condensed part';
    const compressFn = vi.fn().mockResolvedValue(response);
    const { manager } = createMockMemoryManager();

    const worker = new ReflectorWorker(compressFn, manager as never);
    const result = await worker.reflect('Observations', 'test-session');

    // Should use fallback parsing
    expect(result.condensedObservations.length).toBeGreaterThan(0);
  });
});
