/**
 * Config env: reference resolution (SEC-26).
 *
 * The docs have recommended `bot_token = "env:ZORA_TELEGRAM_TOKEN"` as *the*
 * secure way to keep a credential out of `config.toml` since the security
 * runtime guide was written. Nothing ever resolved it. The literal nine
 * characters `env:ZORA_` plus the variable name were handed to Telegram as the
 * bot token, the call failed with an opaque auth error, and — worse — a user who
 * had left the real token in the file next to the reference believed they had
 * moved it out. A security control that returns false assurance.
 *
 * This module resolves those references once, at config-load time, so every
 * consumer (daemon, steering gateway, MCP spawn) gets a real value or the
 * process refuses to start. The three rules that make it a control rather than a
 * convenience:
 *
 *   1. **A missing variable is fatal.** Never fall through to the literal
 *      string, never substitute an empty credential. `ConfigEnvError` names the
 *      variable and the config field so the fix is obvious.
 *   2. **The value is never echoed.** Errors and logs carry the *variable name*
 *      and the *field path*, never the resolved secret. `redactConfig()` exists
 *      for anything that wants to print a config object.
 *   3. **An unresolvable-looking reference is never silently kept.** A field that
 *      is not credential-bearing but holds `env:…` is warned about by name,
 *      because silence is how this bug survived in the first place.
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('config-env');

/** `env:VAR` — the form the docs have always recommended. */
const BARE_ENV_REF = /^env:(.*)$/s;
/** `${env:VAR}` — the form used by the MCP examples in docs/advanced/. */
const BRACED_ENV_REF = /^\$\{env:(.*)\}$/s;
/** POSIX-portable environment variable name. */
const VALID_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Config fields that may carry a credential and therefore support `env:`.
 *
 * Matched against the *last* path segment. Deliberately anchored at the end so
 * that `api_key_env` — which holds the NAME of an environment variable, not a
 * secret — does not match: it already is the indirection this mechanism
 * provides, and resolving it would turn a variable name into a secret value in
 * the field the provider reads as a name.
 */
const CREDENTIAL_KEY = /(?:^|_)(?:token|secret|password|passwd|pwd|api_key|apikey|access_key|private_key|credential|credentials|authorization)$/i;

/**
 * Maps whose *values* are credential-bearing regardless of key name: the
 * environment and headers handed to an MCP server are exactly where API keys
 * live (`env = { MEM0_API_KEY = "${env:MEM0_API_KEY}" }`).
 */
function isMcpSecretMapValue(segments: string[]): boolean {
  return (
    segments.length === 5 &&
    segments[0] === 'mcp' &&
    segments[1] === 'servers' &&
    (segments[3] === 'env' || segments[3] === 'headers')
  );
}

/** True when a `env:` reference in this field should be resolved. */
export function isCredentialField(segments: string[]): boolean {
  if (isMcpSecretMapValue(segments)) return true;
  const key = segments[segments.length - 1];
  return key !== undefined && CREDENTIAL_KEY.test(key);
}

/**
 * Thrown when a config field references an environment variable that is not
 * usable. Carries the variable name and the config path; never the value.
 */
export class ConfigEnvError extends Error {
  constructor(
    message: string,
    readonly varName: string,
    readonly configPath: string,
  ) {
    super(message);
    this.name = 'ConfigEnvError';
  }
}

/** Parse a string into the env var it references, or null if it references none. */
function parseEnvRef(value: string): string | null {
  const braced = BRACED_ENV_REF.exec(value);
  if (braced) return braced[1] ?? '';
  const bare = BARE_ENV_REF.exec(value);
  if (bare) return bare[1] ?? '';
  return null;
}

/**
 * Resolve one credential field's value.
 *
 * @throws ConfigEnvError when the variable is unset, empty, or the reference is
 *         malformed. Returning the literal string in any of those cases is the
 *         bug this function exists to remove.
 */
