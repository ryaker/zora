/**
 * SteerInjector — Convenience functions for injecting steering messages.
 *
 * Provides a simplified CLI-friendly interface over SteeringManager.
 */

import { SteeringManager } from './steering-manager.js';
import type { SteeringSource, SteerMessage, FlagDecision } from './types.js';

/**
 * Injects a steer message for a running job.
 */
export async function injectSteer(
  baseDir: string,
  jobId: string,
  message: string,
  source: SteeringSource = 'cli',
): Promise<string> {
  const manager = new SteeringManager(baseDir);
  await manager.init();

  const steerMsg: SteerMessage = {
    type: 'steer',
    jobId,
    message,
    source,
    author: source,
    timestamp: new Date(),
  };

  return manager.injectMessage(steerMsg);
}

/**
 * Injects a flag decision for a running job.
 */
export async function injectFlagDecision(
  baseDir: string,
  jobId: string,
  flagId: string,
  decision: 'approve' | 'reject',
  reason?: string,
): Promise<string> {
  const manager = new SteeringManager(baseDir);
  await manager.init();

  const flagMsg: FlagDecision = {
    type: 'flag_decision',
    jobId,
    flagId,
    decision,
    reason,
    source: 'cli',
    author: 'cli',
    timestamp: new Date(),
  };

  return manager.injectMessage(flagMsg);
}
