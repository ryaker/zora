/**
 * Memory CLI Commands — search, forget, list, edit, export, import, stats.
 *
 * Spec §5.9 "CLI Interface" — memory subcommands.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import type { Command } from 'commander';
import type { MemoryManager } from '../memory/memory-manager.js';
import type { MemoryItem } from '../memory/memory-types.js';

const MS_PER_DAY = 86_400_000;
const DEDUP_THRESHOLD = 0.8;

export function registerMemoryCommands(
  program: Command,
  setupContext: () => Promise<{ memoryManager: MemoryManager }>,
): void {
  const memory = program.command('memory').description('Manage agent memory');

  memory
    .command('search <query>')
    .description('Search memory items by keyword')
    .option('-n, --limit <n>', 'Max results', '10')
    .action(async (query: string, opts: { limit: string }) => {
      const { memoryManager } = await setupContext();
      const results = await memoryManager.searchMemory(query, parseInt(opts.limit, 10));

      if (results.length === 0) {
        console.log('No memory items found.');
        return;
      }

      console.log(`Found ${results.length} result(s):\n`);
      for (const r of results) {
        console.log(`  [${r.itemId}] score=${r.score.toFixed(2)}`);
        console.log(`    access=${r.components.accessWeight.toFixed(2)} recency=${r.components.recencyDecay.toFixed(2)} relevance=${r.components.relevanceScore.toFixed(2)}`);
        console.log();
      }
    });

  memory
    .command('forget <id>')
    .description('Delete a memory item')
    .action(async (id: string) => {
      const { memoryManager } = await setupContext();
      const deleted = await memoryManager.forgetItem(id);
      if (deleted) {
        console.log(`Deleted memory item: ${id}`);
      } else {
        console.log(`Memory item not found: ${id}`);
      }
    });

  memory
    .command('categories')
    .description('List memory categories')
    .action(async () => {
      const { memoryManager } = await setupContext();
      const categories = await memoryManager.getCategories();

      if (categories.length === 0) {
        console.log('No categories found.');
        return;
      }

      console.log(`${categories.length} categorie(s):\n`);
      for (const cat of categories) {
        console.log(`  [${cat.category}] ${cat.item_count} items — ${cat.summary}`);
        console.log(`    last updated: ${cat.last_updated}`);
        console.log();
      }
    });

  memory
    .command('edit')
    .description('Open MEMORY.md in $EDITOR')
    .action(async () => {
      const { memoryManager } = await setupContext();
      const longTermPath = memoryManager.getLongTermPath();

      try {
        await fs.access(longTermPath);
      } catch {
        console.error(`Memory file not found: ${longTermPath}`);
        console.error('Run "zora init" to initialize the memory directory.');
        process.exitCode = 1;
        return;
      }

      const editor = process.env.EDITOR || 'vi';
      try {
        const parts = editor.split(/\s+/).filter(Boolean);
        const cmd = parts[0] ?? 'vi';
        execFileSync(cmd, [...parts.slice(1), longTermPath], { stdio: 'inherit' });
      } catch (err) {
        console.error(`Failed to open editor: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  memory
    .command('export')
    .description('Export all structured memory items as JSON')
    .action(async () => {
      const { memoryManager } = await setupContext();
      const items = await memoryManager.structuredMemory.listItems();
      console.log(JSON.stringify(items, null, 2));
    });

  memory
    .command('import <file>')
    .description('Import memory items from a JSON file')
    .action(async (file: string) => {
      const { memoryManager } = await setupContext();

      let raw: string;
      try {
        raw = await fs.readFile(file, 'utf8');
      } catch (err) {
        console.error(`Failed to read file: ${(err as Error).message}`);
        process.exitCode = 1;
        return;
      }

      let items: MemoryItem[];
      try {
        items = JSON.parse(raw);
      } catch {
        console.error('Invalid JSON: file must contain an array of memory items.');
        process.exitCode = 1;
        return;
      }

      if (!Array.isArray(items)) {
        console.error('Invalid format: file must contain a JSON array.');
        process.exitCode = 1;
        return;
      }

      // Deduplicate against existing items
      const existingItems = await memoryManager.structuredMemory.listItems();
      const dedupedItems = _deduplicateItems(items, existingItems);

      let imported = 0;
      let skipped = items.length - dedupedItems.length;
      let failed = 0;
      for (const item of dedupedItems) {
        try {
          await memoryManager.structuredMemory.createItem({
            type: item.type,
            summary: item.summary,
            source: item.source,
            source_type: item.source_type,
            tags: item.tags || [],
            category: item.category || 'uncategorized',
          });
          imported++;
        } catch (err) {
          console.error(`Failed to import item: ${(err as Error).message}`);
          failed++;
        }
      }

      console.log(`Imported ${imported} item(s).`);
      if (skipped > 0) {
        console.log(`Skipped ${skipped} duplicate item(s).`);
      }
      if (failed > 0) {
        console.log(`Failed to import ${failed} item(s).`);
      }
    });

  memory
    .command('stats')
    .description('Show memory statistics')
    .action(async () => {
      const { memoryManager } = await setupContext();
      const items = await memoryManager.structuredMemory.listItems();
      const categories = await memoryManager.getCategories();

      console.log('Memory Statistics\n');

      // Total
      console.log(`Total items: ${items.length}`);
      console.log(`Categories:  ${categories.length}`);
      console.log();

      // By type
      const byType = new Map<string, number>();
      for (const item of items) {
        byType.set(item.type, (byType.get(item.type) || 0) + 1);
      }
      if (byType.size > 0) {
        console.log('By type:');
        for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
          console.log(`  ${type}: ${count}`);
        }
        console.log();
      }

      // By category
      const byCategory = new Map<string, number>();
      for (const item of items) {
        byCategory.set(item.category, (byCategory.get(item.category) || 0) + 1);
      }
      if (byCategory.size > 0) {
        console.log('By category:');
        for (const [cat, count] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
          console.log(`  ${cat}: ${count}`);
        }
        console.log();
      }

      // By age
      const now = Date.now();
      let today = 0, week = 0, month = 0, older = 0;
      for (const item of items) {
        const age = now - new Date(item.created_at).getTime();
        if (age < MS_PER_DAY) today++;
        else if (age < 7 * MS_PER_DAY) week++;
        else if (age < 30 * MS_PER_DAY) month++;
        else older++;
      }
      console.log('By age:');
      console.log(`  Today:      ${today}`);
      console.log(`  This week:  ${week}`);
      console.log(`  This month: ${month}`);
      console.log(`  Older:      ${older}`);
    });

  memory
    .command('list')
    .description('List recent memory items')
    .option('-n, --limit <n>', 'Number of items to show', '10')
    .action(async (opts: { limit: string }) => {
      const { memoryManager } = await setupContext();
      const items = await memoryManager.structuredMemory.listItems();

      if (items.length === 0) {
        console.log('No memory items found.');
        return;
      }

      // Sort by created_at descending (most recent first)
      const sorted = items
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, parseInt(opts.limit, 10));

      console.log(`Showing ${sorted.length} of ${items.length} item(s):\n`);
      for (const item of sorted) {
        const date = item.created_at.split('T')[0];
        console.log(`  [${item.id}] (${item.type}) ${date}`);
        console.log(`    ${item.summary}`);
        const tagList = item.tags && item.tags.length > 0 ? item.tags.join(', ') : 'none';
        console.log(`    category=${item.category} tags=${tagList}`);
        console.log();
      }
    });
}

// ── Helper functions ──────────────────────────────────────────────

/**
 * Deduplicate items using Jaccard similarity on word sets.
 * Filters out items whose summary is too similar to existing items.
 */
function _deduplicateItems(newItems: MemoryItem[], existingItems: MemoryItem[]): MemoryItem[] {
  return newItems.filter(newItem => {
    const newWords = _wordSet(newItem.summary);
    return !existingItems.some(existing => {
      const existingWords = _wordSet(existing.summary);
      return _jaccardSimilarity(newWords, existingWords) > DEDUP_THRESHOLD;
    });
  });
}

/**
 * Convert text to a normalized word set (lowercase, non-word boundaries).
 */
function _wordSet(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/\W+/).filter(w => w.length > 0),
  );
}

/**
 * Compute Jaccard similarity between two word sets.
 */
function _jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
