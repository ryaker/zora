/**
 * Single source of truth for default model IDs (#255).
 *
 * These were previously hard-coded in claude-provider.ts, init-command.ts,
 * quarantine-processor.ts and channel-identity-registry.ts and drifted apart.
 * Import from here; do not write model-id literals elsewhere in src/.
 */

/** Default model for the claude-sdk provider (main task path). */
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

/** Default model for the CaMeL-style quarantine LLM (small, tool-less, cheap). */
export const DEFAULT_QUARANTINE_MODEL = 'claude-haiku-5-5';

/** Default model written by `zora-agent init` for the gemini-cli provider. */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';
