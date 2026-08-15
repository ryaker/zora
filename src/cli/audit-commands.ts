/**
 * Audit CLI Commands — view and verify the audit log.
 *
 * Spec §5.9 "CLI Interface" — audit subcommand.
 *
 * SEC-25: Zora reads TWO audit files under one config key, `security.audit_log`:
 *
 *   1. `<audit_log>`                 — the legacy tool log. One JSON object per
 *                                      tool call: {ts, jobId, tool, arguments,
 *                                      result, durationMs}. NOT chained.
 *                                      SEC-28 moved `AuditLogHook` onto the
 *                                      chained logger, so this file gains no new
 *                                      lines; it is read so that history written
 *                                      before that change stays visible.
 *   2. `<audit_log>` + `-security`   — written by `AuditLogger` from the
 *                                      orchestrator. Hash-chained, tamper-evident,
 *                                      and since SEC-28 the only audit file with a
 *                                      writer: security events AND tool calls.
 *
 * `--verify` used to run the chain verifier over file 1, which has no chain, and
 * on a fresh install (file absent) printed "Audit chain verified: 0 entries, all
 * valid." That is worse than not offering the command at all. It now verifies
 * file 2 — the only file that can be verified — and reports file 1 separately,
 * explicitly labelled as not chain-verifiable. `--file` overrides the target.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Command } from 'commander';
import { AuditLogger, securityAuditLogPath } from '../security/audit-logger.js';
import type {
  AuditFilter,
  AuditLoggerOptions,
  ChainVerificationResult,
} from '../security/audit-logger.js';
import type { AuditEntry } from '../security/security-types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('audit-commands');

/** Exit code when the chain is intact but a log could not be verified at all. */
const EXIT_UNVERIFIABLE = 2;
/** Exit code when a hash chain is present and does not hold — tampering. */
const EXIT_BROKEN = 1;

function parseDuration(duration: string): number {
  const match = /^(\d+)(h|d|m)$/.exec(duration);
  if (!match) return 24 * 60 * 60 * 1000; // default 24h

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;
  switch (unit) {
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000;
  }
}

/** Shape written by AuditLogHook — a different schema from AuditEntry. */
interface ToolLogLine {
  ts?: string;
  jobId?: string;
  tool?: string;
  durationMs?: number;
}

/**
 * Normalise a tool-log line into the AuditEntry shape used for display.
 *
 * Without this, `audit --last 24h` silently returned nothing: the tool log has
 * `ts`, not `timestamp`, so every line failed the `e.timestamp >= start` filter
 * and the command printed "No audit entries found" over a file full of entries.
 */
function normaliseToolLogEntry(raw: ToolLogLine, index: number): AuditEntry | null {
  if (!raw.ts || !raw.tool) return null;
  return {
    entryId: `tool-${index + 1}`,
    jobId: raw.jobId ?? 'unknown',
    eventType: 'tool_invocation',
    timestamp: raw.ts,
    provider: 'tool-hook',
    toolName: raw.tool,
    parameters: {},
    result: {},
    previousHash: '',
    hash: '',
  };
}

/** Read the unchained tool log and normalise it for display. */
async function readToolLog(logPath: string): Promise<AuditEntry[]> {
  let content: string;
  try {
    content = await fs.readFile(logPath, 'utf-8');
  } catch {
    return [];
  }
  const entries: AuditEntry[] = [];
  const lines = content.trim().split('\n').filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    try {
      const normalised = normaliseToolLogEntry(JSON.parse(lines[i]!) as ToolLogLine, i);
      if (normalised) entries.push(normalised);
    } catch {
      // Skip malformed lines — a partially written line must not hide the rest.
    }
  }
  return entries;
}

function applyFilter(entries: AuditEntry[], filter: AuditFilter): AuditEntry[] {
  return entries.filter((e) => {
    if (filter.jobId && e.jobId !== filter.jobId) return false;
    if (filter.eventType && e.eventType !== filter.eventType) return false;
    if (filter.startTime && !(e.timestamp >= filter.startTime)) return false;
    if (filter.endTime && !(e.timestamp <= filter.endTime)) return false;
    return true;
  });
}

