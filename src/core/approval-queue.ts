/**
 * ApprovalQueue — human-in-the-loop gate for high-risk tool calls.
 *
 * When IrreversibilityScorerHook returns reason="approval_required:{score}",
 * the orchestrator should call ApprovalQueue.request() before proceeding.
 * The queue sends a notification via the registered send-handler and waits
 * for a reply. Auto-denies after configurable timeout.
 */

import crypto from 'node:crypto';
import { createLogger } from '../utils/logger.js';

const log = createLogger('approval-queue');

export type ApprovalDecision = 'allow' | 'deny' | 'allow-30m' | 'allow-session';

export interface ApprovalConfig {
  enabled: boolean;
  timeoutMs: number;          // default 300_000 (5 min)
  retryAsApproval: boolean;   // reserved for future implementation
  retryWindowMs: number;      // reserved for future implementation
  /** Score ceiling for blanket-allow scopes (allow-30m / allow-session). Defaults to policy flag threshold. */
  flagThreshold?: number;
}

export interface PendingApproval {
  id: string;          // ZORA-XXXX token
  action: string;
  score: number;
  jobId: string;
  tool: string;
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  expiresAt: number;
  createdAt: number;
}

export type ApprovalSendFn = (message: string) => Promise<void>;

export class ApprovalQueue {
  private readonly _pending = new Map<string, PendingApproval>();
  private _sendFn: ApprovalSendFn | undefined;
  private _blanketAllowUntil = 0;         // epoch ms; 0 = no blanket; Number.MAX_SAFE_INTEGER = session
  private _blanketMaxScore = 0;           // max score covered by blanket
  private _blanketSessionScoped = false;  // true when allow-session set

  constructor(private readonly _config: ApprovalConfig) {}

  /** Register the channel to send approval requests through */
  setSendHandler(fn: ApprovalSendFn): void {
    this._sendFn = fn;
  }

  /** Is the approval queue enabled? */
  isEnabled(): boolean {
    return this._config.enabled;
  }

  /**
   * Request approval for a high-risk action.
   * Returns true if approved (or blanket-allowed), false if denied/timed out.
   */
  async request(opts: {
    action: string;
    score: number;
    jobId: string;
    tool: string;
    /**
     * SEC-27 (review finding): set when `score` is not a per-action
     * irreversibility score and so cannot be compared against the blanket
     * ceiling, which is configured from the per-action flag threshold.
     * Such a request always asks a human.
     */
    bypassBlanketAllow?: boolean;
  }): Promise<boolean> {
    // Check blanket allow window (session-scoped uses boolean to avoid Date(Infinity) crash)
    const blanketActive = this._blanketSessionScoped || Date.now() < this._blanketAllowUntil;
    if (blanketActive && !opts.bypassBlanketAllow && opts.score < this._blanketMaxScore) {
      log.info({ tool: opts.tool, score: opts.score }, 'Action covered by blanket allow');
      return true;
    }

    if (!this._sendFn) {
      log.warn({ tool: opts.tool }, 'No send handler registered — auto-denying');
      return false;
    }

    return new Promise<boolean>((resolve) => {
      const id = this._generateToken();
      // Timer stored on entry so handleReply can cancel it — prevents double-resolution
      const timer = setTimeout(() => {
        if (this._pending.has(id)) {
          log.warn({ id, tool: opts.tool }, 'Approval request timed out — auto-denying');
          this._pending.delete(id);
          resolve(false);
        }
      }, this._config.timeoutMs);
      // Allow GC/process exit — don't hold the event loop open just for a timeout
      if (timer.unref) timer.unref();

      const entry: PendingApproval = {
        id,
        action: opts.action,
        score: opts.score,
        jobId: opts.jobId,
        tool: opts.tool,
        resolve,
        timer,
        expiresAt: Date.now() + this._config.timeoutMs,
        createdAt: Date.now(),
      };
      this._pending.set(id, entry);
      this._sendApprovalRequest(entry).catch(err => {
        log.error({ err }, 'Failed to send approval request');
      });
    });
  }

  /**
   * Handle an approval reply from the user (called by channel handler).
   * token = "ZORA-XXXX", decision = "allow" | "deny" | "allow-30m" | "allow-session"
   */
  handleReply(token: string, decision: ApprovalDecision): boolean {
    const entry = this._pending.get(token);
    if (!entry) {
      log.warn({ token }, 'Unknown or expired approval token');
      return false;
    }
    // Cancel the timeout first to prevent double-resolution
    clearTimeout(entry.timer);
    this._pending.delete(token);

    // Blanket threshold: score must be below the configured flag threshold to qualify
    const blanketMaxScore = this._config.flagThreshold ?? 80;
    switch (decision) {
      case 'allow-30m': {
        this._blanketAllowUntil = Date.now() + 30 * 60 * 1000;
        this._blanketMaxScore = blanketMaxScore;
        this._blanketSessionScoped = false;
        log.info({ until: new Date(this._blanketAllowUntil).toISOString() }, 'Blanket allow (30m) set');
        break;
      }
      case 'allow-session':
        this._blanketSessionScoped = true;
        this._blanketMaxScore = blanketMaxScore;
        log.warn({ maxScore: blanketMaxScore }, 'Blanket allow-session set — all actions below threshold skip approval this session');
        break;
    }

    const approved = decision !== 'deny';
    log.info({ token, decision, approved }, 'Approval resolved');
    entry.resolve(approved);
    return true;
  }

