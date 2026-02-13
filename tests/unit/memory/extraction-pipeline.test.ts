import { describe, it, expect } from 'vitest';
import { ExtractionPipeline } from '../../../src/memory/extraction-pipeline.js';
import type { MemoryItem } from '../../../src/memory/memory-types.js';

function makeValidItem(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 'mem_test_001',
    type: 'knowledge',
    summary: 'TypeScript supports generics',
    source: 'session-1',
    source_type: 'agent_analysis',
    created_at: new Date().toISOString(),
    last_accessed: new Date().toISOString(),
    access_count: 0,
    reinforcement_score: 0,
    tags: ['typescript'],
    category: 'coding/typescript',
    ...overrides,
  };
}

describe('ExtractionPipeline', () => {
  it('extracts valid items from LLM response', async () => {
    const items = [makeValidItem()];
    const pipeline = new ExtractionPipeline(async () => JSON.stringify(items));

    const result = await pipeline.extract(['User: I learned about TS generics'], []);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.summary).toBe('TypeScript supports generics');
    expect(result.errors).toHaveLength(0);
    expect(result.retries).toBe(0);
  });

  it('retries on invalid JSON response', async () => {
    let callCount = 0;
    const items = [makeValidItem()];
    const pipeline = new ExtractionPipeline(async () => {
      callCount++;
      if (callCount === 1) return 'not json at all';
      return JSON.stringify(items);
    });

    const result = await pipeline.extract(['msg'], []);
    expect(result.items).toHaveLength(1);
    expect(result.retries).toBe(1);
    expect(result.errors.some(e => e.includes('not valid JSON'))).toBe(true);
  });

  it('retries on non-array JSON response', async () => {
    let callCount = 0;
    const items = [makeValidItem()];
    const pipeline = new ExtractionPipeline(async () => {
      callCount++;
      if (callCount === 1) return '{"not": "an array"}';
      return JSON.stringify(items);
    });

    const result = await pipeline.extract(['msg'], []);
    expect(result.items).toHaveLength(1);
    expect(result.retries).toBe(1);
  });

  it('retries on invalid items then succeeds', async () => {
    let callCount = 0;
    const validItems = [makeValidItem()];
    const pipeline = new ExtractionPipeline(async () => {
      callCount++;
      if (callCount === 1) return JSON.stringify([{ bad: 'item' }]);
      return JSON.stringify(validItems);
    });

    const result = await pipeline.extract(['msg'], []);
    expect(result.items).toHaveLength(1);
    expect(result.retries).toBe(1);
  });

  it('gives up after max retries', async () => {
    const pipeline = new ExtractionPipeline(async () => 'garbage');

    const result = await pipeline.extract(['msg'], []);
    expect(result.items).toHaveLength(0);
    expect(result.retries).toBeGreaterThan(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles extractFn throwing errors', async () => {
    const pipeline = new ExtractionPipeline(async () => {
      throw new Error('LLM down');
    });

    const result = await pipeline.extract(['msg'], []);
    expect(result.items).toHaveLength(0);
    expect(result.errors.some(e => e.includes('LLM down'))).toBe(true);
  });

  it('validates all required fields', () => {
    const pipeline = new ExtractionPipeline(async () => '[]');

    // Valid item
    const valid = pipeline.validateItem(makeValidItem());
    expect(valid.valid).toBe(true);
    expect(valid.errors).toHaveLength(0);

    // Missing summary
    const noSummary = pipeline.validateItem({ ...makeValidItem(), summary: '' });
    expect(noSummary.valid).toBe(false);

    // Invalid type
    const badType = pipeline.validateItem({ ...makeValidItem(), type: 'bogus' });
    expect(badType.valid).toBe(false);

    // Invalid source_type
    const badSource = pipeline.validateItem({ ...makeValidItem(), source_type: 'invalid' });
    expect(badSource.valid).toBe(false);

    // Non-object
    const nonObj = pipeline.validateItem('string');
    expect(nonObj.valid).toBe(false);

    // Null
    const nullVal = pipeline.validateItem(null);
    expect(nullVal.valid).toBe(false);
  });

  it('deduplicates items with >80% Jaccard similarity', () => {
    const pipeline = new ExtractionPipeline(async () => '[]');

    const existing: MemoryItem[] = [
      makeValidItem({ id: 'existing-1', summary: 'TypeScript supports generics for type safety' }),
    ];

    const newItems: MemoryItem[] = [
      makeValidItem({ id: 'new-1', summary: 'TypeScript supports generics for type safety' }), // exact duplicate
      makeValidItem({ id: 'new-2', summary: 'Python data analysis with pandas' }), // different
    ];

    const deduped = pipeline.deduplicateItems(newItems, existing);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.id).toBe('new-2');
  });

  it('keeps all items when no duplicates exist', () => {
    const pipeline = new ExtractionPipeline(async () => '[]');

    const existing: MemoryItem[] = [
      makeValidItem({ id: 'existing-1', summary: 'Kubernetes cluster management' }),
    ];

    const newItems: MemoryItem[] = [
      makeValidItem({ id: 'new-1', summary: 'React hooks best practices' }),
      makeValidItem({ id: 'new-2', summary: 'Python machine learning pipelines' }),
    ];

    const deduped = pipeline.deduplicateItems(newItems, existing);
    expect(deduped).toHaveLength(2);
  });
});
