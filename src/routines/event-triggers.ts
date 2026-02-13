/**
 * EventTriggerManager — Polling-based file watcher for event-triggered routines.
 *
 * Spec v0.6 §5.6 "Event-Triggered Routines":
 *   - Uses fs.stat polling (NOT fs.watch) for reliability.
 *   - Supports glob-like paths with '*'.
 *   - Debounces rapid file changes.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

interface WatchEntry {
  watchPath: string;
  debounceMs: number;
  callback: (changedPath: string) => void;
  timer: ReturnType<typeof setInterval>;
  mtimes: Map<string, number>;
  lastFired: number;
}

export class EventTriggerManager {
  private readonly _pollIntervalMs: number;
  private readonly _watchers: Map<string, WatchEntry> = new Map();

  constructor(options: { pollIntervalMs: number }) {
    this._pollIntervalMs = options.pollIntervalMs;
  }

  /**
   * Starts polling a path for file changes.
   * Supports glob patterns with '*' in the filename portion.
   */
  watch(
    watchPath: string,
    debounceMs: number,
    callback: (changedPath: string) => void,
  ): void {
    if (this._watchers.has(watchPath)) return;

    const entry: WatchEntry = {
      watchPath,
      debounceMs,
      callback,
      mtimes: new Map(),
      lastFired: 0,
      timer: setInterval(() => {
        void this._poll(entry);
      }, this._pollIntervalMs),
    };

    this._watchers.set(watchPath, entry);
  }

  /**
   * Stops polling a specific path.
   */
  unwatch(watchPath: string): void {
    const entry = this._watchers.get(watchPath);
    if (entry) {
      clearInterval(entry.timer);
      this._watchers.delete(watchPath);
    }
  }

  /**
   * Stops all watchers.
   */
  unwatchAll(): void {
    for (const entry of this._watchers.values()) {
      clearInterval(entry.timer);
    }
    this._watchers.clear();
  }

  private async _poll(entry: WatchEntry): Promise<void> {
    try {
      const files = await this._resolveFiles(entry.watchPath);

      for (const file of files) {
        try {
          const stat = await fs.stat(file);
          const mtime = stat.mtimeMs;
          const prevMtime = entry.mtimes.get(file);

          if (prevMtime !== undefined && mtime !== prevMtime) {
            const now = Date.now();
            if (now - entry.lastFired >= entry.debounceMs) {
              entry.lastFired = now;
              entry.callback(file);
            }
          }

          entry.mtimes.set(file, mtime);
        } catch {
          // File may have been deleted since readdir
        }
      }
    } catch {
      // Directory may not exist yet
    }
  }

  /**
   * Resolves a path that may contain a '*' glob in the filename portion.
   */
  private async _resolveFiles(watchPath: string): Promise<string[]> {
    const dir = path.dirname(watchPath);
    const pattern = path.basename(watchPath);

    if (!pattern.includes('*')) {
      // Exact file path
      return [watchPath];
    }

    // Simple glob: convert '*' to regex
    const regex = new RegExp(
      '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    );

    try {
      const entries = await fs.readdir(dir);
      return entries
        .filter((name) => regex.test(name))
        .map((name) => path.join(dir, name));
    } catch {
      return [];
    }
  }
}
