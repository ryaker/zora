/**
 * MemoryManager — Hierarchical context management.
 *
 * Spec §5.4 "Memory System":
 *   - Tier 1: Long-term salience (MEMORY.md)
 *   - Tier 2: Rolling context (Daily Notes)
 *   - Tier 3: Structured items, salience, categories
 *   - Aggregates fragments into TaskContext.memoryContext
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { MemoryConfig } from '../types.js';
import { StructuredMemory } from './structured-memory.js';
import { SalienceScorer } from './salience-scorer.js';
import { CategoryOrganizer } from './category-organizer.js';
import type { MemoryItem, CategorySummary, SalienceScore } from './memory-types.js';

export class MemoryManager {
  private readonly _config: MemoryConfig;
  private readonly _baseDir: string;
  private _structuredMemory: StructuredMemory;
  private _scorer: SalienceScorer;
  private _categoryOrganizer: CategoryOrganizer;

  constructor(
    config: MemoryConfig,
    baseDir: string = path.join(os.homedir(), '.zora'),
    summarizeFn?: (items: MemoryItem[]) => Promise<string>,
  ) {
    this._config = config;
    this._baseDir = baseDir;
    this._structuredMemory = new StructuredMemory(this._getItemsPath());
    this._scorer = new SalienceScorer();
    this._categoryOrganizer = new CategoryOrganizer(
      this._getCategoriesPath(),
      summarizeFn ?? (async (items) => `${items.length} items in category`),
    );
  }

  /**
   * Initializes memory directories (Tiers 1-3).
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
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err;
      }
    }

    // Tier 3: Structured memory + categories
    await this._structuredMemory.init();
    await this._categoryOrganizer.init();
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

    // Tier 3: Category summaries + top-N salience-ranked items
    const { summaries, topItems } = await this._categoryOrganizer.getDualModeContext(
      '', // empty query for general context loading
      this._structuredMemory,
      this._scorer,
      this._config.max_category_summaries,
      this._config.max_context_items,
    );

    if (summaries.length > 0) {
      const catLines = summaries.map(s => `- [${s.category}]: ${s.summary}`).join('\n');
      context.push(`[CATEGORY SUMMARIES]:\n${catLines}`);
    }

    if (topItems.length > 0) {
      const allItems = await this._structuredMemory.listItems();
      const itemMap = new Map(allItems.map(i => [i.id, i]));
      const itemLines = topItems
        .map(s => {
          const item = itemMap.get(s.itemId);
          return item ? `- [${item.type}] ${item.summary} (salience: ${s.score.toFixed(2)})` : null;
        })
        .filter(Boolean)
        .join('\n');
      if (itemLines) {
        context.push(`[MEMORY ITEMS]:\n${itemLines}`);
      }
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
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Create file with header if it doesn't exist
        await fs.writeFile(filePath, `# Daily Notes: ${today}\n${entry}`, { mode: 0o600 });
      } else {
        throw err;
      }
    }
  }

  /**
   * Searches structured memory items by query, ranked by salience.
   */
  async searchMemory(query: string, limit?: number): Promise<SalienceScore[]> {
    const items = await this._structuredMemory.searchItems(query);
    return this._scorer.rankItems(items, query, limit);
  }

  /**
   * Deletes a structured memory item by ID.
   */
  async forgetItem(id: string): Promise<boolean> {
    return this._structuredMemory.deleteItem(id);
  }

  /**
   * Returns all category summaries.
   */
  async getCategories(): Promise<CategorySummary[]> {
    return this._categoryOrganizer.listCategories();
  }

  /**
   * Exposes the underlying StructuredMemory for direct access.
   */
  get structuredMemory(): StructuredMemory {
    return this._structuredMemory;
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

  private _getItemsPath(): string {
    const resolved = this._resolvePath(this._config.items_dir);
    return path.isAbsolute(resolved)
      ? resolved
      : path.join(this._baseDir, resolved);
  }

  private _getCategoriesPath(): string {
    const resolved = this._resolvePath(this._config.categories_dir);
    return path.isAbsolute(resolved)
      ? resolved
      : path.join(this._baseDir, resolved);
  }

  private async _readLongTerm(): Promise<string | null> {
    try {
      return await fs.readFile(this._getLongTermPath(), 'utf8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
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
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    return notes;
  }
}
