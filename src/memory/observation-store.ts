/**
 * ObservationStore — Persistence for compressed observation blocks.
 *
 * Stores session-tier and cross-session observations as append-only JSONL files.
 * Same pattern as SessionManager — one file per session, crash-resilient reads.
 *
 * Storage layout:
 *   ~/.zora/memory/observations/{sessionId}.jsonl   (per-session observations)
 *   ~/.zora/memory/observations/cross-session.jsonl  (cross-session rollups)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../utils/logger.js';

const log = createLogger('observation-store');

const CROSS_SESSION_FILE = 'cross-session.jsonl';

export interface ObservationBlock {
  /** Unique ID: obs_{timestamp}_{random} */
  id: string;
  /** Session this observation belongs to */
  sessionId: string;
  /** When the observation was created */
  createdAt: string;
  /** Which tier this observation belongs to */
  tier: 'session' | 'cross-session';
  /** The compressed observation text */
  observations: string;
  /** Which message indices were compressed [start, end) */
  sourceMessageRange: [number, number];
  /** Estimated token count of the observation text */
  estimatedTokens: number;
}

export class ObservationStore {
  private readonly _baseDir: string;

  constructor(baseDir: string) {
    this._baseDir = baseDir;
  }

  async init(): Promise<void> {
    await fs.mkdir(this._baseDir, { recursive: true, mode: 0o700 });
  }

  /**
   * Append an observation block to the appropriate file.
   * Append-only — never overwrites existing observations.
   */
  async append(block: ObservationBlock): Promise<void> {
    const filePath = block.tier === 'cross-session'
      ? path.join(this._baseDir, CROSS_SESSION_FILE)
      : path.join(this._baseDir, `${this._sanitizeId(block.sessionId)}.jsonl`);

    const line = JSON.stringify(block) + '\n';
    await fs.appendFile(filePath, line, { mode: 0o600 });
  }

  /**
   * Load all observation blocks for a session, ordered by creation time.
   * Skips malformed lines (crash-resilient).
   */
  async loadSession(sessionId: string): Promise<ObservationBlock[]> {
    const filePath = path.join(this._baseDir, `${this._sanitizeId(sessionId)}.jsonl`);
    return this._readJsonlFile(filePath);
  }

  /**
   * Load cross-session observations.
   * @param limit Max number of most recent blocks to return.
   */
  async loadCrossSession(limit?: number): Promise<ObservationBlock[]> {
    const filePath = path.join(this._baseDir, CROSS_SESSION_FILE);
    const blocks = await this._readJsonlFile(filePath);
    if (limit !== undefined && blocks.length > limit) {
      return blocks.slice(-limit);
    }
    return blocks;
  }

  /**
   * Build the combined observation text for a session.
   * Returns all session-tier observations concatenated in order.
   */
  async buildSessionContext(sessionId: string): Promise<string> {
    const blocks = await this.loadSession(sessionId);
    if (blocks.length === 0) return '';
    return blocks.map(b => b.observations).join('\n\n');
  }

  /**
   * Build cross-session context string.
   */
  async buildCrossSessionContext(limit?: number): Promise<string> {
    const blocks = await this.loadCrossSession(limit);
    if (blocks.length === 0) return '';
    return blocks.map(b => b.observations).join('\n\n');
  }

  /**
   * Get total estimated tokens for a session's observations.
   */
  async getSessionTokenCount(sessionId: string): Promise<number> {
    const blocks = await this.loadSession(sessionId);
    return blocks.reduce((sum, b) => sum + b.estimatedTokens, 0);
  }

  /**
   * Prune old session observation files.
   * Keeps only the most recent N session files.
   */
  async pruneOldSessions(keepLast: number = 50): Promise<number> {
    let files: string[];
    try {
      files = await fs.readdir(this._baseDir);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw err;
    }

    const sessionFiles = files
      .filter(f => f.endsWith('.jsonl') && f !== CROSS_SESSION_FILE)
      .sort();

    if (sessionFiles.length <= keepLast) return 0;

    const toRemove = sessionFiles.slice(0, sessionFiles.length - keepLast);
    let removed = 0;
    for (const file of toRemove) {
      try {
        await fs.unlink(path.join(this._baseDir, file));
        removed++;
      } catch {
        // Best-effort cleanup
      }
    }

    log.info({ removed, kept: keepLast }, 'Pruned old session observation files');
    return removed;
  }

  /**
   * Generate a unique observation block ID.
   */
  static generateId(): string {
    const ts = Date.now();
    const rand = Math.random().toString(36).substring(2, 8);
    return `obs_${ts}_${rand}`;
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async _readJsonlFile(filePath: string): Promise<ObservationBlock[]> {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }

    const blocks: ObservationBlock[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        blocks.push(JSON.parse(trimmed) as ObservationBlock);
      } catch {
        log.warn({ line: trimmed.substring(0, 100) }, 'Skipping malformed observation line');
      }
    }

    return blocks;
  }

  /**
   * Sanitize a session ID for use as a filename.
   * Prevents path traversal by removing slashes and dots.
   */
  private _sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}
