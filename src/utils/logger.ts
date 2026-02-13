/**
 * Logger — Structured JSON logging with file rotation.
 *
 * Remediation R23: Replace scattered console.* calls with structured logging.
 *   - JSON-formatted log entries with timestamp, level, message, metadata
 *   - File rotation by size (default 10MB, keep 5 rotated files)
 *   - Configurable log level
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LoggerOptions {
  level?: LogLevel;
  logDir?: string;
  logFile?: string;
  maxFileSize?: number;      // bytes, default 10MB
  maxFiles?: number;         // number of rotated files to keep
  enableConsole?: boolean;
  enableFile?: boolean;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
}

export class Logger {
  private readonly _level: number;
  private readonly _logFilePath: string;
  private readonly _maxFileSize: number;
  private readonly _maxFiles: number;
  private readonly _enableConsole: boolean;
  private readonly _enableFile: boolean;

  constructor(options: LoggerOptions = {}) {
    this._level = LOG_LEVELS[options.level ?? 'info'];
    const logDir = options.logDir ?? path.join(os.homedir(), '.zora', 'logs');
    this._logFilePath = options.logFile ?? path.join(logDir, 'zora.log');
    this._maxFileSize = options.maxFileSize ?? 10 * 1024 * 1024; // 10MB
    this._maxFiles = options.maxFiles ?? 5;
    this._enableConsole = options.enableConsole ?? true;
    this._enableFile = options.enableFile ?? true;

    if (this._enableFile) {
      try {
        fs.mkdirSync(path.dirname(this._logFilePath), { recursive: true, mode: 0o700 });
      } catch {
        // Directory may already exist
      }
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this._log('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this._log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this._log('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this._log('error', message, meta);
  }

  private _log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVELS[level] < this._level) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
    };

    const line = JSON.stringify(entry);

    if (this._enableConsole) {
      switch (level) {
        case 'error':
          console.error(line);
          break;
        case 'warn':
          console.warn(line);
          break;
        default:
          console.log(line);
      }
    }

    if (this._enableFile) {
      this._writeToFile(line);
    }
  }

  private _writeToFile(line: string): void {
    try {
      // Check if rotation is needed
      try {
        const stats = fs.statSync(this._logFilePath);
        if (stats.size >= this._maxFileSize) {
          this._rotate();
        }
      } catch {
        // File doesn't exist yet, no rotation needed
      }

      fs.appendFileSync(this._logFilePath, line + '\n', { mode: 0o600 });
    } catch (err) {
      // If we can't write to the log file, fall back to stderr
      console.error(`[Logger] Failed to write to log file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private _rotate(): void {
    try {
      // Remove oldest rotated file
      const oldest = `${this._logFilePath}.${this._maxFiles}`;
      try {
        fs.unlinkSync(oldest);
      } catch {
        // File may not exist
      }

      // Shift existing rotated files
      for (let i = this._maxFiles - 1; i >= 1; i--) {
        const from = `${this._logFilePath}.${i}`;
        const to = `${this._logFilePath}.${i + 1}`;
        try {
          fs.renameSync(from, to);
        } catch {
          // File may not exist
        }
      }

      // Rotate current file
      fs.renameSync(this._logFilePath, `${this._logFilePath}.1`);
    } catch (err) {
      console.error(`[Logger] Failed to rotate log files: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// Default global logger instance
let _defaultLogger: Logger | null = null;

export function getLogger(options?: LoggerOptions): Logger {
  if (!_defaultLogger) {
    _defaultLogger = new Logger(options);
  }
  return _defaultLogger;
}

export function setDefaultLogger(logger: Logger): void {
  _defaultLogger = logger;
}
