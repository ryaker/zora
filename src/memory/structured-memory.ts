/**
 * StructuredMemory — Tier 3 CRUD for memory items.
 *
 * Stores each MemoryItem as a JSON file in the items directory.
 * Uses atomic writes (write to .tmp, rename) for crash safety.
 * Search uses MiniSearch BM25+ for ranked full-text retrieval.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import MiniSearch from 'minisearch';
import { writeAtomic } from '../utils/fs.js';
import type { MemoryItem, MemoryItemType } from './memory-types.js';

type CreateItemInput = Omit<MemoryItem, 'id' | 'created_at' | 'last_accessed' | 'access_count' | 'reinforcement_score'>;

export interface SearchResult {
  item: MemoryItem;
  bm25Score: number;
}

/** Document shape indexed by MiniSearch */
interface IndexedDoc {
  id: string;
  summary: string;
  tags: string;
  category: string;
}

export class StructuredMemory {
  private readonly _itemsDir: string;
  private readonly _indexDir: string;
  private _searchIndex: MiniSearch<IndexedDoc>;
  /**
   * Bounded in-memory item cache, keyed by item id.
   *
   * MEM/PERF: `listItems()` -> `_readAllItems()` used to be one `readFile` +
   * `JSON.parse` per item on every call, and `CategoryOrganizer` calls it
   * repeatedly (`getDualModeContext`, `getItemsByCategory`). The cache turns the
   * steady state into a single `readdir` plus cache lookups.
   *
   * It is an accelerator, not a source of truth: `readdir` always decides which
   * items exist, so creations and deletions made by anything else are picked up,
   * and a cache miss (cold start, or an entry evicted by the size cap) simply
   * falls back to reading the file.
   */
  private _itemCache: Map<string, MemoryItem> = new Map();
  private _indexReady = false;

  /** Cap on cached items — bounds memory for very large stores. Insertion-ordered eviction. */
  private static readonly MAX_CACHED_ITEMS = 5000;

  constructor(itemsDir: string, indexDir?: string) {
    this._itemsDir = itemsDir;
    this._indexDir = indexDir ?? path.join(path.dirname(itemsDir), 'index');
    this._searchIndex = this._createIndex();
  }

  async init(): Promise<void> {
    await fs.mkdir(this._itemsDir, { recursive: true, mode: 0o700 });
    await fs.mkdir(this._indexDir, { recursive: true, mode: 0o700 });

    // Try loading serialized index, fall back to rebuild
    const loaded = await this._loadIndex();
    if (!loaded) {
      await this.rebuildIndex();
    }
    this._indexReady = true;
  }

