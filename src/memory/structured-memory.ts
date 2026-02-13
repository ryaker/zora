/**
 * StructuredMemory — Tier 3 CRUD for memory items.
 *
 * Stores each MemoryItem as a JSON file in the items directory.
 * Uses atomic writes (write to .tmp, rename) for crash safety.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { MemoryItem, MemoryItemType } from './memory-types.js';

type CreateItemInput = Omit<MemoryItem, 'id' | 'created_at' | 'last_accessed' | 'access_count' | 'reinforcement_score'>;

export class StructuredMemory {
  private readonly _itemsDir: string;

  constructor(itemsDir: string) {
    this._itemsDir = itemsDir;
  }

  async init(): Promise<void> {
    await fs.mkdir(this._itemsDir, { recursive: true, mode: 0o700 });
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
      return item;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async updateItem(id: string, updates: Partial<MemoryItem>): Promise<MemoryItem | null> {
    try {
      const data = await fs.readFile(this._itemPath(id), 'utf8');
      const item = JSON.parse(data) as MemoryItem;
      const merged: MemoryItem = { ...item, ...updates, id }; // id is immutable
      await this._writeItem(merged);
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

  async searchItems(query: string): Promise<MemoryItem[]> {
    const items = await this._readAllItems();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return items;

    return items.filter(item => {
      const text = `${item.summary} ${item.tags.join(' ')}`.toLowerCase();
      return terms.some(term => text.includes(term));
    });
  }

  // ── Private helpers ──────────────────────────────────────────────

  private _itemPath(id: string): string {
    return path.join(this._itemsDir, `${id}.json`);
  }

  private async _writeItem(item: MemoryItem): Promise<void> {
    const filePath = this._itemPath(item.id);
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(item, null, 2), { mode: 0o600 });
    await fs.rename(tmpPath, filePath);
  }

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
      try {
        const data = await fs.readFile(path.join(this._itemsDir, file), 'utf8');
        items.push(JSON.parse(data) as MemoryItem);
      } catch {
        // Skip corrupt/unreadable files
      }
    }
    return items;
  }
}
