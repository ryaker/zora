/**
 * MemoryManager — Hierarchical context management.
 *
 * Spec §5.4 "Memory System":
 *   - Tier 1: Long-term salience (MEMORY.md)
 *   - Tier 2: Rolling context (Daily Notes)
 *   - Tier 3: Structured items, salience, categories
 *   - Aggregates fragments into TaskContext.memoryContext
 *
 * Integrity (MEM-18):
 *   - SHA-256 baselines on MEMORY.md to detect tampering
 *   - Baselines stored in .memory-integrity.json alongside the memory dir
 *   - Mismatch logs a warning (non-fatal — user may legitimately edit)
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { MemoryConfig } from '../types.js';
import { StructuredMemory } from './structured-memory.js';
import { SalienceScorer } from './salience-scorer.js';
import { CategoryOrganizer } from './category-organizer.js';
import type { MemoryItem, CategorySummary, SalienceScore } from './memory-types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('memory-manager');

/** Lightweight stats about the memory system — no item reads. */
export interface MemoryIndex {
  itemCount: number;
  categoryNames: string[];
  mostRecentDailyNote: string | null;
  dailyNoteCount: number;
}

/** Shape of the .memory-integrity.json file. */
interface MemoryIntegrityData {
  hash: string;
  updatedAt: string;
}

