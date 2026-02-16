/**
 * Tests for ORCH-15: Zod-based tool factory
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { tool } from '../../../src/tools/tool-factory.js';

describe('tool() factory — ORCH-15', () => {
  it('creates a CustomToolDefinition from a Zod schema', () => {
    const t = tool(
      'greet',
      'Greet someone',
      z.object({ name: z.string() }),
      async (input) => `Hello, ${input.name}!`,
    );

    expect(t.name).toBe('greet');
    expect(t.description).toBe('Greet someone');
    expect(t.input_schema).toBeDefined();
    expect(typeof t.handler).toBe('function');
  });

  it('generates valid JSON Schema from Zod schema', () => {
    const t = tool(
      'add',
      'Add two numbers',
      z.object({
        a: z.number().describe('First number'),
        b: z.number().describe('Second number'),
      }),
      async (input) => input.a + input.b,
    );

    const schema = t.input_schema;
    expect(schema['type']).toBe('object');
    expect(schema['properties']).toBeDefined();
    const props = schema['properties'] as Record<string, unknown>;
    expect(props['a']).toBeDefined();
    expect(props['b']).toBeDefined();
  });

  it('handler returns correct result with valid input', async () => {
    const t = tool(
      'add',
      'Add two numbers',
      z.object({ a: z.number(), b: z.number() }),
      async (input) => input.a + input.b,
    );

    const result = await t.handler({ a: 3, b: 7 });
    expect(result).toBe(10);
  });

  it('handler throws ZodError on invalid input', async () => {
    const t = tool(
      'greet',
      'Greet someone',
      z.object({ name: z.string() }),
      async (input) => `Hello, ${input.name}!`,
    );

    await expect(t.handler({ name: 123 })).rejects.toThrow();
  });

  it('throws on empty tool name', () => {
    expect(() =>
      tool('', 'desc', z.object({}), async () => null),
    ).toThrow('Tool name must be non-empty');
  });

  it('throws on whitespace-only tool name', () => {
    expect(() =>
      tool('  ', 'desc', z.object({}), async () => null),
    ).toThrow('Tool name must be non-empty');
  });

  it('throws on empty description', () => {
    expect(() =>
      tool('test', '', z.object({}), async () => null),
    ).toThrow('Tool description must be non-empty');
  });

  it('supports optional fields in the schema', async () => {
    const t = tool(
      'greet',
      'Greet someone',
      z.object({
        name: z.string(),
        greeting: z.string().optional(),
      }),
      async (input) => `${input.greeting ?? 'Hello'}, ${input.name}!`,
    );

    const result = await t.handler({ name: 'World' });
    expect(result).toBe('Hello, World!');

    const result2 = await t.handler({ name: 'World', greeting: 'Hi' });
    expect(result2).toBe('Hi, World!');
  });

  it('supports enum fields in the schema', () => {
    const t = tool(
      'mood',
      'Set mood',
      z.object({
        mood: z.enum(['happy', 'sad', 'neutral']),
      }),
      async (input) => input.mood,
    );

    const schema = t.input_schema;
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    expect(props['mood']!['enum']).toEqual(['happy', 'sad', 'neutral']);
  });

  it('supports default values in the schema', async () => {
    const t = tool(
      'config',
      'Configure',
      z.object({
        timeout: z.number().default(30),
      }),
      async (input) => input.timeout,
    );

    const result = await t.handler({});
    expect(result).toBe(30);
  });

  it('supports nested object schemas', () => {
    const t = tool(
      'nested',
      'Nested tool',
      z.object({
        user: z.object({
          name: z.string(),
          age: z.number(),
        }),
      }),
      async (input) => input.user.name,
    );

    const schema = t.input_schema;
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    expect(props['user']!['type']).toBe('object');
  });

  it('supports array fields in the schema', () => {
    const t = tool(
      'tags',
      'Set tags',
      z.object({
        tags: z.array(z.string()),
      }),
      async (input) => input.tags,
    );

    const schema = t.input_schema;
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    expect(props['tags']!['type']).toBe('array');
  });
});
