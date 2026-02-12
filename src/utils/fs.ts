/**
 * Filesystem Utilities — Helper functions for safe I/O.
 */

import fs from 'node:fs';
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