/** Print one verification result. Returns the exit code it implies (0 = fine). */
function reportVerification(result: ChainVerificationResult): number {
  switch (result.status) {
    case 'verified':
      console.log(`✓ Chain verified: ${result.entries} entries, all valid.`);
      console.log(`  ${result.path}`);
      return 0;
    case 'broken':
      console.error(`✗ CHAIN BROKEN at entry ${result.brokenAt}: ${result.reason}`);
      console.error(`  ${result.path}`);
      log.error(
        { path: result.path, brokenAt: result.brokenAt, reason: result.reason },
        'Audit chain BROKEN',
      );
      return EXIT_BROKEN;
    case 'unverifiable':
      // Never "verified". The user asked whether this log is intact and the
      // honest answer is that the question cannot be answered for this file.
      console.error(`! Cannot verify: ${result.reason}`);
      console.error(`  ${result.path}`);
      return EXIT_UNVERIFIABLE;
  }
}

export function registerAuditCommands(
  program: Command,
  getAuditLogPath: () => string = () => path.join(os.homedir(), '.zora', 'audit', 'audit.jsonl'),
  auditLoggerOptions?: AuditLoggerOptions,
): void {
  program
    .command('audit')
    .description('View the audit log')
    .option('--last <duration>', 'Time window (e.g., 24h, 7d)', '24h')
    .option('--job <jobId>', 'Filter by job ID')
    .option('--type <eventType>', 'Filter by event type')
    .option('--verify', 'Verify hash chain integrity of the security event log')
    .option('--file <path>', 'Read/verify this log file instead of the configured ones')
    .action(
      async (opts: {
        last: string;
        job?: string;
        type?: string;
        verify?: boolean;
        file?: string;
      }) => {
        const toolLogPath = opts.file ?? getAuditLogPath();
        const chainedLogPath = opts.file ?? securityAuditLogPath(getAuditLogPath());

        if (opts.verify) {
          const chained = new AuditLogger(chainedLogPath, auditLoggerOptions);
          const result = await chained.verifyChain();
          const exitCode = reportVerification(result);

          // With an explicit --file there is only one file in play. Otherwise
          // also account for the tool log, so the user is not left believing
          // that "chain verified" covered every audit file Zora writes.
          if (!opts.file) {
            const toolEntries = await readToolLog(toolLogPath);
            console.log();
            console.log(
              `! Not chain-verifiable: ${toolLogPath}`,
            );
            console.log(
              `  ${toolEntries.length} tool-call entries, written without a hash chain — ` +
              'edits and deletions in this file cannot be detected.',
            );
          }

          if (exitCode !== 0) process.exitCode = exitCode;
          return;
        }

        const durationMs = parseDuration(opts.last);
        const startTime = new Date(Date.now() - durationMs).toISOString();

        const filter: AuditFilter = { startTime };
        if (opts.job) filter.jobId = opts.job;
        if (opts.type) filter.eventType = opts.type as AuditFilter['eventType'];

        // Both logs are part of the audit trail; listing only one hides half of it.
        const securityEntries = await new AuditLogger(chainedLogPath, auditLoggerOptions).readEntries(filter);
        const toolEntries = opts.file ? [] : applyFilter(await readToolLog(toolLogPath), filter);
        const entries = [...securityEntries, ...toolEntries].sort((a, b) =>
          a.timestamp.localeCompare(b.timestamp),
        );

        if (entries.length === 0) {
          console.log('No audit entries found for the given filters.');
          return;
        }

        console.log(`${entries.length} audit entries:\n`);
        for (const entry of entries) {
          console.log(`  [${entry.entryId}] ${entry.eventType} — job=${entry.jobId} at ${entry.timestamp}`);
          if (entry.toolName) {
            console.log(`    tool: ${entry.toolName}`);
          }
          console.log();
        }
      },
    );
}
