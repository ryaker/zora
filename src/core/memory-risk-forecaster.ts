/**
 * MemoryRiskForecaster — cross-action risk pattern detection.
 *
 * Tracks three heuristic signals across a session:
 *   - Drift: deviation from initial session intent
 *   - Salami: incremental attack chain detection
 *   - Commitment Creep: escalating irreversibility trend
 *
 * Composite risk score triggers ApprovalQueue or auto-deny.
 * Uses heuristic keyword matching (no embeddings needed).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createLogger } from '../utils/logger.js';

const log = createLogger('memory-risk-forecaster');

export type ActionCategory = 'read' | 'write' | 'network' | 'shell' | 'git' | 'agent' | 'delete' | 'message' | 'unknown';

export interface RiskEvent {
  timestamp: string;
  sessionId: string;
  tool: string;
  actionCategory: ActionCategory;
  irreversibilityScore: number;   // from IrreversibilityScorerHook (0-100)
  jobId: string;
}

export interface RiskScores {
  drift: number;
  salami: number;
  commitmentCreep: number;
  composite: number;
}

export interface SessionRiskState {
  sessionId: string;
  baselineCategories: ActionCategory[];  // first 3 action categories
  events: RiskEvent[];                    // rolling last 50 events
  scores: RiskScores;
  lastUpdated: string;
}

export interface ForecasterConfig {
  enabled: boolean;
  maxEvents: number;           // rolling window size (default 50)
  interceptThreshold: number;  // composite ≥ this → route to ApprovalQueue (default 72)
  autoDenyThreshold: number;   // composite ≥ this → auto-deny all (default 88)
  stateDir: string;            // default ~/.zora/session-risk
}

/** Map tool name to action category */
function categorize(tool: string): ActionCategory {
  const t = tool.toLowerCase();
  if (/delete|rm\b|unlink|rmdir/.test(t)) return 'delete';
  if (/bash|shell|exec|run_command|execute/.test(t)) return 'shell';
  if (/git_push|push/.test(t)) return 'git';
  if (/git/.test(t)) return 'git';
  if (/send_message|telegram|signal|notify|email/.test(t)) return 'message';
  if (/http|fetch|request|curl|download|upload/.test(t)) return 'network';
  if (/spawn|delegate|subagent|agent/.test(t)) return 'agent';
  if (/write|edit|create|mkdir|cp|mv|save/.test(t)) return 'write';
  if (/read|list|glob|grep|search|find|stat/.test(t)) return 'read';
  return 'unknown';
}

/** Known dangerous category sequences (each match scores +25) */
const DANGEROUS_SEQUENCES: ActionCategory[][] = [
  ['read', 'write', 'network'],            // collect → stage → exfil
  ['read', 'shell', 'write'],              // recon → execute → write
  ['read', 'shell', 'message'],            // recon → execute → send
  ['read', 'write', 'message'],            // collect → stage → send
  ['shell', 'write', 'network'],           // execute → stage → exfil
  ['read', 'network'],                     // read + network = possible exfil
  ['delete', 'shell'],                     // delete + execute = destructive escalation
  ['agent', 'shell', 'network'],           // agent spawning + shell + network
];

function computeSalami(recentCategories: ActionCategory[]): number {
  let score = 0;
  for (const seq of DANGEROUS_SEQUENCES) {
    if (seq.every(cat => recentCategories.includes(cat))) {
      score += 25;
    }
  }
  return Math.min(100, score);
}

function computeDrift(baselineCategories: ActionCategory[], recentCategories: ActionCategory[]): number {
  if (baselineCategories.length === 0) return 0;
  const baselineSet = new Set(baselineCategories);
  const outsideBaseline = recentCategories.filter(c => !baselineSet.has(c) && c !== 'unknown');
  if (recentCategories.length === 0) return 0;
  return Math.round((outsideBaseline.length / recentCategories.length) * 100);
}

function computeCommitmentCreep(scores: number[]): number {
  if (scores.length === 0) return 0;
  // Recent events get higher weight
  let weightedSum = 0;
  let totalWeight = 0;
  const n = scores.length;
  for (let i = 0; i < n; i++) {
    const weight = i === n - 1 ? 3 : i === n - 2 ? 2 : 1;
    weightedSum += (scores[i]! * weight);
    totalWeight += weight;
  }
  return Math.round(weightedSum / totalWeight);
}

export class MemoryRiskForecaster {
  private readonly _stateDir: string;
  private readonly _cache = new Map<string, SessionRiskState>();

  constructor(private readonly _config: ForecasterConfig) {
    this._stateDir = _config.stateDir.startsWith('~/')
      ? path.join(os.homedir(), _config.stateDir.slice(2))
      : _config.stateDir;
    if (!fs.existsSync(this._stateDir)) {
      fs.mkdirSync(this._stateDir, { recursive: true });
    }
  }

  /** Record a new tool call event and recompute scores */
  record(sessionId: string, event: Omit<RiskEvent, 'actionCategory'>): RiskScores {
    if (!this._config.enabled) return { drift: 0, salami: 0, commitmentCreep: 0, composite: 0 };

    const state = this._loadOrCreate(sessionId);
    const actionCategory = categorize(event.tool);

    const fullEvent: RiskEvent = { ...event, actionCategory };
    state.events.push(fullEvent);