  async createItem(input: CreateItemInput): Promise<MemoryItem> {
    const now = new Date().toISOString();
    const item: MemoryItem = {
      ...input,
      id: `mem_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      created_at: now,
      last_accessed: now,
      access_count: 0,
      reinforcement_score: 0,
    };
    await this._writeItem(item);
    this._addToIndex(item);
    this._cacheItem(item);
    // Persist index so cold starts don't need full rebuild
    await this._saveIndex();
    return item;
  }

  async getItem(id: string): Promise<MemoryItem | null> {
    try {
      const data = await fs.readFile(this._itemPath(id), 'utf8');
      const item = JSON.parse(data) as MemoryItem;
      // Bump access stats
      item.access_count += 1;
      item.last_accessed = new Date().toISOString();
      await this._writeItem(item);
      this._cacheItem(item);
      return item;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Read-only item access — does NOT update access_count or last_accessed.
   * Use this for search results where you need the item data but don't want
   * to inflate access statistics or trigger disk writes.
   */
  async peekItem(id: string): Promise<MemoryItem | null> {
    // Check cache first
    const cached = this._itemCache.get(id);
    if (cached) return cached;
    // Read from disk without side effects
    const item = await this._readItemFile(id);
    if (item) this._cacheItem(item);
    return item;
  }

  async updateItem(id: string, updates: Partial<MemoryItem>): Promise<MemoryItem | null> {
    try {
      const data = await fs.readFile(this._itemPath(id), 'utf8');
      const item = JSON.parse(data) as MemoryItem;
      const merged: MemoryItem = { ...item, ...updates, id }; // id is immutable
      await this._writeItem(merged);
      this._updateIndex(merged);
      return merged;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async deleteItem(id: string): Promise<boolean> {
    try {
      await fs.unlink(this._itemPath(id));
      this._removeFromIndex(id);
      await this._saveIndex();
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  }

  async listItems(filter?: {
    type?: MemoryItemType;
    category?: string;
    tags?: string[];
  }): Promise<MemoryItem[]> {
    const items = await this._readAllItems();
    if (!filter) return items;

    return items.filter(item => {
      if (filter.type && item.type !== filter.type) return false;
      if (filter.category && item.category !== filter.category) return false;
      if (filter.tags && filter.tags.length > 0) {
        const hasAllTags = filter.tags.every(t => item.tags.includes(t));
        if (!hasAllTags) return false;
      }
      return true;
    });
  }

  /**
   * BM25+ search via MiniSearch. Returns items with their BM25 scores.
   */
  async searchItems(query: string): Promise<MemoryItem[]> {
    if (!this._indexReady) {
      await this.rebuildIndex();
      this._indexReady = true;
    }

    const terms = query.trim();
    if (terms.length === 0) {
      return this._readAllItems();
    }

    const results = this._searchIndex.search(terms, {
      boost: { tags: 2.0, category: 1.5, summary: 1.0 },
      fuzzy: 0.2,
      prefix: true,
      combineWith: 'OR',
    });

    const items: MemoryItem[] = [];
    for (const result of results) {
      const cached = this._itemCache.get(result.id);
      if (cached) {
        items.push(cached);
      } else {
        const item = await this._readItemFile(result.id);
        if (item) {
          this._cacheItem(item);
          items.push(item);
        }
      }
    }
    return items;
  }

  /**
   * BM25+ search returning items paired with their BM25 scores.
   * Use this when you need scores for salience composition.
   */
  async searchItemsWithScores(query: string): Promise<SearchResult[]> {
    if (!this._indexReady) {
      await this.rebuildIndex();
      this._indexReady = true;
    }

    const terms = query.trim();
    if (terms.length === 0) {
      const items = await this._readAllItems();
      return items.map(item => ({ item, bm25Score: 1.0 }));
    }

    const results = this._searchIndex.search(terms, {
      boost: { tags: 2.0, category: 1.5, summary: 1.0 },
      fuzzy: 0.2,
      prefix: true,
      combineWith: 'OR',
    });

    const searchResults: SearchResult[] = [];
    for (const result of results) {
      const cached = this._itemCache.get(result.id);
      const item = cached ?? await this._readItemFile(result.id);
      if (item) {
        this._cacheItem(item);
        searchResults.push({ item, bm25Score: result.score });
      }
    }
    return searchResults;
  }

  /**
   * Rebuild the MiniSearch index from all items on disk.
   */
  async rebuildIndex(): Promise<void> {
    this._searchIndex = this._createIndex();
    this._itemCache.clear();

    const items = await this._readAllItems();
    for (const item of items) {
      this._cacheItem(item);
      this._addToIndex(item);
    }

    await this._saveIndex();
  }

  // ── Private helpers ──────────────────────────────────────────────

  private _createIndex(): MiniSearch<IndexedDoc> {
    return new MiniSearch<IndexedDoc>({
      fields: ['summary', 'tags', 'category'],
      storeFields: ['id'],
      tokenize: (text) => text.toLowerCase().split(/[\s\-_./]+/).filter(t => t.length > 0),
    });
  }

  private _toIndexDoc(item: MemoryItem): IndexedDoc {
    return {
      id: item.id,
      summary: item.summary,
      tags: item.tags.join(' '),
      category: item.category,
    };
  }

  private _addToIndex(item: MemoryItem): void {
    try {
      this._searchIndex.add(this._toIndexDoc(item));
    } catch {
      // Document already in index — replace it
      this._updateIndex(item);
    }
  }

  private _updateIndex(item: MemoryItem): void {
    try {
      this._searchIndex.replace(this._toIndexDoc(item));
    } catch {
      // If replace fails (not in index), add it
      try {
        this._searchIndex.add(this._toIndexDoc(item));
      } catch {
        // Already exists, ignore
      }
    }
    this._cacheItem(item);
  }

  private _removeFromIndex(id: string): void {
    try {
      this._searchIndex.discard(id);
    } catch {
      // Not in index, ignore
    }
    this._itemCache.delete(id);
  }

  private async _saveIndex(): Promise<void> {
    const indexPath = path.join(this._indexDir, 'minisearch.json');
    try {
      const json = JSON.stringify(this._searchIndex.toJSON());
      await writeAtomic(indexPath, json);
    } catch {
      // Index save is best-effort; can always rebuild
    }
  }

  private async _loadIndex(): Promise<boolean> {
    const indexPath = path.join(this._indexDir, 'minisearch.json');
    try {
      const data = await fs.readFile(indexPath, 'utf8');
      const json = JSON.parse(data);
      this._searchIndex = MiniSearch.loadJSON<IndexedDoc>(JSON.stringify(json), {
        fields: ['summary', 'tags', 'category'],
        storeFields: ['id'],
        tokenize: (text: string) => text.toLowerCase().split(/[\s\-_./]+/).filter(t => t.length > 0),
      });

      // Validate: compare index document count against file count on disk
      // (lightweight readdir, not full item read) to detect stale indexes.
      let fileCount = 0;
      try {
        const files = await fs.readdir(this._itemsDir);
        fileCount = files.filter(f => f.endsWith('.json')).length;
      } catch {
        // If dir missing, count is 0
      }

      if (fileCount !== this._searchIndex.documentCount) {
        return false; // triggers rebuildIndex() in init()
      }

      return true;
    } catch {
      return false;
    }
  }

  private _itemPath(id: string): string {
    // Validate id to prevent path traversal
    if (/[/\\]/.test(id) || id.includes('..')) {
      throw new Error(`Invalid item id: ${id}`);
    }
    return path.join(this._itemsDir, `${id}.json`);
  }

  private async _writeItem(item: MemoryItem): Promise<void> {
    const filePath = this._itemPath(item.id);
    await writeAtomic(filePath, JSON.stringify(item, null, 2));
  }

  private async _readItemFile(id: string): Promise<MemoryItem | null> {
    try {
      const data = await fs.readFile(this._itemPath(id), 'utf8');
      return JSON.parse(data) as MemoryItem;
    } catch {
      return null;
    }
  }

  /**
   * Insert into the bounded cache, evicting the oldest entry when over the cap.
   * Re-inserting an existing key refreshes its position so hot items survive.
   */
  private _cacheItem(item: MemoryItem): void {
    if (this._itemCache.has(item.id)) {
      this._itemCache.delete(item.id);
    }
    this._itemCache.set(item.id, item);
    while (this._itemCache.size > StructuredMemory.MAX_CACHED_ITEMS) {
      const oldest = this._itemCache.keys().next();
      if (oldest.done) break;
      this._itemCache.delete(oldest.value);
    }
  }

  /**
   * Read every item. `readdir` remains authoritative for which items exist —
   * only the per-item `readFile` + `JSON.parse` is served from cache. Corrupt
   * or unreadable files are still skipped rather than being fatal.
   */
  private async _readAllItems(): Promise<MemoryItem[]> {
    let files: string[];
    try {
      files = await fs.readdir(this._itemsDir);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }

    const items: MemoryItem[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const id = file.slice(0, -'.json'.length);
      const cached = this._itemCache.get(id);
      if (cached) {
        items.push(cached);
        continue;
      }

      try {
        const data = await fs.readFile(path.join(this._itemsDir, file), 'utf8');
        const item = JSON.parse(data) as MemoryItem;
        // Only cache when the file name matches the item's own id, so a
        // hand-written or renamed file can never be served under the wrong key.
        if (item && item.id === id) this._cacheItem(item);
        items.push(item);
      } catch {
        // Skip corrupt/unreadable files
      }
    }
    return items;
  }
}
