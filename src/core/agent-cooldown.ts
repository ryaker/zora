/**
 * AgentCooldown — per-subagent reputation tracker.
 *
 * Tracks denial counts for subagents and escalates restrictions
 * when an agent repeatedly triggers blocked actions.
 * Persists state to ~/.zora/agent-reputation/<agentId>.json
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createLogger } from '../utils/logger.js';

const log = createLogger('agent-cooldown');

export interface AgentReputation {
  agentId: string;
  denialCount: number;
  level: 0 | 1 | 2;
  lastDenialAt: string | null;
  lastResetAt: string | null;
  createdAt: string;
}

export interface CooldownConfig {
  enabled: boolean;
  level1Threshold: number;    // default 3
  level2Threshold: number;    // default 6
  shutdownThreshold: number;  // default 10
  resetAfterHours: number;    // default 24
  level1DelayMs: number;      // default 2000
  reputationDir: string;      // default ~/.zora/agent-reputation
}

export class AgentCooldown {
  private readonly _reputationDir: string;

  constructor(private readonly _config: CooldownConfig) {
    this._reputationDir = _config.reputationDir.startsWith('~/')
      ? path.join(os.homedir(), _config.reputationDir.slice(2))
      : _config.reputationDir;
    if (!fs.existsSync(this._reputationDir)) {
      fs.mkdirSync(this._reputationDir, { recursive: true });
    }
  }

  /**
   * Check and enforce cooldown for an agent.
   * Returns false if the agent should be SHUT DOWN.
   * Applies delays/restrictions at lower levels.
   */
  async checkAndEnforce(agentId: string): Promise<{ allowed: boolean; reason?: string }> {
    if (!this._config.enabled) return { allowed: true };

    const rep = this._load(agentId);

    // Check if we should auto-reset after quiet period
    if (rep.lastDenialAt) {
      const hoursSinceLastDenial = (Date.now() - new Date(rep.lastDenialAt).getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastDenial >= this._config.resetAfterHours && rep.denialCount > 0) {
        log.info({ agentId, denialCount: rep.denialCount }, 'Agent cooldown auto-reset after quiet period');
        const resetRep: AgentReputation = {
          ...rep,
          denialCount: 0,
          level: 0,
          lastResetAt: new Date().toISOString(),
          lastDenialAt: null,
        };
        this._save(agentId, resetRep);
        return { allowed: true };
      }
    }

    if (rep.denialCount >= this._config.shutdownThreshold) {
      log.error({ agentId, denialCount: rep.denialCount }, 'Agent exceeded shutdown threshold');
      return {
        allowed: false,
        reason: `Agent "${agentId}" has been shut down after ${rep.denialCount} denied actions. Reset with: zora agent-reputation reset ${agentId}`,
      };
    }

    if (rep.level === 2) {
      log.warn({ agentId, denialCount: rep.denialCount }, 'Agent at Level 2 (Restricted)');
      // Level 2: log warning but allow the call — high-risk actions will still be blocked by IrreversibilityScorer
    }

    if (rep.level === 1) {
      log.debug({ agentId, delayMs: this._config.level1DelayMs }, 'Agent at Level 1 (Throttled) — applying delay');
      await this._sleep(this._config.level1DelayMs);
    }

    return { allowed: true };
  }

  /**
   * Record a denial for an agent. Called when IrreversibilityScorerHook blocks an action.
   */
  recordDenial(agentId: string): AgentReputation {
    if (!this._config.enabled) return this._defaultReputation(agentId);

    const rep = this._load(agentId);
    const newCount = rep.denialCount + 1;
    const newLevel = this._computeLevel(newCount);

    const updated: AgentReputation = {
      ...rep,
      denialCount: newCount,
      level: newLevel,
      lastDenialAt: new Date().toISOString(),
    };

    this._save(agentId, updated);

    log.warn({ agentId, denialCount: newCount, level: newLevel }, 'Denial recorded for agent');

    return updated;
  }

  /**
   * Get current reputation for an agent.
   */
  getReputation(agentId: string): AgentReputation {
    return this._load(agentId);
  }

  /**
   * Reset an agent's reputation (admin action).
   */
  reset(agentId: string): void {
    const rep = this._load(agentId);
    const reset: AgentReputation = {
      ...rep,
      denialCount: 0,
      level: 0,
      lastDenialAt: null,
      lastResetAt: new Date().toISOString(),
    };
    this._save(agentId, reset);
    log.info({ agentId }, 'Agent reputation reset');
  }

  private _computeLevel(denialCount: number): 0 | 1 | 2 {
    if (denialCount >= this._config.level2Threshold) return 2;
    if (denialCount >= this._config.level1Threshold) return 1;
    return 0;
  }

  private _load(agentId: string): AgentReputation {
    const filePath = this._reputationPath(agentId);
    if (!fs.existsSync(filePath)) {
      return this._defaultReputation(agentId);
    }
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as Record<string, unknown>)['agentId'] === 'string' &&
        typeof (parsed as Record<string, unknown>)['denialCount'] === 'number' &&
        Number.isFinite((parsed as Record<string, unknown>)['denialCount']) &&
        ((parsed as Record<string, unknown>)['level'] === 0 ||
          (parsed as Record<string, unknown>)['level'] === 1 ||
          (parsed as Record<string, unknown>)['level'] === 2) &&
        ((parsed as Record<string, unknown>)['lastDenialAt'] === null ||
          typeof (parsed as Record<string, unknown>)['lastDenialAt'] === 'string') &&
        ((parsed as Record<string, unknown>)['lastResetAt'] === null ||
          typeof (parsed as Record<string, unknown>)['lastResetAt'] === 'string') &&
        typeof (parsed as Record<string, unknown>)['createdAt'] === 'string'
      ) {
        return parsed as AgentReputation;
      }
      return this._defaultReputation(agentId);
    } catch {
      return this._defaultReputation(agentId);
    }
  }

  private _save(agentId: string, rep: AgentReputation): void {
    const filePath = this._reputationPath(agentId);
    fs.writeFileSync(filePath, JSON.stringify(rep, null, 2), 'utf-8');
  }

  private _reputationPath(agentId: string): string {
    // Sanitize agentId for use as filename
    const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this._reputationDir, `${safe}.json`);
  }

  private _defaultReputation(agentId: string): AgentReputation {
    return {
      agentId,
      denialCount: 0,
      level: 0,
      lastDenialAt: null,
      lastResetAt: null,
      createdAt: new Date().toISOString(),
    };
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const DEFAULT_COOLDOWN_CONFIG: CooldownConfig = {
  enabled: false,  // opt-in
  level1Threshold: 3,
  level2Threshold: 6,
  shutdownThreshold: 10,
  resetAfterHours: 24,
  level1DelayMs: 2000,
  reputationDir: '~/.zora/agent-reputation',
};

/**
 * Build a CooldownConfig from the raw `[cooldown]` config table (SEC-29).
 *
 * Lives here rather than in an entry point because a global singleton that
 * each entry point configures for itself is a global singleton that some
 * entry point will forget. `zora-agent ask` did: `initGlobalCooldown` was
 * called only from the daemon, so `getGlobalCooldown()` returned null on the
 * ask path and the subagent cooldown never applied there.
 */
export function cooldownConfigFrom(raw: unknown): CooldownConfig {
  const table = (raw as Record<string, unknown> | undefined) ?? undefined;
  const num = (key: string, fallback: number): number => {
    const value = table?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  };
  if (!table) return { ...DEFAULT_COOLDOWN_CONFIG };
  return {
    ...DEFAULT_COOLDOWN_CONFIG,
    enabled: (table['enabled'] as boolean) ?? false,
    level1Threshold: num('level1_threshold', 3),
    level2Threshold: num('level2_threshold', 6),
    shutdownThreshold: num('shutdown_threshold', 10),
    resetAfterHours: num('reset_after_hours', 24),
    level1DelayMs: num('level1_delay_ms', 2000),
  };
}

// Module-level singleton for global access across the process
let _globalCooldown: AgentCooldown | null = null;

export function initGlobalCooldown(config: CooldownConfig): AgentCooldown {
  _globalCooldown = new AgentCooldown(config);
  return _globalCooldown;
}

export function getGlobalCooldown(): AgentCooldown | null {
  return _globalCooldown;
}
