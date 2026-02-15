/**
 * Steering CLI Commands — inject steer messages, manage flags.
 *
 * Spec §5.9 "CLI Interface" — steer/flags/approve/reject subcommands.
 */

import type { Command } from 'commander';
import path from 'node:path';
import { injectSteer, injectFlagDecision } from '../steering/steer-injector.js';
import { FlagManager } from '../steering/flag-manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('steer-commands');

export function registerSteerCommands(
  program: Command,
  baseDir: string,
  options?: { flagTimeoutMs?: number },
): void {
  const flagTimeoutMs = options?.flagTimeoutMs ?? 300_000;
  program
    .command('steer <jobId> <message>')
    .description('Send steering message to a running job')
    .action(async (jobId: string, message: string) => {
      const id = await injectSteer(baseDir, jobId, message);
      console.log(`Steer message injected: ${id}`);
    });

  program
    .command('flags')
    .description('List flagged decisions awaiting review')
    .option('--job <jobId>', 'Filter by job ID')
    .action(async (opts: { job?: string }) => {
      const fm = new FlagManager(path.join(baseDir, 'flags'), {
        timeoutMs: flagTimeoutMs,
      });
      const flags = await fm.getFlags(opts.job);

      if (flags.length === 0) {
        console.log('No flags found.');
        return;
      }

      console.log(`${flags.length} flag(s):\n`);
      for (const f of flags) {
        console.log(`  [${f.flagId}] job=${f.jobId} status=${f.status}`);
        console.log(`    Q: ${f.question}`);
        console.log(`    default: ${f.defaultAction}`);
        if (f.resolvedAt) {
          console.log(`    resolved: ${f.resolvedAt} (${f.chosenAction})`);
        }
        console.log();
      }
    });

  program
    .command('approve <jobId> <flagId>')
    .description('Approve a flagged decision')
    .action(async (jobId: string, flagId: string) => {
      const fm = new FlagManager(path.join(baseDir, 'flags'), {
        timeoutMs: flagTimeoutMs,
      });

      // Validate that the jobId matches the flag's actual job
      const flags = await fm.getFlags();
      const flag = flags.find(f => f.flagId === flagId);
      if (!flag) {
        log.error({ flagId }, 'Flag not found');
        process.exitCode = 1;
        return;
      }
      if (flag.jobId !== jobId) {
        log.error({ flagId, expected: jobId, actual: flag.jobId }, 'Job ID mismatch');
        process.exitCode = 1;
        return;
      }

      await fm.approve(flagId);
      const id = await injectFlagDecision(baseDir, jobId, flagId, 'approve');
      console.log(`Flag approved: ${id}`);
    });

  program
    .command('reject <jobId> <flagId> [reason]')
    .description('Reject a flagged decision')
    .action(async (jobId: string, flagId: string, reason?: string) => {
      const rejectReason = reason ?? 'Rejected via CLI';
      const fm = new FlagManager(path.join(baseDir, 'flags'), {
        timeoutMs: flagTimeoutMs,
      });

      // Validate that the jobId matches the flag's actual job
      const flags = await fm.getFlags();
      const flag = flags.find(f => f.flagId === flagId);
      if (!flag) {
        log.error({ flagId }, 'Flag not found');
        process.exitCode = 1;
        return;
      }
      if (flag.jobId !== jobId) {
        log.error({ flagId, expected: jobId, actual: flag.jobId }, 'Job ID mismatch');
        process.exitCode = 1;
        return;
      }

      await fm.reject(flagId, rejectReason);
      const id = await injectFlagDecision(
        baseDir,
        jobId,
        flagId,
        'reject',
        rejectReason,
      );
      console.log(`Flag rejected: ${id}`);
    });
}
