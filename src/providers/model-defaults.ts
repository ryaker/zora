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

/**
 * Default model for the ollama provider (#260). The #236 bake-off's tentative
 * pick: tied on quality with the other cloud models, lowest latency and fewest
 * output tokens. Served by ollama.com on Rich's Ollama plan; a local-only
 * install should set `model` to something it has pulled.
 */
export const DEFAULT_OLLAMA_MODEL = 'glm-5.3:cloud';

/**
 * Default model for the consult_advisor tool (#261). Richard's pick: Fable.
 * The advisor is a tool-less, text-only frontier call made by an Ollama-first
 * executor at hard decision points; it never acts.
 */
export const DEFAULT_ADVISOR_MODEL = 'claude-fable-5-2';
