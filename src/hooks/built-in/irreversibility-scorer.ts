/**
 * IrreversibilityScorerHook — scores tool calls for irreversibility (0-100).
 *
 * score < warn threshold    → allow, log debug
 * score ≥ warn threshold    → allow, log warn
 * score ≥ flag threshold    → escalate to the ApprovalQueue; allow if a human
 *                             approves, else deny with "approval_required:{score}"
 * score ≥ auto_deny (95+)   → deny with reason "auto_denied:{score}"
 *
 * SEC-27: that flag branch used to be a plain deny. The reason string named an
 * ApprovalQueue that nothing ever called, so the flag threshold behaved as a
 * second auto-deny threshold and there was no way for a human to say yes. The
 * queue arrives via `setApprovalQueue()` from `Orchestrator.boot()`; when there
 * is no enabled queue the branch denies exactly as it did before.
 */
import { createLogger } from '../../utils/logger.js';
import type { ToolHook, ToolCallContext, ToolHookResult } from '../tool-hook-runner.js';
import { getGlobalForecaster } from '../../core/memory-risk-forecaster.js';
import { getAgentPolicy, checkScoreLimit } from '../../core/project-policy.js';
import { normalizeToolName } from '../../security/tool-names.js';
import type { ApprovalQueue } from '../../core/approval-queue.js';
import { ZORA_MCP_SERVER_NAME } from '../../tools/zora-mcp-server.js';

const log = createLogger('irreversibility-scorer');

export interface IrreversibilityConfig {
  scores: Record<string, number>;    // action-key → 0-100
  thresholds: {
    warn: number;      // default 40
    flag: number;      // default 65
    auto_deny: number; // default 95
  };
  /**
   * #265: MCP servers whose sends speak as Zora itself (its own Slack bot, its
   * own Telegram bot), from `[mcp.servers.<name>] acts_as = "zora"`. A send
   * through one of these is Zora conversing, not Zora posting as Richard, so it
   * scores as `send_as_zora` and does not ask. Every other server is assumed to
   * act as the user. `zora-tools` is always included.
   */
  selfIdentityServers?: readonly string[];
}

/**
 * Tool name → action key, for the `[actions.scores]` lookup.
 *
 * SEC-24: every key here is a *normalised* tool name (MCP prefix stripped,
 * lowercase), because that is the only form `toolToAction()` ever looks up.
 * Adding a PascalCase key would be dead weight.
 *
 * The SDK's own spellings — `Bash`, `Read`, `Write`, `Edit` — used to be absent
 * entirely: the map held only Zora's lowercase vocabulary and the lookup was
 * `mapping[tool]`, so a real call fell through to `mapping[tool] ?? tool` with
 * an unknown key and was scored at the 50-point default for *everything*.
 * `Read` was scored 50 instead of 5; `Write` and `Edit` 50 instead of 20; and a
 * `[actions.scores]` entry raising `shell_exec` above the flag threshold had no
 * effect on `Bash` at all, so the ApprovalQueue gate for destructive shell
 * operations was evaluated against a category the user never configured.
 */
const TOOL_ACTION_MAP: Record<string, string> = {
  // ── shell ──
  bash: 'shell_exec',
  bashoutput: 'shell_exec',
  killshell: 'shell_exec',
  shell: 'shell_exec',
  execute_bash: 'shell_exec',
  execute_command: 'shell_exec',
  run_command: 'shell_exec',
  // ── writes ──
  write: 'write_file',
  write_file: 'write_file',
  create_file: 'write_file',
  edit: 'edit_file',
  edit_file: 'edit_file',
  multiedit: 'edit_file',
  notebookedit: 'edit_file',
  str_replace_editor: 'edit_file',
  // ── reads ──
  read: 'read_file',
  read_file: 'read_file',
  glob: 'read_file',
  grep: 'read_file',
  // Memory retrieval is a read (~5), not an unscored unknown action (#194c, #184 c).
  memory_search: 'read_file',
  recall_context: 'read_file',
  // ── git ──
  git_commit: 'git_commit',
  git_push: 'git_push',
  // ── filesystem ──
  mkdir: 'mkdir',
  cp: 'cp',
  mv: 'mv',
  delete_file: 'file_delete',
  rm: 'file_delete',
  // ── outbound ──
  send_message: 'send_message',
  http_request: 'http_request',
  fetch: 'http_request',
  webfetch: 'http_request',
  websearch: 'http_request',
  // ── agents ──
  task: 'spawn_agent',
  spawn_agent: 'spawn_agent',
  spawn_zora_agent: 'spawn_agent',
};

