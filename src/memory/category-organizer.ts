/**
 * CategoryOrganizer — Auto-categorization and dual-mode retrieval.
 *
 * Spec SS5.4 "Category Auto-Organization":
 * Assigns categories to memory items, maintains category summaries,
 * and provides dual-mode retrieval (summaries + top-N items).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { MemoryItem, CategorySummary, SalienceScore } from './memory-types.js';
import type { StructuredMemory } from './structured-memory.js';
import type { SalienceScorer } from './salience-scorer.js';

/** Maps item type to a default category prefix. */
const TYPE_PREFIX_MAP: Record<string, string> = {
  tool: 'coding',
  skill: 'coding',
  profile: 'personal',
  behavior: 'personal',
  event: 'events',
  knowledge: 'knowledge',
};

export class CategoryOrganizer {
  private readonly _categoriesDir: string;
  private readonly _summarizeFn: (items: MemoryItem[]) => Promise<string>;

  constructor(
    categoriesDir: string,
    summarizeFn: (items: MemoryItem[]) => Promise<string>,
  ) {
    this._categoriesDir = categoriesDir;
    this._summarizeFn = summarizeFn;
  }

  async init(): Promise<void> {
    await fs.mkdir(this._categoriesDir, { recursive: true, mode: 0o700 });
  }

  assignCategory(item: MemoryItem): string {
    // If item already has a meaningful category, keep it
    if (item.category && item.category.includes('/')) {
      return item.category;
    }

    const prefix = TYPE_PREFIX_MAP[item.type] ?? 'general';

    // Derive a suffix from the first tag, or use 'general'
    const suffix = item.tags.length > 0
      ? item.tags[0]!.toLowerCase().replace(/\s+/g, '-')
      : 'general';

    return `${prefix}/${suffix}`;
  }

  async getCategorySummary(category: string): Promise<CategorySummary | null> {
    const filePath = this._categoryPath(category);
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data) as CategorySummary;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async updateCategorySummary(category: string, items: MemoryItem[]): Promise<void> {
    const summary = await this._summarizeFn(items);
    const categorySummary: CategorySummary = {
      category,
      summary,
      item_count: items.length,
      last_updated: new Date().toISOString(),
      member_item_ids: items.map(i => i.id),
    };

    const filePath = this._categoryPath(category);
    const tmpPath = `${filePath}.tmp`;
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await fs.writeFile(tmpPath, JSON.stringify(categorySummary, null, 2), { mode: 0o600 });
    await fs.rename(tmpPath, filePath);
  }

  async listCategories(): Promise<CategorySummary[]> {
    const summaries: CategorySummary[] = [];
    await this._walkDir(this._categoriesDir, summaries);
    return summaries;
  }

  async getItemsByCategory(
    category: string,
    structuredMemory: StructuredMemory,
  ): Promise<MemoryItem[]> {
    return structuredMemory.listItems({ category });
  }

  /**
   * Dual-mode retrieval: category summaries (fast overview) + top-N items (deep detail).
   */
  async getDualModeContext(
    query: string,
    structuredMemory: StructuredMemory,
    scorer: SalienceScorer,
    maxCategories: number,
    maxItems: number,
  ): Promise<{ summaries: CategorySummary[]; topItems: SalienceScore[] }> {
    // Get category summaries
    const allSummaries = await this.listCategories();
    const scoredSummaries = allSummaries
      .map(s => ({
        summary: s,
        score: this._categorySummaryRelevance(query, s),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxCategories)
      .map(s => s.summary);

    // Get top-N individual items ranked by salience
    const allItems = await structuredMemory.listItems();
    const topItems = scorer.rankItems(allItems, query, maxItems);

    return { summaries: scoredSummaries, topItems };
  }

  // ── Private helpers ──────────────────────────────────────────────

  private _categorySlug(category: string): string {
    return category.replace(/\//g, '--');
  }

  private _categoryPath(category: string): string {
    return path.join(this._categoriesDir, `${this._categorySlug(category)}.json`);
  }

  private async _walkDir(dir: string, results: CategorySummary[]): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const data = await fs.readFile(path.join(dir, entry), 'utf8');
        results.push(JSON.parse(data) as CategorySummary);
      } catch {
        // Skip corrupt files
      }
    }
  }

  private _categorySummaryRelevance(query: string, summary: CategorySummary): number {
    const queryWords = query.toLowerCase().split(/\W+/).filter(w => w.length > 0);
    if (queryWords.length === 0) return 0;

    const text = `${summary.category} ${summary.summary}`.toLowerCase();
    let matches = 0;
    for (const w of queryWords) {
      if (text.includes(w)) matches++;
    }
    return matches / queryWords.length;
  }
}