  /**
   * Pre-activate a session-scoped blanket allow for actions scoring below maxScore.
   * Used by steering.auto_approve_low_risk — all low-risk actions are auto-approved
   * for the duration of the process without requiring an interactive approval reply.
   */
  setSessionBlanketAllow(maxScore: number): void {
    if (!Number.isFinite(maxScore) || maxScore < 0) {
      log.warn({ maxScore }, 'setSessionBlanketAllow: invalid maxScore — blanket allow not activated');
      return;
    }
    this._blanketSessionScoped = true;
    this._blanketMaxScore = maxScore;
    log.info({ maxScore }, 'auto_approve_low_risk: session blanket allow pre-activated');
  }

  /** Check for pending approvals (for status display) */
  getPendingCount(): number {
    return this._pending.size;
  }

  /** Parse "/approve ZORA-XXXX allow" style messages. Returns null if not an approval command. */
  parseApprovalCommand(text: string): { token: string; decision: ApprovalDecision } | null {
    const match = /^\/approve\s+(ZORA-[A-Z0-9]{4})\s+(allow|deny|allow-30m|allow-session)/i.exec(text.trim());
    if (!match) return null;
    return {
      token: match[1]!.toUpperCase(),
      decision: match[2]!.toLowerCase() as ApprovalDecision,
    };
  }

  private async _sendApprovalRequest(entry: PendingApproval): Promise<void> {
    const timeoutMin = Math.round(this._config.timeoutMs / 60_000);
    const message =
      `⚠️ *Zora Action Approval Required*\n\n` +
      `Action: \`${entry.tool}\`\n` +
      `Task: \`${entry.action}\`\n` +
      `Risk: ${entry.score}/100 (${this._riskLabel(entry.score)})\n` +
      `Job: \`${entry.jobId}\`\n` +
      `Token: \`${entry.id}\`\n\n` +
      `Reply with:\n` +
      `  /approve ${entry.id} allow — approve once\n` +
      `  /approve ${entry.id} allow-30m — approve all similar (30 min)\n` +
      `  /approve ${entry.id} allow-session — approve all this session\n` +
      `  /approve ${entry.id} deny — block this action\n\n` +
      `Auto-denies in ${timeoutMin} minutes.`;

    await this._sendFn!(message);
  }

  private _riskLabel(score: number): string {
    if (score >= 90) return 'critical';
    if (score >= 70) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
  }

  private _generateToken(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const maxAttempts = 10;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Use crypto.randomBytes for unpredictable tokens — these are one-time auth codes
      const bytes = crypto.randomBytes(4);
      let token = 'ZORA-';
      for (let i = 0; i < 4; i++) {
        token += chars[bytes[i]! % chars.length];
      }
      if (!this._pending.has(token)) {
        return token;
      }
    }
    throw new Error('Failed to generate unique approval token after 10 attempts');
  }
}

export const DEFAULT_APPROVAL_CONFIG: ApprovalConfig = {
  enabled: false,  // disabled by default; opt-in
  timeoutMs: 300_000,     // 5 minutes
  retryAsApproval: true,
  retryWindowMs: 60_000,
};

/**
 * SEC-27: builds an ApprovalConfig from the raw `[approval]` config block.
 *
 * `approval` has no entry in the typed config, so reading it means casting
 * through `Record<string, unknown>` — which is exactly the kind of parsing that
 * gets copied to a second call site and drifts. It lived in `cli/daemon.ts`,
 * and the daemon was the only place that built a queue at all: on the
 * `zora-agent ask` path there was no ApprovalQueue, so every action over the
 * flag threshold was denied outright with no way to approve it. Same shape as
 * SEC-29 — a mechanism each caller configures for itself, so some caller
 * eventually doesn't. `Orchestrator.boot()` now calls this too, which is what
 * gives both entry points the same gate.
 */
export function approvalConfigFrom(raw: unknown): ApprovalConfig {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_APPROVAL_CONFIG };
  const block = raw as Record<string, unknown>;

  // SEC-27 (review finding): `setTimeout` clamps a delay above 2^31-1 ms to 1,
  // so an over-large timeout_s fires the auto-deny timer immediately and every
  // approval request is refused at once — the same failure the `0` case is
  // rejected for, reached from the opposite end. Both fall back to the default.
  const MAX_TIMEOUT_MS = 2_147_483_647;
  const timeoutSeconds = block['timeout_s'];
  const seconds = typeof timeoutSeconds === 'number'
    && Number.isFinite(timeoutSeconds)
    && timeoutSeconds > 0
    && timeoutSeconds * 1000 <= MAX_TIMEOUT_MS
    ? timeoutSeconds
    : DEFAULT_APPROVAL_CONFIG.timeoutMs / 1000;

  return {
    ...DEFAULT_APPROVAL_CONFIG,
    enabled: block['enabled'] === true,
    timeoutMs: seconds * 1000,
  };
}
