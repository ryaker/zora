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
import { createLogger } from '../utils/logger.js';

const log = createLogger('audit-logger');
const GENESIS_HASH = 'genesis';

export type AuditEntryInput = Omit<AuditEntry, 'previousHash' | 'hash' | 'entryId'>;

export interface AuditLoggerOptions {
  /**
   * When true (default), every entry includes a SHA-256 hash of the previous entry,
   * forming a tamper-evident chain. Set false to disable hash chaining (log entries
   * are written without hash fields, losing chain integrity guarantees).
   * Maps to security.audit_hash_chain in config.
   */
  hashChain?: boolean;
  /**
   * Reserved for future use. Currently ignored: all writes are always serialised
   * through a single Promise queue because _appendEntry() mutates shared state
   * (_initialized, _entryCounter, _previousHash) that is not safe for concurrent
   * access. Setting this to false emits a warning and has no effect.
   * Maps to security.audit_single_writer in config.
   */
  singleWriter?: boolean;
}

export interface AuditFilter {
  jobId?: string;
  eventType?: AuditEntryEventType;
  startTime?: string;
  endTime?: string;
}

/**
 * Outcome of a chain verification, as a three-state discriminant (SEC-25).
 *
 * `valid: boolean` alone cannot express the difference between "the chain checks
 * out" and "there is no chain here to check", and collapsing the second into
 * `true` is exactly the false assurance SEC-25 is about: a caller that only
 * looks at `valid` would print "verified" for a file that carries no tamper
 * evidence whatsoever.
 *
 *   - `verified`     — every entry links to the previous one and rehashes to its
 *                      stored hash. This is the only status that means anything.
 *   - `broken`       — the file IS chained and the chain does not hold. Tampering.
 *   - `unverifiable` — nothing to verify: no file, an empty file, entries written
 *                      without hash fields, or hash chaining disabled on this
 *                      logger. Not a pass and not tamper evidence.
 */
export type ChainVerificationStatus = 'verified' | 'broken' | 'unverifiable';

export interface ChainVerificationResult {
  /** True only when status === 'verified'. Never true for an unverifiable file. */
  valid: boolean;
  status: ChainVerificationStatus;
  /** The file this result describes — callers report on more than one log. */
  path: string;
  entries: number;
  brokenAt?: number;
  reason?: string;
}

/**
 * Derive the path of the hash-chained security log from the configured
 * `security.audit_log` path (SEC-25).
 *
 * Two different files live under `security.audit_log`:
 *   1. the configured path itself — written by `AuditLogHook`, NOT hash-chained;
 *   2. this derived `-security` sibling — written by `AuditLogger`, chained.
 *
 * The derivation used to be inlined as `.replace('.jsonl', '-security.jsonl')`
 * in the orchestrator, which meant every other caller had to guess it. It lives
 * here so the writer and the `audit --verify` reader cannot drift apart.
 */
export function securityAuditLogPath(auditLogPath: string): string {
  const ext = path.extname(auditLogPath);
  if (ext) return `${auditLogPath.slice(0, -ext.length)}-security${ext}`;
  return `${auditLogPath}-security.jsonl`;
}

export class AuditLogger {
  private readonly _logPath: string;
  private readonly _hashChain: boolean;
  private _previousHash: string = GENESIS_HASH;
  private _entryCounter = 0;
  private _writeQueue: Promise<void> = Promise.resolve();
  private _initialized = false;

  constructor(auditLogPath: string, options: AuditLoggerOptions = {}) {
    this._logPath = auditLogPath;
    this._hashChain = options.hashChain ?? true;

    // singleWriter=false is unsupported: _appendEntry() mutates shared state
    // (_initialized, _entryCounter, _previousHash) that is not safe for concurrent
    // access. Even when hashChain=false, concurrent writers would race on
    // _entryCounter and _initialized, producing duplicate entryIds or corrupt
    // initialization. Writes are ALWAYS serialised through _writeQueue regardless
    // of this option, so the value is never consulted after construction — we only
    // warn so operators know their config was ignored.
    if (options.singleWriter === false) {
      log.warn(
        'singleWriter=false is not supported — concurrent writes race on shared mutable state ' +
        '(_entryCounter, _initialized) and would produce duplicate entry IDs or corrupt initialization. ' +
        'Writes will be serialized as if singleWriter=true.',
      );
    }
  }

