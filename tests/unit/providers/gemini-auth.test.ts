/**
 * TEST-06: GeminiProvider checkAuth() Tests
 *
 * Validates authentication checking behavior:
 * - Valid auth returns true
 * - Invalid/expired token returns false
 * - CLI binary not found returns false
 * - "not authenticated" in output detected
 * - Caching behavior (subsequent calls use cached status)
 * - Error classification (auth vs network vs binary)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GeminiProvider } from '../../../src/providers/gemini-provider.js';
import type { ProviderConfig } from '../../../src/types.js';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    name: 'gemini-auth-test',
    type: 'gemini-cli',
    rank: 2,
    capabilities: ['search', 'large-context'],
    cost_tier: 'included',
    enabled: true,
    cli_path: 'gemini',
    model: 'gemini-2.0-flash',
    ...overrides,
  };
}

/**
 * Mock a spawn call that outputs stdout data and exits with a given code.
 * Can optionally trigger an error event instead of close.
 */
function mockSpawn(
  stdoutData: string = '',
  exitCode: number = 0,
  options?: { error?: Error }
) {
  const stdout = Readable.from([stdoutData]);
  const child = new EventEmitter() as any;
  child.stdout = stdout;
  child.stderr = Readable.from(['']);

  vi.mocked(spawn).mockReturnValue(child);

  setImmediate(() => {
    if (options?.error) {
      child.emit('error', options.error);
    } else {
      child.emit('close', exitCode);
    }
  });

  return child;
}

/**
 * Mock a spawn that fails with 'error' event (binary not found),
 * then a fallback spawn for --version.
 */
function mockSpawnWithFallback(
  fallbackStdout: string = '',
  fallbackCode: number = 0,
  fallbackOptions?: { error?: Error }
) {
  let callCount = 0;

  vi.mocked(spawn).mockImplementation((..._args: any[]) => {
    callCount++;
    const child = new EventEmitter() as any;

    if (callCount === 1) {
      // First call: `gemini auth status` — fails with error (binary issue)
      child.stdout = Readable.from(['']);
      child.stderr = Readable.from(['']);
      setImmediate(() => {
        child.emit('error', new Error('spawn ENOENT'));

        // Second call will happen from within the error handler
      });
    } else {
      // Second call: `gemini --version` — fallback
      child.stdout = Readable.from([fallbackStdout]);
      child.stderr = Readable.from(['']);
      setImmediate(() => {
        if (fallbackOptions?.error) {
          child.emit('error', fallbackOptions.error);
        } else {
          child.emit('close', fallbackCode);
        }
      });
    }

    return child;
  });
}

describe('GeminiProvider checkAuth()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('successful authentication', () => {
    it('returns valid=true when `gemini auth status` exits 0', async () => {
      mockSpawn('Authenticated as user@example.com', 0);
      const provider = new GeminiProvider({ config: makeConfig() });
      const auth = await provider.checkAuth();
      expect(auth.valid).toBe(true);
      expect(auth.requiresInteraction).toBe(false);
      expect(auth.canAutoRefresh).toBe(true);
    });

    it('passes "auth status" args to spawn', async () => {
      mockSpawn('OK', 0);
      const provider = new GeminiProvider({ config: makeConfig() });
      await provider.checkAuth();
      expect(spawn).toHaveBeenCalledWith('gemini', ['auth', 'status']);
    });

    it('uses custom cli_path from config', async () => {
      mockSpawn('OK', 0);
      const provider = new GeminiProvider({
        config: makeConfig({ cli_path: '/usr/local/bin/my-gemini' }),
      });
      await provider.checkAuth();
      expect(spawn).toHaveBeenCalledWith('/usr/local/bin/my-gemini', ['auth', 'status']);
    });
  });

  describe('authentication failures', () => {
    it('returns valid=false when exit code is non-zero', async () => {
      mockSpawn('', 1);
      const provider = new GeminiProvider({ config: makeConfig() });
      const auth = await provider.checkAuth();
      expect(auth.valid).toBe(false);
      expect(auth.requiresInteraction).toBe(true);
    });

    it('returns valid=false when output contains "not authenticated"', async () => {
      mockSpawn('You are not authenticated. Run `gemini auth login`.', 0);
      const provider = new GeminiProvider({ config: makeConfig() });
      const auth = await provider.checkAuth();
      expect(auth.valid).toBe(false);
      expect(auth.requiresInteraction).toBe(true);
    });

    it('detects "Not Authenticated" case-insensitively', async () => {
      mockSpawn('NOT AUTHENTICATED', 0);
      const provider = new GeminiProvider({ config: makeConfig() });
      const auth = await provider.checkAuth();
      expect(auth.valid).toBe(false);
    });
  });

  describe('binary not found — fallback to --version', () => {
    it('falls back to --version check when auth status errors', async () => {
      mockSpawnWithFallback('gemini 1.0.0', 0);
      const provider = new GeminiProvider({ config: makeConfig() });
      const auth = await provider.checkAuth();
      // Fallback succeeds (binary exists), so valid=true, canAutoRefresh=true
      expect(auth.valid).toBe(true);
      expect(auth.canAutoRefresh).toBe(true);
    });

    it('returns valid=false when --version fallback also fails', async () => {
      mockSpawnWithFallback('', 0, { error: new Error('spawn ENOENT') });
      const provider = new GeminiProvider({ config: makeConfig() });
      const auth = await provider.checkAuth();
      expect(auth.valid).toBe(false);
      expect(auth.requiresInteraction).toBe(true);
    });

    it('returns valid=false when --version fallback exits non-zero', async () => {
      mockSpawnWithFallback('', 1);
      const provider = new GeminiProvider({ config: makeConfig() });
      const auth = await provider.checkAuth();
      expect(auth.valid).toBe(false);
      expect(auth.requiresInteraction).toBe(true);
    });
  });

  describe('caching behavior', () => {
    it('caches valid auth status and does not re-check within TTL', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      mockSpawn('Authenticated', 0);
      const provider = new GeminiProvider({ config: makeConfig() });

      const auth1 = await provider.checkAuth();
      expect(auth1.valid).toBe(true);

      // Within TTL: second call should use cache
      vi.mocked(spawn).mockClear();
      const auth2 = await provider.checkAuth();
      expect(auth2.valid).toBe(true);
      expect(spawn).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('re-checks auth after TTL expires', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      mockSpawn('Authenticated', 0);
      const provider = new GeminiProvider({ config: makeConfig() });

      await provider.checkAuth();

      // Advance past the 60s TTL
      vi.advanceTimersByTime(61_000);
      vi.mocked(spawn).mockClear();
      mockSpawn('Authenticated', 0);

      await provider.checkAuth();
      expect(spawn).toHaveBeenCalledTimes(1); // Should re-check

      vi.useRealTimers();
    });
  });

  describe('isAvailable integration', () => {
    it('returns false when provider is disabled', async () => {
      const provider = new GeminiProvider({
        config: makeConfig({ enabled: false }),
      });
      expect(await provider.isAvailable()).toBe(false);
    });

    it('returns true when enabled and auth is valid', async () => {
      mockSpawn('Authenticated', 0);
      const provider = new GeminiProvider({ config: makeConfig() });
      expect(await provider.isAvailable()).toBe(true);
    });

    it('returns false when enabled but auth fails', async () => {
      mockSpawn('', 1);
      const provider = new GeminiProvider({ config: makeConfig() });
      expect(await provider.isAvailable()).toBe(false);
    });
  });
});
