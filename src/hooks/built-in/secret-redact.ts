/**
 * SecretRedactHook — Redacts API keys and secrets from tool arguments before execution.
 * Modifies args in the before phase so secrets never reach the LLM or logs.
 *
 * Static patterns cover well-known formats (API keys, tokens, etc.).
 * Call addPattern() to register additional key or value patterns at runtime
 * (e.g. after SecretsManager loads stored secrets).
 */

import type { ToolHook, ToolCallContext, ToolHookResult } from '../tool-hook-runner.js';

const STATIC_KEY_PATTERN = /key|token|secret|password|auth|bearer|credential/i;
const STATIC_VALUE_PATTERN = /^(sk-|ghp_|xox[baprs]-|eyJ|AIza)[A-Za-z0-9_-]{10,}/;

class SecretRedactHookImpl implements ToolHook {
  readonly name = 'secret-redact';
  readonly phase = 'before' as const;

  private readonly _extraKeyPatterns: RegExp[] = [];
  private readonly _extraValuePatterns: RegExp[] = [];

  /**
   * Register an additional key or value pattern at runtime.
   *
   * @param keyPattern - Matches against argument key names (e.g. /myApiKey/i)
   * @param valuePattern - Optionally matches against argument values directly
   *
   * Used by Orchestrator after SecretsManager initializes to ensure stored
   * secret names are redacted from tool arguments even if they don't match
   * the default patterns.
   */
  addPattern(keyPattern: RegExp, valuePattern?: RegExp): void {
    // Strip `g` and `y` flags — global/sticky regexes advance lastIndex across
    // successive .test() calls, causing intermittent misses.
    this._extraKeyPatterns.push(new RegExp(keyPattern.source, keyPattern.flags.replace(/[gy]/g, '')));
    if (valuePattern) this._extraValuePatterns.push(new RegExp(valuePattern.source, valuePattern.flags.replace(/[gy]/g, '')));
  }

  private _shouldRedact(key: string, value: string): boolean {
    if (STATIC_KEY_PATTERN.test(key) || STATIC_VALUE_PATTERN.test(value)) return true;
    if (this._extraKeyPatterns.some(p => p.test(key))) return true;
    if (this._extraValuePatterns.some(p => p.test(value))) return true;
    return false;
  }

  private _redactDeep(key: string, value: unknown): unknown {
    if (typeof value === 'string') {
      return this._shouldRedact(key, value) ? '[REDACTED]' : value;
    }
    if (Array.isArray(value)) {
      // If the parent key is sensitive, redact the whole array rather than
      // recursing with numeric indices ("0", "1", …) which never match key patterns.
      if (this._shouldRedact(key, '')) return '[REDACTED]';
      return value.map((item, i) => this._redactDeep(String(i), item));
    }
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, this._redactDeep(k, v)])
      );
    }
    return value;
  }

  private _redactObj(obj: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, this._redactDeep(k, v)])
    ) as Record<string, unknown>;
  }

  async run(ctx: ToolCallContext): Promise<ToolHookResult> {
    const modifiedArgs = this._redactObj(ctx.arguments);
    const changed = JSON.stringify(modifiedArgs) !== JSON.stringify(ctx.arguments);
    return { allow: true, modifiedArgs: changed ? modifiedArgs : undefined };
  }
}

/**
 * Singleton instance — registered in the ToolHookRunner at boot.
 * Use SecretRedactHook.addPattern() to register dynamic patterns at runtime.
 */
export const SecretRedactHook = new SecretRedactHookImpl();
