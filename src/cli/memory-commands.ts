/**
 * Memory CLI Commands — search, forget, and list memory categories.
 *
 * Spec §5.9 "CLI Interface" — memory subcommands.
 */

import type { Command } from 'commander';
import type { MemoryManager } from '../memory/memory-manager.js';

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
}