/**
 * Map a tool name to its action key for scoring lookup.
 *
 * Exported so `tests/security/tool-name-normalization.test.ts` can assert that
 * every name the SDK actually calls resolves to a scored category — a check
 * that fails loudly if the map drifts from the SDK's vocabulary again.
 */
export function toolToAction(tool: string, selfIdentityServers: readonly string[] = []): string {
  const normalized = normalizeToolName(tool);
  const mapped = TOOL_ACTION_MAP[normalized];
  if (mapped === 'send_message') {
    return isSelfIdentityServer(tool, selfIdentityServers) ? 'send_as_zora' : mapped;
  }
  if (mapped) return mapped;
  // #265: classify unmapped tools by what they do. Before this, a connector's
  // `send_email` or `delete_event` resolved to its own name, had no score and
  // fell through to the 50-point default — under the flag threshold, so it ran
  // without asking while Zora's own `send_message` (80) asked. A send through
  // a connector that acts as Richard now asks; one that acts as Zora does not.
  const effect = classifyByEffect(normalized);
  if (effect === 'send') {
    return isSelfIdentityServer(tool, selfIdentityServers) ? 'send_as_zora' : 'send_message';
  }
  if (effect === 'delete') return 'remote_delete';
  return normalized;
}

/** Read-shaped verbs: a tool that starts with one of these never sends or deletes. */
const READ_VERBS = new Set(['get', 'list', 'read', 'search', 'fetch', 'view', 'find', 'query', 'describe', 'show', 'download']);
/** Verbs that put something in front of another person. Drafts are not sends. */
const SEND_VERBS = new Set(['send', 'post', 'reply', 'forward', 'publish', 'tweet', 'share', 'invite', 'respond', 'schedule', 'broadcast']);
/** Verbs that remove something outside the local filesystem. */
// `remove` and `archive` are left out on purpose: `remove_label` and
// `archive_thread` are everyday, reversible tidying, and asking about them is
// the "approval for every little thing" this change exists to stop.
const DELETE_VERBS = new Set(['delete', 'trash', 'purge', 'destroy', 'erase', 'unpublish']);

/**
 * #265: effect classification on a normalised tool name's `_`/`-` tokens.
 * Deliberately conservative: a read verb anywhere in leading position wins, so
 * `get_message` and `list_scheduled_posts` stay reads.
 */