    // Keep rolling window
    if (state.events.length > this._config.maxEvents) {
      state.events = state.events.slice(-this._config.maxEvents);
    }

    // Establish baseline from first 3 events — frozen once set, never updated.
    if (state.baselineCategories.length === 0 && state.events.length >= 1) {
      state.baselineCategories = state.events.slice(0, 3).map(e => e.actionCategory);
    }

    // Compute signals
    const recent5 = state.events.slice(-5).map(e => e.actionCategory);
    const recent10Scores = state.events.slice(-10).map(e => e.irreversibilityScore);

    const drift = computeDrift(state.baselineCategories, recent5);
    const salami = computeSalami(recent5);
    const commitmentCreep = computeCommitmentCreep(recent10Scores);
    const composite = Math.round(0.3 * drift + 0.4 * salami + 0.3 * commitmentCreep);

    state.scores = { drift, salami, commitmentCreep, composite };
    state.lastUpdated = new Date().toISOString();

    this._save(sessionId, state);

    if (composite >= this._config.autoDenyThreshold) {
      log.error({ sessionId, composite, drift, salami, commitmentCreep }, 'CRITICAL: session risk score exceeds auto-deny threshold');
    } else if (composite >= this._config.interceptThreshold) {
      log.warn({ sessionId, composite, drift, salami, commitmentCreep }, 'Session risk score exceeds intercept threshold');
    }

    return state.scores;
  }

  /** Get current composite risk score for a session */
  getComposite(sessionId: string): number {
    const state = this._cache.get(sessionId) ?? this._loadFromDisk(sessionId);
    return state?.scores.composite ?? 0;
  }

  /** Returns true if the session's composite risk warrants interception */
  shouldIntercept(sessionId: string): boolean {
    if (!this._config.enabled) return false;
    return this.getComposite(sessionId) >= this._config.interceptThreshold;
  }

  /** Returns true if the session's composite risk warrants auto-deny */
  shouldAutoDeny(sessionId: string): boolean {
    if (!this._config.enabled) return false;
    return this.getComposite(sessionId) >= this._config.autoDenyThreshold;
  }

  /** Human-readable risk summary for approval requests */
  getSummary(sessionId: string): string {
    const state = this._cache.get(sessionId) ?? this._loadFromDisk(sessionId);
    if (!state) return 'No session risk data available.';
    const s = state.scores;
    return (
      `Session Risk: ${s.composite}/100 | ` +
      `Drift: ${s.drift} | Salami: ${s.salami} | Creep: ${s.commitmentCreep}\n` +
      `Events tracked: ${state.events.length} | Last: ${state.lastUpdated}`
    );
  }

  private _loadOrCreate(sessionId: string): SessionRiskState {
    const cached = this._cache.get(sessionId);
    if (cached) return cached;
    const fromDisk = this._loadFromDisk(sessionId);
    if (fromDisk) {
      this._cache.set(sessionId, fromDisk);
      return fromDisk;
    }
    const fresh: SessionRiskState = {
      sessionId,
      baselineCategories: [],
      events: [],
      scores: { drift: 0, salami: 0, commitmentCreep: 0, composite: 0 },
      lastUpdated: new Date().toISOString(),
    };
    this._cache.set(sessionId, fresh);
    return fresh;
  }

  private _loadFromDisk(sessionId: string): SessionRiskState | null {
    const filePath = this._statePath(sessionId);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SessionRiskState;
    } catch {
      return null;
    }
  }

  private _save(sessionId: string, state: SessionRiskState): void {
    const filePath = this._statePath(sessionId);
    this._cache.set(sessionId, state);
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  }

  private _statePath(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this._stateDir, `${safe}.json`);
  }
}

export const DEFAULT_FORECASTER_CONFIG: ForecasterConfig = {
  enabled: false,  // opt-in
  maxEvents: 50,
  interceptThreshold: 72,
  autoDenyThreshold: 88,
  stateDir: '~/.zora/session-risk',
};

/**
 * Build a ForecasterConfig from the raw `[risk_forecaster]` config table (SEC-29).
 *
 * See `cooldownConfigFrom` — same reasoning. This one mattered more: with no
 * forecaster the `IrreversibilityScorerHook` skips its session-risk block
 * entirely, so `shouldAutoDeny` never fires and a run that the daemon would
 * have stopped for a critical risk pattern proceeded under `ask`.
 */
export function forecasterConfigFrom(raw: unknown): ForecasterConfig {
  const table = (raw as Record<string, unknown> | undefined) ?? undefined;
  const num = (key: string, fallback: number): number => {
    const value = table?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  };
  if (!table) return { ...DEFAULT_FORECASTER_CONFIG };
  return {
    ...DEFAULT_FORECASTER_CONFIG,
    enabled: (table['enabled'] as boolean) ?? false,
    interceptThreshold: num('intercept_threshold', 72),
    autoDenyThreshold: num('auto_deny_threshold', 88),
    maxEvents: num('max_events', 50),
  };
}

// Module-level singleton
let _globalForecaster: MemoryRiskForecaster | null = null;

export function initGlobalForecaster(config: ForecasterConfig): MemoryRiskForecaster {
  _globalForecaster = new MemoryRiskForecaster(config);
  return _globalForecaster;
}

export function getGlobalForecaster(): MemoryRiskForecaster | null {
  return _globalForecaster;
}