  /** The file this logger reads and writes. */
  get logPath(): string {
    return this._logPath;
  }

  /** Whether this logger writes hash-chain fields. False means no tamper evidence. */
  get hashChainEnabled(): boolean {
    return this._hashChain;
  }

  /**
   * Append an audit entry to the log.
   *
   * All writes are serialised through a Promise queue so no two concurrent writes
   * can corrupt the file or produce duplicate entry IDs.
   */
  async log(input: AuditEntryInput): Promise<AuditEntry> {
    // Queue the write and return the entry once written
    return new Promise<AuditEntry>((resolve, reject) => {
      this._writeQueue = this._writeQueue
        .catch((err) => {
          // ERR-01: Log previous write failures instead of silently swallowing them
          log.error({ err: err instanceof Error ? err.message : String(err) }, 'Previous write operation failed');
        })
        .then(async () => {
          const entry = await this._appendEntry(input);
          resolve(entry);
        })
        .catch((err) => {
          reject(err);
        });
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
    const entries: AuditEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as AuditEntry);
      } catch {
        // Skip malformed lines
      }
    }
    let filteredEntries = entries;

    if (filter) {
      if (filter.jobId) {
        filteredEntries = filteredEntries.filter(e => e.jobId === filter.jobId);
      }
      if (filter.eventType) {
        filteredEntries = filteredEntries.filter(e => e.eventType === filter.eventType);
      }
      if (filter.startTime) {
        const start = filter.startTime;
        filteredEntries = filteredEntries.filter(e => e.timestamp >= start);
      }
      if (filter.endTime) {
        const end = filter.endTime;
        filteredEntries = filteredEntries.filter(e => e.timestamp <= end);
      }
    }