export function classifyByEffect(normalized: string): 'send' | 'delete' | null {
  const tokens = normalized.split(/[_\-.]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (READ_VERBS.has(tokens[0]!)) return null;
  // `slack_send_message`: the verb may follow a service prefix.
  if (tokens.some((t) => DELETE_VERBS.has(t))) return 'delete';
  if (tokens.some((t) => SEND_VERBS.has(t))) return 'send';
  return null;
}

/** The server segment of `mcp__<server>__<tool>`, or undefined for a bare name. */
function mcpServerOf(tool: string): string | undefined {
  const parts = tool.trim().split('__');
  return parts.length >= 3 && parts[0]!.toLowerCase() === 'mcp' ? parts[1]!.toLowerCase() : undefined;
}

/**
 * #265: does this tool speak as Zora? Only an MCP-qualified name can: a bare
 * name has no server, so there is nothing to vouch for its identity and it is
 * treated as acting for the user.
 */
function isSelfIdentityServer(tool: string, selfIdentityServers: readonly string[]): boolean {
  const server = mcpServerOf(tool);
  if (!server) return false;
  if (server === ZORA_TOOLS_SERVER) return true;
  return selfIdentityServers.some((s) => s.toLowerCase() === server);
}

/** Zora's own MCP server: anything it sends is Zora speaking. */
const ZORA_TOOLS_SERVER = ZORA_MCP_SERVER_NAME.toLowerCase();

export class IrreversibilityScorerHook implements ToolHook {
  readonly name = 'irreversibility-scorer';
  readonly phase = 'before' as const;

  private _approvalQueue: ApprovalQueue | undefined;

  constructor(private readonly _config: IrreversibilityConfig) {}

  /**
   * SEC-27: registers the human-in-the-loop gate this hook escalates to.
   *
   * Without it the `approval_required:{score}` branch is a dead end: the string
   * named a queue that was never consulted, so "flag for approval" and "deny
   * outright" were the same outcome and the whole flag threshold acted as a
   * second auto-deny threshold. Wired from `Orchestrator.boot()`, so both entry
   * points get it.
   */
  setApprovalQueue(queue: ApprovalQueue): void {
    this._approvalQueue = queue;
  }

  /**
   * SEC-27: asks the human, and denies if there is nobody to ask.
   *
   * Fail-closed is preserved on every path that is not an explicit approval:
   * no queue registered, `approval.enabled=false` (the default, so default
   * behaviour is exactly what it was before this gap), no send handler
   * registered, a timeout, or a `deny` reply all end in the same denial the
   * hook used to return unconditionally. The only new outcome is a human
   * saying yes.
   *
   * The original `approval_required:{score}` reason is kept as the prefix of
   * the denial rather than replaced, because the audit log and
   * `tests/unit/hooks/sdk-tool-names.test.ts` both key off that shape.
   */
  private async _requestApproval(
    ctx: ToolCallContext,
    score: number,
    reason: string,
    options: { bypassBlanketAllow?: boolean } = {},
  ): Promise<ToolHookResult> {
    const queue = this._approvalQueue;
    if (!queue?.isEnabled()) {
      return { allow: false, reason };
    }

    const approved = await queue.request({
      action: toolToAction(ctx.tool, this._config.selfIdentityServers),
      score,
      jobId: ctx.jobId,
      tool: ctx.tool,
      ...(options.bypassBlanketAllow ? { bypassBlanketAllow: true } : {}),
    });

    if (approved) {
      log.warn({ tool: ctx.tool, score, jobId: ctx.jobId }, 'Action approved by human — proceeding');
      return { allow: true };
    }

    log.warn({ tool: ctx.tool, score, jobId: ctx.jobId }, 'Action denied at approval gate');
    return { allow: false, reason: `${reason} — denied at approval gate` };
  }

  async run(ctx: ToolCallContext): Promise<ToolHookResult> {
    const actionKey = toolToAction(ctx.tool, this._config.selfIdentityServers);
    const score = this._config.scores[actionKey] ?? 50;  // default 50 for unknown

    // Check project policy score ceiling FIRST — it may be tighter than global thresholds.
    // TODO: agentId not in ToolCallContext — using jobId as proxy until threaded through.
    const agentPolicy = getAgentPolicy(ctx.jobId);
    if (agentPolicy) {
      const policyCheck = checkScoreLimit(score, agentPolicy);
      if (!policyCheck.allowed) {
        log.warn({ tool: ctx.tool, score, jobId: ctx.jobId }, policyCheck.reason);
        return { allow: false, reason: `project_policy:${policyCheck.reason}` };
      }
    }

    if (score >= this._config.thresholds.auto_deny) {
      log.warn({ tool: ctx.tool, score, jobId: ctx.jobId }, 'Action auto-denied: max irreversibility');
      // Record denial in forecaster (score=100 to reflect maximum irreversibility toward commitment creep)
      if (ctx.jobId) {
        const forecaster = getGlobalForecaster();
        forecaster?.record(ctx.jobId, {
          timestamp: new Date().toISOString(),
          sessionId: ctx.jobId,
          tool: ctx.tool,
          irreversibilityScore: 100,
          jobId: ctx.jobId,
        });
      }
      return { allow: false, reason: `auto_denied:${score} — irreversibility score ${score}/100 exceeds auto-deny threshold` };
    }

    if (score >= this._config.thresholds.flag) {
      log.warn({ tool: ctx.tool, score, jobId: ctx.jobId }, 'Action flagged for approval');
      // SEC-27: escalate rather than dead-end. Denies exactly as before when
      // there is no enabled queue to escalate to.
      return await this._requestApproval(ctx, score, `approval_required:${score}`);
    }

    if (score >= this._config.thresholds.warn) {
      log.warn({ tool: ctx.tool, score, jobId: ctx.jobId }, 'High-irreversibility action (allowed)');
    } else {
      log.debug({ tool: ctx.tool, score }, 'Irreversibility score');
    }

    // Record allowed action in MemoryRiskForecaster and check session-level risk
    const forecaster = getGlobalForecaster();
    if (forecaster && ctx.jobId) {
      const riskScores = forecaster.record(ctx.jobId, {
        timestamp: new Date().toISOString(),
        sessionId: ctx.jobId,
        tool: ctx.tool,
        irreversibilityScore: score,
        jobId: ctx.jobId,
      });

      if (forecaster.shouldAutoDeny(ctx.jobId)) {
        log.error({ jobId: ctx.jobId, composite: riskScores.composite }, 'Session auto-denied: critical risk pattern detected');
        return { allow: false, reason: `session_risk_critical:${riskScores.composite} — ${forecaster.getSummary(ctx.jobId)}` };
      }

      if (forecaster.shouldIntercept(ctx.jobId)) {
        log.warn({ jobId: ctx.jobId, composite: riskScores.composite }, 'Session flagged: elevated risk pattern detected');
        // SEC-27: the session-risk intercept emits the same reason class and so
        // gets the same gate. The composite score — not the per-action score —
        // is what the approver is shown, since the composite is what tripped it.
        // SEC-27 (review finding): the composite is a *session* risk score and
        // the blanket-allow ceiling is configured from the *per-action* flag
        // threshold — different scales. Without this, `auto_approve_low_risk`
        // silently auto-approved an elevated-risk session intercept whenever
        // the composite happened to fall under 65, and the warning above was
        // the only trace. A session intercept always asks a human.
        return await this._requestApproval(
          ctx,
          riskScores.composite,
          `approval_required:${riskScores.composite} (session risk — ${forecaster.getSummary(ctx.jobId)})`,
          { bypassBlanketAllow: true },
        );
      }
    }

    return { allow: true };
  }
}

/** Default action scores — matches policy.toml [actions.scores] defaults */
export const DEFAULT_IRREVERSIBILITY_SCORES: Record<string, number> = {
  read_file:              5,
  write_file:             20,
  edit_file:              20,
  git_commit:             30,
  mkdir:                  10,
  cp:                     15,
  mv:                     40,
  git_push:               70,
  shell_exec:             50,
  shell_exec_destructive: 90,
  send_message:           80,
  // #265: Zora conversing as itself (its own bot in a channel, replying to
  // Richard). Richard, 2026-11-28: talking to him in Slack should not need an
  // approval on send; posting *as him* is what asks (send_message above).
  send_as_zora:           10,
  spawn_agent:            15,
  // #265: was 95, which equals auto_deny, so a delete was refused even when a
  // human said yes. Every comparable assistant (Claude Duet, OpenAI dots, Meta
  // Muse) asks before deleting rather than refusing; 85 asks.
  file_delete:            85,
  remote_delete:          85,
  http_request:           30,
};

export const DEFAULT_IRREVERSIBILITY_THRESHOLDS = {
  warn: 40,
  flag: 65,
  auto_deny: 95,
};
