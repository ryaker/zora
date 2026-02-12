/**
 * SteeringManager — Handles the persistence and retrieval of steering messages.
 *
 * Spec v0.6 "Telegram Gateway Spec":
 *   - Local steering ingress API
 *   - All commands are validated and logged to the audit log.
 *   - Steer messages never update policy or config.
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { writeAtomic } from '../utils/fs.js';
import type { 
  SteeringMessage 
} from './types.js';

export class SteeringManager {
  private readonly _steeringDir: string;

  constructor(baseDir: string = path.join(os.homedir(), '.zora')) {
    this._steeringDir = path.join(baseDir, 'steering');
  }

  /**
   * Initializes the steering directory.
   */
  async init(): Promise<void> {
    if (!(await this._exists(this._steeringDir))) {
      await fs.mkdir(this._steeringDir, { recursive: true });
    }
  }

  /**
   * Injects a steering message for a specific job.
   */
  async injectMessage(message: SteeringMessage): Promise<string> {
    const messageId = `steer_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const jobDir = path.join(this._steeringDir, message.jobId);
    
    if (!(await this._exists(jobDir))) {
      await fs.mkdir(jobDir, { recursive: true });
    }

    const messagePath = path.join(jobDir, `${messageId}.json`);
    await writeAtomic(messagePath, JSON.stringify({ ...message, id: messageId }, null, 2));
    
    return messageId;
  }

  /**
   * Retrieves all unread/pending steering messages for a job.
   */
  async getPendingMessages(jobId: string): Promise<(SteeringMessage & { id: string })[]> {
    const jobDir = path.join(this._steeringDir, jobId);
    if (!(await this._exists(jobDir))) return [];

    const files = await fs.readdir(jobDir);
    const messages = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = await fs.readFile(path.join(jobDir, file), 'utf8');
        messages.push(JSON.parse(content));
      }
    }

    return messages.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  /**
   * Acknowledges or archives a steering message.
   */
  async archiveMessage(jobId: string, messageId: string): Promise<void> {
    const messagePath = path.join(this._steeringDir, jobId, `${messageId}.json`);
    const archiveDir = path.join(this._steeringDir, jobId, 'archive');
    
    if (!(await this._exists(archiveDir))) {
      await fs.mkdir(archiveDir, { recursive: true });
    }

    if (await this._exists(messagePath)) {
      await fs.rename(messagePath, path.join(archiveDir, `${messageId}.json`));
    }
  }

  private async _exists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }
}
