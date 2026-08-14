/**
 * Filesystem Utilities — Helper functions for safe I/O.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Writes a file atomically using the write-then-rename pattern.
 * This prevents data corruption during concurrent access or system crashes.
 */
export async function writeAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  
  try {
    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    
    // Write to temporary file
    await fs.promises.writeFile(tempPath, content, 'utf8');
    
    // Rename temporary file to target path (atomic operation on most POSIX systems)
    await fs.promises.rename(tempPath, filePath);
  } catch (err) {
    // Cleanup temporary file if it exists and rename failed
    if (fs.existsSync(tempPath)) {
      try { await fs.promises.unlink(tempPath); } catch {}
    }
    throw err;
  }
}

/**
 * Expands a leading `~` to the user's home directory and returns an absolute path.
 *
 * PROV-10. Config paths like `agent.workspace` are written the way a human types
 * them (`~/work`), and `~` means nothing to any filesystem call — an unexpanded
 * path silently becomes a literal `./~` directory relative to wherever the
 * process happened to start.
 *
 * Returns `fallback` (default: process.cwd()) for an empty/undefined input.
 */
export function expandHome(inputPath?: string, fallback: string = process.cwd()): string {
  if (!inputPath || inputPath.trim().length === 0) return fallback;
  const expanded = inputPath.startsWith('~')
    ? path.join(os.homedir(), inputPath.slice(1))
    : inputPath;
  return path.resolve(expanded);
}
