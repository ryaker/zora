/**
 * Logger — Structured logging with pino.
 *
 * OPS-05 / LOG-01: Replace ad-hoc console.log with structured pino logger.
 *   - JSON output in production, pretty-print in development
 *   - Child loggers with module context
 *   - Log levels configurable via config.toml log_level
 *   - File transport via pino (optional)
 */

import pino from 'pino';
import { createRequire } from 'node:module';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LoggerOptions {
  level?: LogLevel;
  /** Module name for child logger context */
  module?: string;
  /** Enable pretty printing (auto-detected from NODE_ENV if unset) */
  pretty?: boolean;
}

// Detect if we should pretty-print: dev mode or TTY
function shouldPrettyPrint(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.ZORA_LOG_FORMAT !== 'json' &&
    (process.stdout.isTTY === true || process.env.ZORA_LOG_PRETTY === '1')
  );
}

let _rootLogger: pino.Logger | null = null;

/**
 * Initialize the root logger. Call once at startup with the config log_level.
 * Subsequent calls are no-ops unless force=true.
 */
export function initLogger(options: LoggerOptions = {}, force = false): pino.Logger {
  if (_rootLogger && !force) return _rootLogger;

  const level = options.level ?? (process.env.ZORA_LOG_LEVEL as LogLevel) ?? 'info';
  const pretty = options.pretty ?? shouldPrettyPrint();

  let transport: { target: string; options: Record<string, unknown> } | undefined;
  if (pretty) {
    try {
      const _require = createRequire(import.meta.url);
      const prettyPath = _require.resolve('pino-pretty');
      transport = {
        target: prettyPath,
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      };
    } catch {
      // pino-pretty not available — fall back to JSON
    }
  }

  _rootLogger = pino({
    level,
    ...(transport ? { transport } : {}),
    base: { name: 'zora' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });

  return _rootLogger;
}

/**
 * Get a child logger for a specific module.
 * If the root logger hasn't been initialized, initializes with defaults.
 */
export function getLogger(module?: string): pino.Logger {
  const root = _rootLogger ?? initLogger();
  if (module) {
    return root.child({ module });
  }
  return root;
}

/**
 * Factory: create a child logger scoped to a module name.
 * Alias for getLogger(moduleName).
 */
export const createLogger = getLogger;

/** Default root logger instance. */
export const logger = getLogger();

/**
 * Reset the root logger (for testing).
 */
export function resetLogger(): void {
  _rootLogger = null;
}