const INTEGRITY_FILENAME = '.memory-integrity.json';

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

    let fileCreated = false;
    try {
      const defaultContent = '# Zora Long-term Memory\n\n- No persistent memories yet.\n';
      // Use 'wx' to atomically fail if the file already exists (preventing race conditions)
      await fs.writeFile(longTermFile, defaultContent, { mode: 0o600, flag: 'wx' });
      fileCreated = true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err;
      }
    }

    // Generate integrity baseline for newly created MEMORY.md
    if (fileCreated) {
      await this._saveIntegrityHash();
    }

    // Tier 3: Structured memory + categories
    await this._structuredMemory.init();
    await this._categoryOrganizer.init();
  }

  /** Cached memory index — invalidated on writes. */
  private _indexCache: MemoryIndex | null = null;

  /**
   * Returns a lightweight index of memory contents — no item reads.
   * Tells the LLM what's available without dumping everything into context.
   * Cached after first build; invalidated by write operations.
   */
  async getMemoryIndex(): Promise<MemoryIndex> {
    if (this._indexCache) return this._indexCache;

    // Count items via directory listing (no file reads)
    let itemCount = 0;
    try {
      const files = await fs.readdir(this._getItemsPath());
      itemCount = files.filter(f => f.endsWith('.json')).length;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    // List category names from category files
    const categories = await this._categoryOrganizer.listCategories();
    const categoryNames = categories.map(c => c.category);

    // Find most recent daily note
    let mostRecentDailyNote: string | null = null;
    let dailyNoteCount = 0;
    try {
      const files = await fs.readdir(this._getDailyNotesPath());
      const dateFiles = files
        .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .sort()
        .reverse();
      dailyNoteCount = dateFiles.length;
      if (dateFiles.length > 0) {
        mostRecentDailyNote = dateFiles[0]!.replace('.md', '');
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    this._indexCache = { itemCount, categoryNames, mostRecentDailyNote, dailyNoteCount };
    return this._indexCache;
  }

  /**
   * Loads a lightweight context string for the system prompt.
   * Instead of dumping all memory, provides a summary index that tells the LLM
   * to use tools for on-demand retrieval.
   */
  async loadContext(_days?: number): Promise<string[]> {
    const index = await this.getMemoryIndex();

    const parts: string[] = [];

    // Compact summary instead of full dump
    const catList = index.categoryNames.length > 0
      ? index.categoryNames.join(', ')
      : 'none yet';

    let summary = `[MEMORY] You have access to persistent memory:\n`;
    summary += `- ${index.itemCount} items across ${index.categoryNames.length} categories (${catList})\n`;

    if (index.mostRecentDailyNote) {
      summary += `- Daily notes available (most recent: ${index.mostRecentDailyNote}, total: ${index.dailyNoteCount})\n`;
    }

    summary += `- Use memory_search to find relevant context\n`;
    summary += `- Use recall_context to read recent daily notes\n`;
    summary += `- Use memory_save to store new facts\n`;
    summary += `Only retrieve what you need for this task.`;

    parts.push(summary);

    // Still include long-term memory (MEMORY.md) — it's typically small and curated
    const longTerm = await this._readLongTerm();
    if (longTerm) {
      parts.push(`[LONG-TERM MEMORY]:\n${longTerm}`);
    }

    return parts;
  }

  /**
   * Full context load (backward compat). Reads ALL items, daily notes, categories.
   * Use only when progressive loading is not suitable (e.g., export, migration).
   */
  async loadFullContext(days: number = this._config.context_days): Promise<string[]> {
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
   * Targeted memory recall — searches items by query using BM25 + salience.
   * This is what the LLM calls via the memory_search tool, but exposed as
   * a method for direct use by the Orchestrator.
   */
  async recallMemory(query: string, limit: number = 5): Promise<{ items: MemoryItem[]; scores: SalienceScore[] }> {
    const scores = await this.searchMemory(query, limit);
    const items: MemoryItem[] = [];

    for (const s of scores) {
      // Use peekItem for read-only access — avoids inflating access stats during search
      const item = await this._structuredMemory.peekItem(s.itemId);
      if (item) items.push(item);
    }

    return { items, scores };
  }

  /**
   * Reads only the requested number of recent daily notes.
   * Exposed for the recall_context tool.
   */
  async recallDailyNotes(days: number = 3): Promise<string[]> {
    return this._readDailyNotes(days);
  }

  /**
   * Archives daily notes older than threshold to memory/daily/archive/.
   * Appends a summary header to MEMORY.md noting the archived date range.
   * Archived notes remain on disk in the archive/ subdirectory for manual
   * review but are excluded from the active daily notes directory.
   *
   * If a reflectFn is provided, it will be called with the combined content
   * of notes being archived. This enables extracting structured memory items
   * from daily notes before they are moved to the archive.
   *
   * @param thresholdDays Notes older than this are archived (default: 7)
   * @param reflectFn Optional function to extract memory from notes before archiving
   * @returns Number of notes archived
   */
  async consolidateDailyNotes(
    thresholdDays: number = 7,
    reflectFn?: (notesContent: string) => Promise<void>,
  ): Promise<number> {
    const dir = this._getDailyNotesPath();
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw err;
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - thresholdDays);
    const cutoffStr = cutoff.toISOString().split('T')[0]!;

    const oldFiles = files
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .filter(f => f.replace('.md', '') < cutoffStr)
      .sort();

    if (oldFiles.length === 0) return 0;

    // Run reflector on note content before archiving (extract structured memory)
    if (reflectFn) {
      try {
        const noteContents: string[] = [];
        for (const file of oldFiles) {
          try {
            const content = await fs.readFile(path.join(dir, file), 'utf8');
            noteContents.push(`--- ${file} ---\n${content}`);
          } catch {
            // Skip unreadable files
          }
        }
        if (noteContents.length > 0) {
          await reflectFn(noteContents.join('\n\n'));
        }
      } catch (err) {
        log.warn({ err }, 'Reflector pass on daily notes failed, continuing with archive');
      }
    }

    // Archive old files (moved, not deleted — still accessible for manual review)
    const archiveDir = path.join(dir, 'archive');
    await fs.mkdir(archiveDir, { recursive: true, mode: 0o700 });
    for (const file of oldFiles) {
      try {
        await fs.rename(path.join(dir, file), path.join(archiveDir, file));
      } catch {
        // Best-effort archive
      }
    }

    // Append a consolidation summary to MEMORY.md
    const consolidationSummary = `\n## Archived ${oldFiles.length} daily notes (${oldFiles[0]!.replace('.md', '')} to ${oldFiles[oldFiles.length - 1]!.replace('.md', '')})\n`;
    const ltPath = this._getLongTermPath();
    try {
      await fs.appendFile(ltPath, consolidationSummary, { mode: 0o600 });
      await this._saveIntegrityHash();
    } catch {
      // Best-effort
    }

    // Invalidate index cache
    this._indexCache = null;

    log.info({ archived: oldFiles.length, thresholdDays }, 'Daily notes archived');
    return oldFiles.length;
  }

  /** Invalidate the cached memory index (call after writes). */
  invalidateIndex(): void {
    this._indexCache = null;
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

    this._indexCache = null; // Invalidate index on daily note write
  }

  /**
   * Searches structured memory items by query, ranked by salience.
   * Uses MiniSearch BM25+ scores composed with salience factors.
   */
  async searchMemory(query: string, limit?: number): Promise<SalienceScore[]> {
    const results = await this._structuredMemory.searchItemsWithScores(query);
    const scored = results.map(({ item, bm25Score }) =>
      this._scorer.scoreItem(item, query, bm25Score),
    );
    scored.sort((a, b) => b.score - a.score);
    return limit !== undefined ? scored.slice(0, limit) : scored;
  }

  /**
   * Soft-deletes a structured memory item by ID.
   * Moves the item to an archive directory before removing.
   */
  async forgetItem(id: string, reason?: string): Promise<boolean> {
    // Use getItem for direct lookup instead of listItems + find
    const item = await this._structuredMemory.getItem(id);

    if (item) {
      const archiveDir = path.join(this._baseDir, 'memory', 'archive');
      try {
        await fs.mkdir(archiveDir, { recursive: true, mode: 0o700 });
        const archiveData = {
          ...item,
          archived_at: new Date().toISOString(),
          archive_reason: reason ?? 'No reason provided',
        };
        await fs.writeFile(
          path.join(archiveDir, `${id}.json`),
          JSON.stringify(archiveData, null, 2),
          { mode: 0o600 },
        );
      } catch {
        // Archive is best-effort
      }
    }

    this._indexCache = null; // Invalidate index on delete
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

  /**
   * Returns the resolved path to the long-term memory file (MEMORY.md).
   */
  getLongTermPath(): string {
    return this._getLongTermPath();
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
      const content = await fs.readFile(this._getLongTermPath(), 'utf8');

      // Verify integrity hash (non-fatal on mismatch)
      await this._verifyIntegrityHash(content);

      return content;
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

  // ─── Integrity Hashing (MEM-18) ──────────────────────────────────

  /** Path to the integrity baseline file alongside the memory directory. */
  private _getIntegrityPath(): string {
    return path.join(path.dirname(this._getLongTermPath()), INTEGRITY_FILENAME);
  }

  /** Compute SHA-256 hash of the given content. */
  private _computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Saves a SHA-256 baseline for the current MEMORY.md content.
   * Called after any write to MEMORY.md.
   */
  async _saveIntegrityHash(): Promise<void> {
    try {
      const content = await fs.readFile(this._getLongTermPath(), 'utf8');
      const data: MemoryIntegrityData = {
        hash: this._computeHash(content),
        updatedAt: new Date().toISOString(),
      };
      await fs.writeFile(
        this._getIntegrityPath(),
        JSON.stringify(data, null, 2),
        { mode: 0o600 },
      );
    } catch (err) {
      log.warn({ err }, 'Failed to save memory integrity hash');
    }
  }

  /**
   * Verifies the current MEMORY.md content against the stored hash baseline.
   * Logs a warning on mismatch but does not throw (the file may have been
   * legitimately edited by the user).
   */
  private async _verifyIntegrityHash(content: string): Promise<boolean> {
    try {
      const raw = await fs.readFile(this._getIntegrityPath(), 'utf8');
      const data = JSON.parse(raw) as MemoryIntegrityData;
      const currentHash = this._computeHash(content);

      if (data.hash !== currentHash) {
        log.warn(
          {
            expected: data.hash,
            actual: currentHash,
            baselineDate: data.updatedAt,
          },
          'MEMORY.md integrity mismatch: file may have been modified externally',
        );
        return false;
      }

      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // No baseline yet — first run or baseline was deleted
        log.info('No memory integrity baseline found; skipping verification');
        return true;
      }
      log.warn({ err }, 'Failed to verify memory integrity hash');
      return true; // Don't block on verification errors
    }
  }

  /**
   * Refreshes the integrity baseline for MEMORY.md.
   * Call this after legitimate external edits to acknowledge the new content.
   */
  async refreshIntegrityBaseline(): Promise<void> {
    await this._saveIntegrityHash();
  }
}