function resolveValue(value: string, configPath: string, env: NodeJS.ProcessEnv): string {
  const varName = parseEnvRef(value);
  if (varName === null) return value;

  if (!VALID_VAR_NAME.test(varName)) {
    throw new ConfigEnvError(
      `Config field "${configPath}" has a malformed environment reference: ` +
      `"env:${varName}" is not a valid environment variable name. ` +
      'Use env:NAME where NAME matches [A-Za-z_][A-Za-z0-9_]*.',
      varName,
      configPath,
    );
  }

  const resolved = env[varName];
  if (resolved === undefined) {
    throw new ConfigEnvError(
      `Config field "${configPath}" references environment variable ${varName}, which is not set. ` +
      `Export it before starting Zora (e.g. export ${varName}="…") or replace the ` +
      `"env:${varName}" reference in your config with a literal value. ` +
      'Zora will not start with an unresolved credential.',
      varName,
      configPath,
    );
  }
  if (resolved === '') {
    throw new ConfigEnvError(
      `Config field "${configPath}" references environment variable ${varName}, which is set but empty. ` +
      'An empty credential is never valid — set a real value or remove the reference.',
      varName,
      configPath,
    );
  }

  return resolved;
}

/**
 * Walk a parsed config and resolve `env:` references in credential fields.
 *
 * Mutates in place (the caller owns a freshly merged object) and returns it, so
 * callers can chain. Throws `ConfigEnvError` on the first unresolvable
 * reference — a hard startup failure is the point.
 */
export function resolveConfigEnvRefs<T>(config: T, env: NodeJS.ProcessEnv = process.env): T {
  const seenNonCredentialRefs: string[] = [];

  const walk = (node: unknown, segments: string[]): unknown => {
    if (typeof node === 'string') {
      const pathStr = segments.join('.');
      if (isCredentialField(segments)) {
        return resolveValue(node, pathStr, env);
      }
      // Not credential-bearing: keep the literal, but say so. A user who wrote
      // `env:` here expects substitution; silence is how SEC-26 went unnoticed.
      if (parseEnvRef(node) !== null) {
        seenNonCredentialRefs.push(pathStr);
      }
      return node;
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        node[i] = walk(node[i], [...segments, String(i)]);
      }
      return node;
    }
    if (node !== null && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        obj[key] = walk(obj[key], [...segments, key]);
      }
      return obj;
    }
    return node;
  };

  try {
    walk(config, []);
  } catch (err) {
    // Surface the failure here rather than trusting the caller to unwrap it:
    // both CLI entry points log config failures as a generic "Config resolution
    // failed. Run `zora-agent init` first." — advice that would send a user with
    // an unset variable off to rewrite a config file that is already correct.
    // The variable name is safe to log; the value never is (there isn't one).
    if (err instanceof ConfigEnvError) {
      log.error({ variable: err.varName, field: err.configPath }, err.message);
    }
    throw err;
  }

  if (seenNonCredentialRefs.length > 0) {
    log.warn(
      { fields: seenNonCredentialRefs },
      'Config fields contain an "env:" reference but are not credential fields — the literal string is used as-is. ' +
      'env: substitution applies to credential fields (token/secret/password/api_key/…) and MCP env/headers values only.',
    );
  }

  return config;
}

/**
 * Deep copy of a config with every credential field replaced by `[REDACTED]`.
 *
 * Once `env:` references are resolved, the in-memory config holds real secrets.
 * Anything that prints or serialises a config object must go through this.
 * There is deliberately no way to get the value back out.
 */
export function redactConfig<T>(config: T): T {
  const walk = (node: unknown, segments: string[]): unknown => {
    if (typeof node === 'string') {
      return isCredentialField(segments) && node.length > 0 ? '[REDACTED]' : node;
    }
    if (Array.isArray(node)) return node.map((v, i) => walk(v, [...segments, String(i)]));
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, walk(v, [...segments, k])]),
      );
    }
    return node;
  };

  return walk(config, []) as T;
}
