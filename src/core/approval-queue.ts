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

export type ApprovalDecision = 'allow' | 'deny' | 'allow-job' | 'allow-30m' | 'allow-session';

/**
 * #233: what a job may do without asking, granted once — at job start, in a
 * routine's definition, or by an `allow-job` reply. Each entry is an action
 * key (`git_push`, `send_message`, `file_delete`, `shell_exec_destructive`, …)
 * or `action:glob` to narrow it to a target, e.g. `git_push:agent/*` for
 * pushes to agent branches only. A grant can only skip a question; it cannot
 * lift a denial. Human-only kinds (#200), auto-deny scores, policy path and
 * command rules and the capability token all still apply inside it.
 */
export type JobGrant = readonly string[];

/** `*` matches any run of characters except `/`; `**` matches anything. */
function globMatches(glob: string, target: string): boolean {
  const re = glob
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${re}$`).test(target);
}

/** Does `grant` cover `action` on `target`? Exported for tests. */
export function grantCovers(grant: JobGrant, action: string, target?: string): boolean {
  return grant.some((entry) => {
    const idx = entry.indexOf(':');
    const grantedAction = idx === -1 ? entry : entry.slice(0, idx);
    if (grantedAction !== action) return false;
    if (idx === -1) return true;
    // A targeted grant never covers a call whose target is unknown.
    return target !== undefined && globMatches(entry.slice(idx + 1), target);
  });
}

export interface ApprovalConfig {
  enabled: boolean;
  timeoutMs: number;          // default 300_000 (5 min)
  retryAsApproval: boolean;   // reserved for future implementation
  retryWindowMs: number;      // reserved for future implementation
  /**
   * #233: score ceiling (exclusive) for allow-30m / allow-session. Defaults to
   * the auto-deny threshold (95) so a blanket covers every askable action.
   */
  blanketCeiling?: number;
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

/**
 * Delivers an approval request. #218: it may resolve to the number of approvers
 * actually reached; `0` (or a rejection) means nobody can answer, so the queue
 * denies at once rather than waiting out the timeout. `void` is accepted for
 * handlers that cannot count recipients (treated as delivered).
 */
export type ApprovalSendFn = (message: string) => Promise<void | number>;

export class ApprovalQueue {
  private readonly _pending = new Map<string, PendingApproval>();
  private _sendFn: ApprovalSendFn | undefined;
  private _blanketAllowUntil = 0;         // epoch ms; 0 = no blanket; Number.MAX_SAFE_INTEGER = session
  private _blanketMaxScore = 0;           // max score covered by blanket
  private _blanketSessionScoped = false;  // true when allow-session set
  /** #233: per-job grants, keyed by the trusted job id the orchestrator assigns. */
  private readonly _grants = new Map<string, string[]>();

  constructor(private readonly _config: ApprovalConfig) {}

  /** Register the channel to send approval requests through */
  setSendHandler(fn: ApprovalSendFn): void {
    this._sendFn = fn;
  }

  /**
   * #218: the approver transport went away (e.g. the gateway stopped). Requests
   * already waiting can no longer be answered, so deny them now instead of
   * holding the job until the timeout. Fail closed; grants are untouched.
   */
  clearSendHandler(): void {
    this._sendFn = undefined;
    for (const entry of [...this._pending.values()]) {
      this._denyUnanswerable(entry, 'approver transport unavailable');
    }
  }

  /**
   * #233: let `jobId` do what `grant` names without asking. Merges with any
   * grant the job already has. Call `revokeJob()` when the job ends.
   */
  grantJob(jobId: string, grant: JobGrant): void {
    const entries = grant.filter((g) => typeof g === 'string' && g.trim().length > 0).map((g) => g.trim());
    if (entries.length === 0) return;
    const existing = this._grants.get(jobId) ?? [];
    this._grants.set(jobId, [...new Set([...existing, ...entries])]);
    log.info({ jobId, grant: this._grants.get(jobId) }, 'Job grant set');
  }

  /** #233: the job has ended; its grant goes with it. */
  revokeJob(jobId: string): void {
    this._grants.delete(jobId);
  }

  /** #233: the current grant for a job (for status display and tests). */
  getJobGrant(jobId: string): readonly string[] {
    return this._grants.get(jobId) ?? [];
  }

  /** Is the approval queue enabled? */
  isEnabled(): boolean {
    return this._config.enabled;
  }

  /**
   * #174: could request() with these arguments get an answer, rather than
   * auto-denying because no send handler is wired? Lets callers skip costly
   * work (LLM synthesis) whose result could only be discarded. It mirrors
   * request()'s own gates and never approves anything itself.
   */
  canDecide(opts: { score: number; bypassBlanketAllow?: boolean }): boolean {
    if (!this._config.enabled) return false;
    const blanketActive = this._blanketSessionScoped || Date.now() < this._blanketAllowUntil;
    if (blanketActive && !opts.bypassBlanketAllow && opts.score < this._blanketMaxScore) return true;
    return this._sendFn !== undefined;
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
    /** #233: what the action touches (a branch for git_push), for targeted grants. */
    target?: string;
  }): Promise<boolean> {
    // #233: a job grant covers its actions with no question. A session-risk
    // intercept (bypassBlanketAllow) is never covered: the composite score
    // says the job as a whole has drifted, which is what a grant trusts.
    const grant = this._grants.get(opts.jobId);
    if (grant && !opts.bypassBlanketAllow && grantCovers(grant, opts.action, opts.target)) {
      log.info({ jobId: opts.jobId, action: opts.action, target: opts.target }, 'Action covered by job grant');
      return true;
    }

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
      this._sendApprovalRequest(entry).then((reached) => {
        // #218: a send that reached no approver can never be answered.
        if (reached === 0) this._denyUnanswerable(entry, 'no approver reachable');
      }).catch(err => {
        log.error({ errName: err instanceof Error ? err.name : typeof err }, 'Failed to send approval request');
        this._denyUnanswerable(entry, 'approval request could not be delivered');
      });
    });
  }

  /** #218: resolve a pending request as denied immediately (idempotent). */
  private _denyUnanswerable(entry: PendingApproval, reason: string): void {
    if (this._pending.get(entry.id) !== entry) return;
    clearTimeout(entry.timer);
    this._pending.delete(entry.id);
    log.warn({ id: entry.id, tool: entry.tool, reason }, 'Approval request unanswerable — denying');
    entry.resolve(false);
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

    // #233: the blanket ceiling used to default to 80 and be configured from
    // the *flag* threshold, while only actions at or above the flag threshold
    // ever ask. So allow-30m / allow-session covered almost nothing that could
    // be asked about, and always_flag actions (asked at 85) never. The ceiling
    // is now the auto-deny threshold: a blanket covers every askable action,
    // and nothing that is auto-denied or human-only, which never reaches here.
    const blanketMaxScore = this._config.blanketCeiling ?? DEFAULT_BLANKET_CEILING;
    switch (decision) {
      case 'allow-job': {
        // #233: "yes, and don't ask this job again for this kind of action".
        this.grantJob(entry.jobId, [entry.action]);
        break;
      }
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

  /**
   * Parse "approve ZORA-XXXX allow" style messages. Returns null if not an approval command.
   *
   * #265: the leading slash is optional. Slack treats a DM that starts with
   * `/` as a slash command and refuses to send an unregistered one, so a
   * `/approve` reply to Zora's Slack DM never arrived. The match is anchored
   * at both ends: without the end anchor `allow-30m` matched as plain `allow`,
   * because the alternation tried `allow` first.
   */
  parseApprovalCommand(text: string): { token: string; decision: ApprovalDecision } | null {
    const match = /^\/?approve\s+(ZORA-[A-Z0-9]{4})\s+(allow-job|allow-30m|allow-session|allow|deny)\s*$/i.exec(text.trim());
    if (!match) return null;
    return {
      token: match[1]!.toUpperCase(),
      decision: match[2]!.toLowerCase() as ApprovalDecision,
    };
  }

  private async _sendApprovalRequest(entry: PendingApproval): Promise<void | number> {
    const timeoutMin = Math.round(this._config.timeoutMs / 60_000);
    const message =
      `⚠️ *Zora Action Approval Required*\n\n` +
      `Action: \`${entry.tool}\`\n` +
      `Task: \`${entry.action}\`\n` +
      `Risk: ${entry.score}/100 (${this._riskLabel(entry.score)})\n` +
      `Job: \`${entry.jobId}\`\n` +
      `Token: \`${entry.id}\`\n\n` +
      // #265: shown without the slash, which Slack would swallow; the parser
      // accepts it with or without.
      `Reply with:\n` +
      `  approve ${entry.id} allow — approve once\n` +
      `  approve ${entry.id} allow-job — approve, and don't ask again for this kind of action in this job\n` +
      `  approve ${entry.id} allow-30m — approve all similar (30 min)\n` +
      `  approve ${entry.id} allow-session — approve all this session\n` +
      `  approve ${entry.id} deny — block this action\n\n` +
      `Auto-denies in ${timeoutMin} minutes.`;

    return this._sendFn!(message);
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

/** #233: matches DEFAULT_IRREVERSIBILITY_THRESHOLDS.auto_deny. */
export const DEFAULT_BLANKET_CEILING = 95;

export const DEFAULT_APPROVAL_CONFIG: ApprovalConfig = {
  // #265: on by default. Off meant every action at or above the flag threshold
  // was a flat deny with no way for anyone to say yes, which is stricter than
  // asking, not safer. Turning it on loosens nothing by itself: with no
  // approver transport connected, request() still denies at once (#218), and
  // a timeout or a `deny` reply still denies. `[approval] enabled = false`
  // restores the old flat deny.
  enabled: true,
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
    // #265: only an explicit `false` turns the gate off.
    enabled: block['enabled'] !== false,
    timeoutMs: seconds * 1000,
  };
}
