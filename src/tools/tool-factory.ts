/**
 * Zod-based Tool Factory — ORCH-15
 *
 * Produces CustomToolDefinition objects from a Zod schema.
 * Validates the schema at registration time (not at LLM call time),
 * catching malformed schemas early.
 *
 * Uses Zod 4's built-in z.toJSONSchema() for schema conversion.
 */

import { z } from 'zod';
import type { CustomToolDefinition } from '../orchestrator/execution-loop.js';

/**
 * Creates a CustomToolDefinition with Zod-based input validation.
 *
 * The Zod schema is converted to JSON Schema at registration time
 * using Zod 4's native `z.toJSONSchema()`. At call time, the handler
 * receives input validated through the Zod schema.
 *
 * @param name - Tool name (must be non-empty)
 * @param description - Human-readable description
 * @param schema - Zod object schema defining the input parameters
 * @param handler - Async function that receives validated input and returns a result
 * @returns A CustomToolDefinition ready to pass to ExecutionLoop
 *
 * @example
 * ```ts
 * const greetTool = tool(
 *   'greet',
 *   'Greet someone by name',
 *   z.object({ name: z.string().describe('Person to greet') }),
 *   async (input) => `Hello, ${input.name}!`,
 * );
 * ```
 */
export function tool<T extends z.ZodObject<z.ZodRawShape>>(
  name: string,
  description: string,
  schema: T,
  handler: (input: z.infer<T>) => Promise<unknown>,
): CustomToolDefinition {
  if (!name || name.trim().length === 0) {
    throw new Error('Tool name must be non-empty');
  }
  if (!description || description.trim().length === 0) {
    throw new Error('Tool description must be non-empty');
  }

  // Convert Zod schema to JSON Schema at registration time.
  // This validates the schema structure eagerly.
  const jsonSchema = z.toJSONSchema(schema);

  return {
    name,
    description,
    input_schema: jsonSchema as Record<string, unknown>,
    handler: async (input: Record<string, unknown>) => {
      // Parse input through Zod for runtime validation
      const parsed = schema.parse(input);
      return handler(parsed as z.infer<T>);
    },
  };
}
