/**
 * Steering Types — Message schemas for async human-in-the-loop steering.
 *
 * Spec v0.6 "Async Steering Protocol":
 *   - SteerMessage: Direct instruction to a running job
 *   - FlagDecision: Response to an agent's uncertainty flag
 *   - SteerAck: Acknowledgment of a received steer message
 *   - JobStatus: Read-only summary of job progress
 */

export type SteeringSource = 'web' | 'telegram' | 'cli' | 'system';

export interface BaseSteeringMessage {
  type: string;
  jobId: string;
  timestamp: Date;
  source: SteeringSource;
  author: string;
}

/**
 * Direct instruction to a running job.
 */
export interface SteerMessage extends BaseSteeringMessage {
  type: 'steer';
  message: string;
}

/**
 * Response to an agent's uncertainty flag.
 */
export interface FlagDecision extends BaseSteeringMessage {
  type: 'flag_decision';
  flagId: string;
  decision: 'approve' | 'reject';
  reason?: string;
}

/**
 * Acknowledgment of a received steer message.
 */
export interface SteerAck extends BaseSteeringMessage {
  type: 'steer_ack';
  steerId: string;
  status: 'accepted' | 'rejected' | 'applied';
}

/**
 * Read-only summary of job progress.
 */
export interface JobStatus {
  type: 'job_status';
  jobId: string;
  state: 'queued' | 'running' | 'done' | 'failed';
  provider: string;
  progress: string; // e.g. "45%"
  timestamp: Date;
}

export type SteeringMessage = SteerMessage | FlagDecision | SteerAck;
