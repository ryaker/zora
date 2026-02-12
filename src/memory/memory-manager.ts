/**
 * MemoryManager — Hierarchical context management.
 *
 * Spec §5.4 "Memory System":
 *   - Tier 1: Long-term salience (MEMORY.md)
 *   - Tier 2: Rolling context (Daily Notes)
 *   - Aggregates fragments into TaskContext.memoryContext
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { MemoryConfig } from '../types.js';

export class MemoryManager {
  private readonly _config: MemoryConfig;
  private readonly _baseDir: string;

  constructor(config: MemoryConfig, baseDir: string = path.join(os.homedir(), '.zora')) {
    this._config = config;
    this._baseDir = baseDir;
  }

  /**
   * Initializes memory directories.
   */
  async init(): Promise<void> {
    const dailyNotesDir = this._getDailyNotesPath();
    await fs.mkdir(dailyNotesDir, { recursive: true, mode: 0o700 });
    
    const longTermFile = this._getLongTermPath();
    const longTermDir = path.dirname(longTermFile);
    await fs.mkdir(longTermDir, { recursive: true, mode: 0o700 });

    try {
      const defaultContent = '# Zora Long-term Memory\n\n- No persistent memories yet.\n';
      // Use 'wx' to atomically fail if the file already exists (preventing race conditions)
      await fs.writeFile(longTermFile, defaultContent, { mode: 0o600, flag: 'wx' });
    } catch (err: any) {
      if (err.code !== 'EEXIST') {
        throw err;
      }
    }
  }

  /**
   * Loads context for a new task based on tiers.
   */
  async loadContext(days: number = this._config.context_days): Promise<string[]> {
    const context: string[] = [];

    // Tier 1: Long-term salience
    const tier1 = await this._readLongTerm();
    if (tier1) context.push(`[LONG-TERM MEMORY]:\n${tier1}`);

    // Tier 2: Rolling context (last N days of notes)
    const tier2 = await this._readDailyNotes(days);
    if (tier2.length > 0) {
      context.push(`[RECENT CONTEXT]:\n${tier2.join('\n\n')}`);
    }

    return context;
  }

  /**
   * Appends an entry to today's daily note.
   */
  async appendDailyNote(text: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const filePath = path.join(this._getDailyNotesPath(), `${today}.md`);
    const entry = `\n### ${new Date().toLocaleTimeString()}\n${text}\n`;
    
    try {
      await fs.appendFile(filePath, entry, { mode: 0o600 });
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        // Create file with header if it doesn't exist
        await fs.writeFile(filePath, `# Daily Notes: ${today}\n${entry}`, { mode: 0o600 });
      } else {
        throw err;
      }
    }
  }

  private _resolvePath(p: string): string {
    if (p.startsWith('~/')) {
      return path.join(os.homedir(), p.slice(2));
    }
    return p;
  }

  private _getLongTermPath(): string {
    const resolved = this._resolvePath(this._config.long_term_file);
    return path.isAbsolute(resolved)
      ? resolved
      : path.join(this._baseDir, resolved);
  }

  private _getDailyNotesPath(): string {
    const resolved = this._resolvePath(this._config.daily_notes_dir);
    return path.isAbsolute(resolved)
      ? resolved
      : path.join(this._baseDir, resolved);
  }

  private async _readLongTerm(): Promise<string | null> {
    try {
      return await fs.readFile(this._getLongTermPath(), 'utf8');
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  private async _readDailyNotes(days: number): Promise<string[]> {
    const notes: string[] = [];
    const dir = this._getDailyNotesPath();
    
    try {
      const files = await fs.readdir(dir);
      const dateFiles = files
        .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .sort()
        .reverse()
        .slice(0, days);

      for (const file of dateFiles) {
        const content = await fs.readFile(path.join(dir, file), 'utf8');
        notes.push(`--- ${file} ---\n${content}`);
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }

    return notes;
  }
}
