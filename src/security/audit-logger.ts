/**
 * AuditLogger — Hash-chained append-only audit log.
 *
 * Spec §5.5 "Audit Logger":
 *   - Append-only JSONL file
 *   - SHA-256 hash chain (each entry includes hash of previous entry)
 *   - Serialized writer queue (single-writer guarantee)
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AuditEntry, AuditEntryEventType } from './security-types.js';

const GENESIS_HASH = 'genesis';

export type AuditEntryInput = Omit<AuditEntry, 'previousHash' | 'hash' | 'entryId'>;

export interface AuditFilter {
  jobId?: string;
  eventType?: AuditEntryEventType;
  startTime?: string;
  endTime?: string;
}

export interface ChainVerificationResult {
  valid: boolean;
  entries: number;
  brokenAt?: number;
  reason?: string;
}

export class AuditLogger {
  private readonly _logPath: string;
  private _previousHash: string = GENESIS_HASH;
  private _entryCounter = 0;
  private _writeQueue: Promise<void> = Promise.resolve();
  private _initialized = false;

  constructor(auditLogPath: string) {
    this._logPath = auditLogPath;
  }

  /**
   * Append an audit entry to the log.
   * Uses a serialized writer queue so only one write happens at a time.
   */
  async log(input: AuditEntryInput): Promise<AuditEntry> {
    // Queue the write and return the entry once written
    return new Promise<AuditEntry>((resolve, reject) => {
      this._writeQueue = this._writeQueue
        .then(async () => {
          const entry = await this._appendEntry(input);
          resolve(entry);
        })
        .catch(reject);
    });
  }

  /**
   * Read all audit entries, optionally filtered.
   */
  async readEntries(filter?: AuditFilter): Promise<AuditEntry[]> {
    let content: string;
    try {
      content = await fs.readFile(this._logPath, 'utf-8');
    } catch {
      return [];
    }

    const lines = content.trim().split('\n').filter(Boolean);
    let entries = lines.map(line => JSON.parse(line) as AuditEntry);

    if (filter) {
      if (filter.jobId) {
        entries = entries.filter(e => e.jobId === filter.jobId);
      }
      if (filter.eventType) {
        entries = entries.filter(e => e.eventType === filter.eventType);
      }
      if (filter.startTime) {
        const start = filter.startTime;
        entries = entries.filter(e => e.timestamp >= start);
      }
      if (filter.endTime) {
        const end = filter.endTime;
        entries = entries.filter(e => e.timestamp <= end);
      }
    }

    return entries;
  }

  /**
   * Verify the hash chain integrity of the entire audit log.
   */
  async verifyChain(): Promise<ChainVerificationResult> {
    let content: string;
    try {
      content = await fs.readFile(this._logPath, 'utf-8');
    } catch {
      return { valid: true, entries: 0 };
    }

    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return { valid: true, entries: 0 };

    let expectedPreviousHash = GENESIS_HASH;

    for (let i = 0; i < lines.length; i++) {
      const entry = JSON.parse(lines[i]!) as AuditEntry;

      // Check previous hash link
      if (entry.previousHash !== expectedPreviousHash) {
        return {
          valid: false,
          entries: lines.length,
          brokenAt: i,
          reason: `Entry ${i} previousHash mismatch: expected ${expectedPreviousHash}, got ${entry.previousHash}`,
        };
      }

      // Recompute hash and verify
      const computedHash = this._computeHash(entry);
      if (entry.hash !== computedHash) {
        return {
          valid: false,
          entries: lines.length,
          brokenAt: i,
          reason: `Entry ${i} hash mismatch: expected ${computedHash}, got ${entry.hash}`,
        };
      }

      expectedPreviousHash = entry.hash;
    }

    return { valid: true, entries: lines.length };
  }

  // ─── Private Helpers ──────────────────────────────────────────────

  private async _ensureInitialized(): Promise<void> {
    if (this._initialized) return;

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(this._logPath), { recursive: true });

    // Read existing entries to get the last hash and counter
    try {
      const content = await fs.readFile(this._logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      if (lines.length > 0) {
        const lastEntry = JSON.parse(lines[lines.length - 1]!) as AuditEntry;
        this._previousHash = lastEntry.hash;
        this._entryCounter = lines.length;
      }
    } catch {
      // File doesn't exist yet, starting fresh
    }

    this._initialized = true;
  }

  private async _appendEntry(input: AuditEntryInput): Promise<AuditEntry> {
    await this._ensureInitialized();

    const entryId = `audit-${++this._entryCounter}`;

    // Build the entry without hash first
    const entryWithoutHash = {
      entryId,
      jobId: input.jobId,
      eventType: input.eventType,
      timestamp: input.timestamp,
      provider: input.provider,
      toolName: input.toolName,
      parameters: input.parameters,
      result: input.result,
      previousHash: this._previousHash,
    };

    const hash = this._computeHashFromParts(entryWithoutHash, this._previousHash);

    const entry: AuditEntry = {
      ...entryWithoutHash,
      hash,
    };

    // Append to file
    await fs.appendFile(this._logPath, JSON.stringify(entry) + '\n', 'utf-8');

    this._previousHash = hash;
    return entry;
  }

  private _computeHash(entry: AuditEntry): string {
    const data = {
      entryId: entry.entryId,
      jobId: entry.jobId,
      eventType: entry.eventType,
      timestamp: entry.timestamp,
      provider: entry.provider,
      toolName: entry.toolName,
      parameters: entry.parameters,
      result: entry.result,
      previousHash: entry.previousHash,
    };
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }

  private _computeHashFromParts(
    data: Omit<AuditEntry, 'hash'>,
    _previousHash: string,
  ): string {
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }
}