    return filteredEntries;
  }

  /**
   * Verify the hash chain integrity of the entire audit log.
   *
   * SEC-25: this must never answer "valid" for a file whose integrity it cannot
   * actually establish. Every early return that used to be `{ valid: true }` for
   * an absent, empty or unchained file is now `unverifiable` — a distinct status
   * carrying the reason, so the caller reports "cannot verify" rather than "OK".
   */
  async verifyChain(): Promise<ChainVerificationResult> {
    const at = this._logPath;

    // When hash chaining is disabled, entries are written without hash fields.
    // There is no chain to check — that is not the same as a chain that holds.
    if (!this._hashChain) {
      return {
        valid: false,
        status: 'unverifiable',
        path: at,
        entries: 0,
        reason: 'Hash chaining is disabled for this log (security.audit_hash_chain = false) — entries carry no tamper evidence',
      };
    }

    let content: string;
    try {
      content = await fs.readFile(this._logPath, 'utf-8');
    } catch {
      return {
        valid: false,
        status: 'unverifiable',
        path: at,
        entries: 0,
        reason: 'No audit log at this path — nothing to verify',
      };
    }

    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length === 0) {
      return {
        valid: false,
        status: 'unverifiable',
        path: at,
        entries: 0,
        reason: 'Audit log is empty — nothing to verify',
      };
    }

    let expectedPreviousHash = GENESIS_HASH;

    for (let i = 0; i < lines.length; i++) {
      let entry: AuditEntry;
      try {
        entry = JSON.parse(lines[i]!) as AuditEntry;
      } catch {
        return {
          valid: false,
          status: 'broken',
          path: at,
          entries: lines.length,
          brokenAt: i,
          reason: `Entry ${i} has malformed JSON`,
        };
      }

      // A file whose FIRST entry has no hash fields was never chained — the
      // AuditLogHook tool log (`audit.jsonl`) is exactly this shape. Reporting
      // it as "BROKEN" would cry tampering; the honest answer is that this file
      // cannot be chain-verified at all. (A missing hash on a *later* entry, in
      // a file that started out chained, falls through to the link checks below
      // and is correctly reported as broken.)
      if (i === 0 && (!entry.hash || !entry.previousHash)) {
        return {
          valid: false,
          status: 'unverifiable',
          path: at,
          entries: lines.length,
          reason: 'Entry 0 has no hash-chain fields — this file is not hash-chained, so tampering with it cannot be detected',
        };
      }

      // Check previous hash link
      if (entry.previousHash !== expectedPreviousHash) {
        return {
          valid: false,
          status: 'broken',
          path: at,
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
          status: 'broken',
          path: at,
          entries: lines.length,
          brokenAt: i,
          reason: `Entry ${i} hash mismatch: expected ${computedHash}, got ${entry.hash}`,
        };
      }

      expectedPreviousHash = entry.hash;
    }

    return { valid: true, status: 'verified', path: at, entries: lines.length };
  }

  // ─── SDK Integration ──────────────────────────────────────────────

  /**
   * Creates a PostToolUse hook callback compatible with the Claude Agent SDK.
   * Logs every tool execution to the hash-chained audit log.
   */
  createPostToolUseHook(): (
    input: Record<string, unknown>,
    toolUseID: string | undefined,
    options: { signal: AbortSignal },
  ) => Promise<Record<string, unknown>> {
    return async (
      input: Record<string, unknown>,
      _toolUseID: string | undefined,
      _options: { signal: AbortSignal },
    ) => {
      const toolName = (input['tool_name'] as string) ?? 'unknown';
      const toolInput = (input['tool_input'] as Record<string, unknown>) ?? {};
      const toolResponse = input['tool_response'];
      const sessionId = (input['session_id'] as string) ?? 'unknown';

      try {
        await this.log({
          jobId: sessionId,
          eventType: 'tool_invocation',
          timestamp: new Date().toISOString(),
          provider: 'claude-agent-sdk',
          toolName,
          parameters: toolInput,
          result: {
            status: 'ok',
            output:
              typeof toolResponse === 'string'
                ? toolResponse
                : JSON.stringify(toolResponse),
          },
        });
      } catch (err) {
        // R27: Log audit write failures instead of silently swallowing them.
        // For an audit log, silent failure means undetectable data loss.
        log.error({ toolName, err: err instanceof Error ? err.message : String(err) }, 'Failed to write audit entry');
      }

      return {};
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────

  private async _ensureInitialized(): Promise<void> {
    if (this._initialized) return;

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(this._logPath), { recursive: true });

    // Read existing entries to get the last valid hash and counter
    try {
      const content = await fs.readFile(this._logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      // Iterate backwards to find the last valid entry (resilient to corruption)
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]!) as AuditEntry;
          this._previousHash = entry.hash;
          this._entryCounter = lines.length;
          break;
        } catch {
          // Skip malformed trailing lines, try previous
        }
      }
    } catch {
      // File doesn't exist yet, starting fresh
    }

    this._initialized = true;
  }

  private async _appendEntry(input: AuditEntryInput): Promise<AuditEntry> {
    await this._ensureInitialized();

    const entryId = `audit-${++this._entryCounter}`;

    let entry: AuditEntry;

    if (this._hashChain) {
      // Hash-chained mode: compute previousHash + hash for tamper evidence
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

      const hash = this._computeHashFromParts(entryWithoutHash);
      entry = { ...entryWithoutHash, hash };
      this._previousHash = hash;
    } else {
      // Hash-chain disabled: omit previousHash/hash fields
      entry = {
        entryId,
        jobId: input.jobId,
        eventType: input.eventType,
        timestamp: input.timestamp,
        provider: input.provider,
        toolName: input.toolName,
        parameters: input.parameters,
        result: input.result,
        previousHash: '',
        hash: '',
      };
    }

    // Append to file
    // ERR-01: Wrap file write with explicit error handling and logging
    try {
      await fs.appendFile(this._logPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error({ err: error, path: this._logPath, entryId: entry.entryId }, 'Failed to write audit entry to disk');
      throw new Error(`Audit log write failed: ${error.message}`, { cause: error });
    }

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
  ): string {
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }
}
