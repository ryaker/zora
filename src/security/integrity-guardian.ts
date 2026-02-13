/**
 * IntegrityGuardian — SHA-256 baseline integrity checking.
 *
 * Spec §5.5 "Integrity Guardian":
 *   - Computes SHA-256 hashes of critical configuration files
 *   - Saves baselines and detects tampering
 *   - Quarantines suspicious files
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { IntegrityBaseline } from './security-types.js';

const CRITICAL_FILES = ['SOUL.md', 'MEMORY.md', 'policy.toml', 'config.toml'];
const BASELINES_FILE = 'state/integrity-baselines.json';
const QUARANTINE_DIR = 'state/quarantine';

export interface IntegrityCheckResult {
  valid: boolean;
  mismatches: Array<{ file: string; expected: string; actual: string }>;
}

export class IntegrityGuardian {
  private readonly _baseDir: string;
  private readonly _toolRegistry: Record<string, string>;

  /**
   * @param baseDir  Root directory containing critical files (e.g. ~/.zora)
   * @param toolRegistry  Optional map of tool name → definition content to hash
   */
  constructor(baseDir: string, toolRegistry: Record<string, string> = {}) {
    this._baseDir = baseDir;
    this._toolRegistry = toolRegistry;
  }

  /**
   * Compute SHA-256 baselines for all critical files and the tool registry.
   */
  async computeBaseline(): Promise<IntegrityBaseline[]> {
    const baselines: IntegrityBaseline[] = [];
    const now = new Date().toISOString();

    for (const file of CRITICAL_FILES) {
      const filePath = path.join(this._baseDir, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        baselines.push({ filePath: file, hash, updatedAt: now });
      } catch {
        // File doesn't exist — record empty hash so we detect creation later
        baselines.push({ filePath: file, hash: 'FILE_NOT_FOUND', updatedAt: now });
      }
    }

    // Tool registry hash (combined hash of all tool definitions)
    if (Object.keys(this._toolRegistry).length > 0) {
      const registryContent = JSON.stringify(
        Object.fromEntries(Object.entries(this._toolRegistry).sort()),
      );
      const hash = crypto.createHash('sha256').update(registryContent).digest('hex');
      baselines.push({ filePath: '__tool_registry__', hash, updatedAt: now });
    }

    return baselines;
  }

  /**
   * Save computed baselines to disk.
   */
  async saveBaseline(): Promise<void> {
    const baselines = await this.computeBaseline();
    const outputPath = path.join(this._baseDir, BASELINES_FILE);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(baselines, null, 2), 'utf-8');
  }

  /**
   * Compare current file hashes against saved baselines.
   */
  async checkIntegrity(): Promise<IntegrityCheckResult> {
    const baselinesPath = path.join(this._baseDir, BASELINES_FILE);

    let savedBaselines: IntegrityBaseline[];
    try {
      const data = await fs.readFile(baselinesPath, 'utf-8');
      savedBaselines = JSON.parse(data) as IntegrityBaseline[];
    } catch {
      return { valid: false, mismatches: [{ file: BASELINES_FILE, expected: 'exists', actual: 'missing' }] };
    }

    const currentBaselines = await this.computeBaseline();
    const mismatches: Array<{ file: string; expected: string; actual: string }> = [];

    for (const saved of savedBaselines) {
      const current = currentBaselines.find(c => c.filePath === saved.filePath);
      const actualHash = current?.hash ?? 'FILE_NOT_FOUND';

      if (saved.hash !== actualHash) {
        mismatches.push({
          file: saved.filePath,
          expected: saved.hash,
          actual: actualHash,
        });
      }
    }

    return { valid: mismatches.length === 0, mismatches };
  }

  /**
   * Quarantine a file by copying it to the quarantine directory with a timestamp.
   */
  async quarantineFile(filePath: string): Promise<string> {
    const quarantineDir = path.join(this._baseDir, QUARANTINE_DIR);
    await fs.mkdir(quarantineDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const basename = path.basename(filePath);
    const quarantinePath = path.join(quarantineDir, `${basename}.${timestamp}`);

    const sourcePath = path.isAbsolute(filePath) ? filePath : path.join(this._baseDir, filePath);
    await fs.copyFile(sourcePath, quarantinePath);

    return quarantinePath;
  }
}
