/**
 * IrreversibilityScorerHook — scores tool calls for irreversibility (0-100).
 *
 * score < warn threshold    → allow, log debug
 * score ≥ warn threshold    → allow, log warn
 * score ≥ flag threshold    → deny with reason "approval_required:{score}"
 * score ≥ auto_deny (95+)   → deny with reason "auto_denied:{score}"
 */
import { createLogger } from '../../utils/logger.js';
import type { ToolHook, ToolCallContext, ToolHookResult } from '../tool-hook-runner.js';
import { getGlobalForecaster } from '../../core/memory-risk-forecaster.js';
import { getAgentPolicy, checkScoreLimit } from '../../core/project-policy.js';
import { normalizeToolName } from '../../security/tool-names.js';

const log = createLogger('irreversibility-scorer');

export interface IrreversibilityConfig {
  scores: Record<string, number>;    // action-key → 0-100
  thresholds: {
    warn: number;      // default 40
    flag: number;      // default 65
    auto_deny: number; // default 95
  };
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
export function toolToAction(tool: string): string {
  const normalized = normalizeToolName(tool);
  return TOOL_ACTION_MAP[normalized] ?? normalized;
}

export class IrreversibilityScorerHook implements ToolHook {
  readonly name = 'irreversibility-scorer';
  readonly phase = 'before' as const;

  constructor(private readonly _config: IrreversibilityConfig) {}

  async run(ctx: ToolCallContext): Promise<ToolHookResult> {
    const actionKey = toolToAction(ctx.tool);
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
      return { allow: false, reason: `approval_required:${score}` };
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
        return { allow: false, reason: `approval_required:${riskScores.composite} (session risk — ${forecaster.getSummary(ctx.jobId)})` };
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
  spawn_agent:            15,
  file_delete:            95,
  http_request:           30,
};

export const DEFAULT_IRREVERSIBILITY_THRESHOLDS = {
  warn: 40,
  flag: 65,
  auto_deny: 95,
};
