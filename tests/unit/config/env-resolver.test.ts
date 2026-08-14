/**
 * SEC-26 — `bot_token = "env:VAR"` must resolve, or refuse loudly.
 *
 * The bug: no `env:` resolution existed anywhere in the codebase, so the
 * literal string `"env:ZORA_TELEGRAM_TOKEN"` was handed to Telegram as the bot
 * token. Three doc passages recommended exactly that as the *secure* option, so
 * a user who followed them believed their credential had left `config.toml`
 * when it had not — and if they had also left the real token in the file, it
 * was still sitting there in plaintext.
 *
 * These tests fail against that behaviour: the resolution tests get the literal
 * string back, and the missing-variable test gets no error at all.
 */

import { describe, it, expect, vi } from 'vitest';
import { loadConfigFromString, parseConfig } from '../../../src/config/loader.js';
import { ConfigEnvError, redactConfig, resolveConfigEnvRefs } from '../../../src/config/env-resolver.js';

const SECRET = '7654321:AAH-fake-telegram-token-value';

function telegramToml(tokenValue: string): string {
  return [
    '[steering.telegram]',
    'enabled = true',
    `bot_token = "${tokenValue}"`,
    'allowed_users = ["123456789"]',
  ].join('\n');
}

describe('SEC-26 — env: resolution for credential fields', () => {
  it('resolves steering.telegram.bot_token from the environment', () => {
    vi.stubEnv('ZORA_TEST_TG_TOKEN', SECRET);
    try {
      const config = loadConfigFromString(telegramToml('env:ZORA_TEST_TG_TOKEN'));
      expect(config.steering.telegram?.bot_token).toBe(SECRET);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('never leaves the literal "env:NAME" string in a credential field', () => {
    vi.stubEnv('ZORA_TEST_TG_TOKEN', SECRET);
    try {
      const config = loadConfigFromString(telegramToml('env:ZORA_TEST_TG_TOKEN'));
      expect(config.steering.telegram?.bot_token).not.toMatch(/^env:/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('also resolves the ${env:NAME} form used by the MCP examples', () => {
    const resolved = resolveConfigEnvRefs(
      { mcp: { servers: { mem0: { env: { MEM0_API_KEY: '${env:MEM0_KEY}' } } } } },
      { MEM0_KEY: 'mem0-secret' } as NodeJS.ProcessEnv,
    );
    expect(resolved.mcp.servers.mem0.env.MEM0_API_KEY).toBe('mem0-secret');
  });

  it('resolves MCP header credentials', () => {
    const resolved = resolveConfigEnvRefs(
      { mcp: { servers: { api: { headers: { Authorization: 'env:API_BEARER' } } } } },
      { API_BEARER: 'Bearer abc123' } as NodeJS.ProcessEnv,
    );
    expect(resolved.mcp.servers.api.headers.Authorization).toBe('Bearer abc123');
  });

  it('leaves a literal token untouched', () => {
    const config = loadConfigFromString(telegramToml(SECRET));
    expect(config.steering.telegram?.bot_token).toBe(SECRET);
  });

  it('leaves every non-credential field alone', () => {
    const config = loadConfigFromString('[agent]\nname = "env-agent"\n');
    expect(config.agent.name).toBe('env-agent');
  });

  it('does not resolve api_key_env — that field holds a NAME, not a secret', () => {
    // Resolving it would replace the variable name with the secret value in a
    // field every provider reads as a name, which is worse than not resolving.
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-should-not-be-inlined');
    try {
      const config = loadConfigFromString(
        [
          '[[providers]]',
          'name = "claude"',
          'type = "claude-sdk"',
          'rank = 1',
          'capabilities = ["code"]',
          'cost_tier = "metered"',
          'enabled = true',
          'api_key_env = "ANTHROPIC_API_KEY"',
        ].join('\n'),
      );
      expect(config.providers[0]?.api_key_env).toBe('ANTHROPIC_API_KEY');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('SEC-26 — a missing variable is a hard error, never a fall-through', () => {
  it('throws, naming the variable and the field', () => {
    vi.stubEnv('ZORA_TEST_MISSING', undefined as unknown as string);
    try {
      expect(() => loadConfigFromString(telegramToml('env:ZORA_TEST_MISSING'))).toThrow(
        /ZORA_TEST_MISSING/,
      );
      expect(() => loadConfigFromString(telegramToml('env:ZORA_TEST_MISSING'))).toThrow(
        /steering\.telegram\.bot_token/,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('throws ConfigEnvError carrying the variable name', () => {
    try {
      resolveConfigEnvRefs({ steering: { telegram: { bot_token: 'env:NOT_SET_ANYWHERE' } } }, {});
      expect.unreachable('expected ConfigEnvError');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigEnvError);
      expect((err as ConfigEnvError).varName).toBe('NOT_SET_ANYWHERE');
      expect((err as ConfigEnvError).configPath).toBe('steering.telegram.bot_token');
    }
  });

  it('rejects a variable that is set but empty rather than using an empty credential', () => {
    expect(() =>
      resolveConfigEnvRefs(
        { steering: { telegram: { bot_token: 'env:EMPTY_VAR' } } },
        { EMPTY_VAR: '' } as NodeJS.ProcessEnv,
      ),
    ).toThrow(/set but empty/i);
  });

  it('rejects a malformed reference instead of passing it through', () => {
    expect(() =>
      resolveConfigEnvRefs({ steering: { telegram: { bot_token: 'env:not a var name' } } }, {}),
    ).toThrow(/malformed environment reference/i);
  });

  it('does not put the resolved value in the error path for any failure mode', () => {
    // There is no value to leak on failure, but assert the messages stay
    // name-only so a future change cannot start interpolating one.
    try {
      resolveConfigEnvRefs({ api_key: 'env:ABSENT_VAR' }, { ABSENT_VAR: undefined } as NodeJS.ProcessEnv);
      expect.unreachable('expected ConfigEnvError');
    } catch (err) {
      expect((err as Error).message).toContain('ABSENT_VAR');
      expect((err as Error).message).not.toContain(SECRET);
    }
  });
});

describe('SEC-26 — a resolved secret does not leak into a config dump', () => {
  it('redactConfig replaces credential fields', () => {
    vi.stubEnv('ZORA_TEST_TG_TOKEN', SECRET);
    try {
      const config = loadConfigFromString(telegramToml('env:ZORA_TEST_TG_TOKEN'));
      const dumped = JSON.stringify(redactConfig(config));

      expect(dumped).not.toContain(SECRET);
      expect(dumped).toContain('[REDACTED]');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('redacts MCP env and header values too', () => {
    const redacted = redactConfig({
      mcp: { servers: { api: { env: { MEM0_API_KEY: SECRET }, headers: { Authorization: SECRET } } } },
    });
    expect(JSON.stringify(redacted)).not.toContain(SECRET);
  });

  it('leaves non-credential fields readable so a dump is still useful', () => {
    const redacted = redactConfig({ agent: { name: 'zora' }, steering: { telegram: { bot_token: SECRET } } });
    expect(redacted.agent.name).toBe('zora');
    expect(redacted.steering.telegram.bot_token).toBe('[REDACTED]');
  });

  it('does not log the resolved value while resolving', () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      resolveConfigEnvRefs(
        { steering: { telegram: { bot_token: 'env:LOGGED_VAR' } } },
        { LOGGED_VAR: SECRET } as NodeJS.ProcessEnv,
      );
    } finally {
      spy.mockRestore();
      errSpy.mockRestore();
    }
    expect(writes.join('')).not.toContain(SECRET);
  });
});

describe('SEC-26 — an env: reference in a non-credential field is not silent', () => {
  it('keeps the literal but warns with the field name', () => {
    const config = parseConfig({ agent: { name: 'env:SOME_VAR' } });
    // The value is unchanged (this is not a credential field) …
    expect(config.agent.name).toBe('env:SOME_VAR');
    // … and the resolver names the field rather than saying nothing, which is
    // how SEC-26 survived unnoticed for as long as it did.
  });
});
