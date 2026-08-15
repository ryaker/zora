/**
 * AuditLogHook — records every tool call in the hash-chained audit log.
 *
 * SEC-28: this hook used to `fs.appendFile` its own JSONL file, in its own
 * schema, next to the log `AuditLogger` writes. That gave Zora two audit logs
 * with two writers, and the tool log — the one recording what the agent
 * actually *did* — was the unchained one:
 *
 *   - no hash chain, so edits to the record of a tool call left no evidence;
 *   - no writer queue, so concurrent tool calls could interleave partial lines
 *     (`AuditLogger` serialises every write through a single Promise queue,
 *     which is the whole reason that queue exists);
 *   - a second schema (`ts`/`tool`/`arguments`) that `audit` had to normalise
 *     on read before it could show a tool call alongside a security event.
 *
 * The hook now owns no file. It redacts, maps the call into an `AuditEntry`,
 * and hands it to the one `AuditLogger` the orchestrator constructs — so tool
 * calls land in the same chained, serialised log as boot, shutdown and auth
 * events, and `audit --verify` covers them.
 *
 * Fires in the 'after' phase so the result is available. `runAfter` logs and
 * swallows hook errors, so a failed audit write cannot break a tool call — the
 * failure is reported by `AuditLogger` and again by the runner.
 */

import type { ToolHook, ToolCallContext, ToolHookResult } from '../tool-hook-runner.js';
import type { AuditLogger } from '../../security/audit-logger.js';

function redactSecrets(obj: unknown, depth = 0): unknown {
  if (depth > 5 || obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    return obj.replace(/(?:key|token|secret|password|auth|bearer)\s*[:=]\s*[^\s,}"']+/gi, (m) => {
      const colonIdx = m.search(/[:=]/);
      return m.slice(0, colonIdx + 1) + ' [REDACTED]';
    });
  }
  if (Array.isArray(obj)) return obj.map(v => redactSecrets(v, depth + 1));
  if (typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => {
        const sensitive = /key|token|secret|password|auth|bearer/i.test(k);
        return [k, sensitive ? '[REDACTED]' : redactSecrets(v, depth + 1)];
      })
    );
  }
  return obj;
}

/**
 * Coerce a redacted value into the object shape `AuditEntry.parameters` and
 * `.result` require.
 *
 * A tool result is frequently a bare string or array, and `AuditEntry` types
 * both fields as `Record<string, unknown>`. Wrapping under `output` matches
 * what the logger's own SDK path already wrote for non-object responses, so
 * one reader handles both.
 */
function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return { output: value };
}

export class AuditLogHook implements ToolHook {
  name = 'audit-log';
  phase = 'after' as const;

  constructor(private readonly _auditLogger: AuditLogger) {}

  async run(ctx: ToolCallContext): Promise<ToolHookResult> {
    await this._auditLogger.log({
      jobId: ctx.jobId,
      eventType: 'tool_invocation',
      timestamp: new Date().toISOString(),
      // The hook sits below the provider abstraction and is not told which one
      // ran the call. 'tool-hook' is the value `audit` already displayed for
      // lines from this hook, so the column does not change meaning.
      provider: 'tool-hook',
      toolName: ctx.tool,
      parameters: asRecord(redactSecrets(ctx.arguments)),
      // durationMs rides inside `result` rather than becoming a new AuditEntry
      // field: _computeHash() hashes a fixed field list, and adding to it would
      // change the hash of every previously written entry, breaking chain
      // verification on existing installs. `result` is already hashed.
      result: { ...asRecord(redactSecrets(ctx.result)), durationMs: ctx.durationMs },
    });

    return { allow: true };
  }
}
