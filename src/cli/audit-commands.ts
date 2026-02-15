/**
 * Audit CLI Commands — view and verify the audit log.
 *
 * Spec §5.9 "CLI Interface" — audit subcommand.
 */

import type { Command } from 'commander';
import { AuditLogger } from '../security/audit-logger.js';
import type { AuditFilter } from '../security/audit-logger.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('audit-commands');

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

export function registerAuditCommands(
  program: Command,
  getAuditLogPath: () => string,
): void {
  program
    .command('audit')
    .description('View the audit log')
    .option('--last <duration>', 'Time window (e.g., 24h, 7d)', '24h')
    .option('--job <jobId>', 'Filter by job ID')
    .option('--type <eventType>', 'Filter by event type')
    .option('--verify', 'Verify hash chain integrity')
    .action(async (opts: { last: string; job?: string; type?: string; verify?: boolean }) => {
      const logger = new AuditLogger(getAuditLogPath());

      if (opts.verify) {
        const result = await logger.verifyChain();
        if (result.valid) {
          console.log(`Audit chain verified: ${result.entries} entries, all valid.`);
        } else {
          log.error({ brokenAt: result.brokenAt, reason: result.reason }, 'Audit chain BROKEN');
          process.exitCode = 1;
        }
        return;
      }

      const durationMs = parseDuration(opts.last);
      const startTime = new Date(Date.now() - durationMs).toISOString();

      const filter: AuditFilter = { startTime };
      if (opts.job) filter.jobId = opts.job;
      if (opts.type) filter.eventType = opts.type as AuditFilter['eventType'];

      const entries = await logger.readEntries(filter);

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
    });
}
