/**
 * CodeToolRunner — Tier 1 deterministic tool implementations for TLCI.
 *
 * Each function corresponds to a `suggestedCodeTool` hint from the StepClassifier.
 * Callers pass structured parameters via `step.context`.
 *
 * Context keys (caller-provided):
 *   httpFetch:   { url: string, headers?: Record<string,string> }
 *   httpPost:    { url: string, body?: unknown, headers?: Record<string,string> }
 *   transform:   { data: unknown, operation?: 'json-parse'|'json-stringify'|'to-array'|'flatten' }
 *   collectionOp:{ data: unknown[], operation?: 'sort'|'filter'|'count'|'deduplicate', key?: string, value?: unknown }
 *   fileOp:      { path: string, operation?: 'read'|'write'|'list'|'exists', content?: string }
 *   compute:     { expression: string }       — safe arithmetic only (no eval)
 *   validate:    { data: unknown, required?: string[] }
 *   notify:      { message: string, channel?: string }
 *   dbQuery:     { query: string }            — stub; real DB wired by caller
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createLogger } from '../utils/logger.js';

const log = createLogger('code-tool-runner');

/**
 * Segment-aware path containment check.
 * Prevents /tmp matching /tmp-evil by requiring a path separator after the root.
 * Expands leading ~ to os.homedir() before resolving.
 */
function isInsideDir(normalizedPath: string, root: string): boolean {
  const resolvedRoot = path.resolve(root.replace(/^~/, os.homedir()));
  return normalizedPath === resolvedRoot ||
    normalizedPath.startsWith(resolvedRoot + path.sep);
}

function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme "${parsed.protocol}" — only http/https allowed`);
  }
  const host = parsed.hostname.toLowerCase();
  // Block literal private/metadata IP ranges and known internal hostnames.
  // KNOWN LIMITATION: DNS-rebinding attacks (public hostname → private IP) are not
  // prevented here because pre-resolution DNS checks have an inherent TOCTOU race.
  // For production hardening, use a network-level egress proxy or firewall instead.
  const BLOCKED = [
    /^localhost$/,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,   // link-local / AWS metadata
    /^::1$/,                     // IPv6 loopback (URL parser strips brackets)
    /^::ffff:/,                  // IPv4-mapped IPv6 (e.g. ::ffff:192.168.1.1)
    /^0+:0+:0+:0+:0+:0+:0+:1$/, // full-form IPv6 loopback
    /^metadata\.google\.internal$/,
  ];
  if (BLOCKED.some(r => r.test(host))) {
    throw new Error(`Blocked host "${host}" — private/metadata addresses not allowed`);
  }
}

export interface CodeToolResult {
  tool: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

type StepContext = Record<string, unknown>;

// ─── Individual tool implementations ─────────────────────────────────────────

async function runHttpFetch(ctx: StepContext): Promise<CodeToolResult> {
  const url = ctx['url'] as string | undefined;
  if (!url) return { tool: 'httpFetch', success: false, error: 'context.url required' };

  const headers = (ctx['headers'] as Record<string, string> | undefined) ?? {};
  try { validateUrl(url); } catch (err) { return { tool: 'httpFetch', success: false, error: String(err) }; }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);
    const text = await res.text();
    let data: unknown = text;
    try { data = JSON.parse(text); } catch { /* keep raw text */ }
    log.debug({ url, status: res.status }, 'httpFetch complete');
    return { tool: 'httpFetch', success: res.ok, data };
  } catch (err) {
    return { tool: 'httpFetch', success: false, error: String(err) };
  }
}

async function runHttpPost(ctx: StepContext): Promise<CodeToolResult> {
  const url = ctx['url'] as string | undefined;
  if (!url) return { tool: 'httpPost', success: false, error: 'context.url required' };

  const body = ctx['body'];
  const headers = (ctx['headers'] as Record<string, string> | undefined) ?? { 'Content-Type': 'application/json' };
  try { validateUrl(url); } catch (err) { return { tool: 'httpPost', success: false, error: String(err) }; }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await res.text();
    let data: unknown = text;
    try { data = JSON.parse(text); } catch { /* keep raw text */ }
    log.debug({ url, status: res.status }, 'httpPost complete');
    return { tool: 'httpPost', success: res.ok, data };
  } catch (err) {
    return { tool: 'httpPost', success: false, error: String(err) };
  }
}

function runTransform(ctx: StepContext): CodeToolResult {
  const data = ctx['data'];
  const operation = (ctx['operation'] as string | undefined) ?? 'json-stringify';

  try {
    let result: unknown;
    switch (operation) {
      case 'json-parse':
        result = typeof data === 'string' ? JSON.parse(data) : data;
        break;
      case 'json-stringify':
        result = JSON.stringify(data, null, 2);
        break;
      case 'to-array':
        result = Array.isArray(data) ? data : data !== undefined ? [data] : [];
        break;
      case 'flatten':
        result = Array.isArray(data) ? data.flat(Infinity) : data;
        break;
      default:
        result = data;
    }
    return { tool: 'transform', success: true, data: result };
  } catch (err) {
    return { tool: 'transform', success: false, error: String(err) };
  }
}

function runCollectionOp(ctx: StepContext): CodeToolResult {
  const raw = ctx['data'];
  const arr = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [];
  const operation = (ctx['operation'] as string | undefined) ?? 'count';
  const key = ctx['key'] as string | undefined;
  const value = ctx['value'];

  try {
    let result: unknown;
    switch (operation) {
      case 'count':
        result = arr.length;
        break;
      case 'filter':
        result = key !== undefined
          ? arr.filter((item) => typeof item === 'object' && item !== null && (item as Record<string, unknown>)[key] === value)
          : arr;
        break;
      case 'sort':
        result = key !== undefined
          ? [...arr].sort((a, b) => {
              const av = typeof a === 'object' && a !== null ? (a as Record<string, unknown>)[key] : a;
              const bv = typeof b === 'object' && b !== null ? (b as Record<string, unknown>)[key] : b;
              if (av === undefined && bv === undefined) return 0;
              if (av === undefined) return 1;
              if (bv === undefined) return -1;
              return av < bv ? -1 : av > bv ? 1 : 0;
            })
          : [...arr].sort();
        break;
      case 'deduplicate':
        result = key !== undefined
          ? [...new Map(arr.map((item) => [(item as Record<string, unknown>)[key], item])).values()]
          : [...new Set(arr)];
        break;
      case 'sum':
        result = arr.reduce((acc: number, item) => {
          const v = key !== undefined && typeof item === 'object' && item !== null
            ? Number((item as Record<string, unknown>)[key])
            : Number(item);
          return acc + (isNaN(v) ? 0 : v);
        }, 0);
        break;
      default:
        result = arr;
    }
    return { tool: 'collectionOp', success: true, data: result };
  } catch (err) {
    return { tool: 'collectionOp', success: false, error: String(err) };
  }
}

/** Path validator injected from PolicyEngine — undefined means use built-in defaults. */
export type PathValidator = (normalizedPath: string) => { allowed: boolean; reason?: string };

async function runFileOp(ctx: StepContext, policyValidator?: PathValidator): Promise<CodeToolResult> {
  const filePath = ctx['path'] as string | undefined;
  if (!filePath) return { tool: 'fileOp', success: false, error: 'context.path required' };

  const expanded = filePath.replace(/^~/, os.homedir());
  const normalized = path.resolve(expanded);

  if (normalized.includes('\0')) {
    return { tool: 'fileOp', success: false, error: 'Path traversal attempt blocked' };
  }

  // If a PolicyEngine validator was injected, use it — it reflects the user's actual policy.
  if (policyValidator) {
    const check = policyValidator(normalized);
    if (!check.allowed) {
      return { tool: 'fileOp', success: false, error: `Path "${normalized}" denied by policy${check.reason ? ': ' + check.reason : ''}` };
    }
  } else {
    // Fallback built-in defaults when no policy is injected.
    // Use isInsideDir() — segment-aware — to prevent /tmp matching /tmp-evil.
    const home = os.homedir();
    const ALLOWED_ROOTS = [
      path.join(home, '.zora'),
      path.join(home, 'Dev'),
      path.join(home, 'Documents'),
      '/tmp', '/private/tmp', os.tmpdir(),
      process.cwd(),
    ];
    const BLOCKED_ROOTS = [
      path.join(home, '.ssh'),
      path.join(home, '.gnupg'),
      path.join(home, '.aws'),
      path.join(home, '.env'),
      '/etc', '/sys', '/proc',
    ];
    if (BLOCKED_ROOTS.some(r => isInsideDir(normalized, r))) {
      return { tool: 'fileOp', success: false, error: `Path "${normalized}" is in a blocked directory` };
    }
    if (!ALLOWED_ROOTS.some(r => isInsideDir(normalized, r))) {
      return { tool: 'fileOp', success: false, error: `Path "${normalized}" is outside the allowed workspace` };
    }
  }

  const operation = (ctx['operation'] as string | undefined) ?? 'read';

  try {
    let data: unknown;
    switch (operation) {
      case 'read': {
        const raw = await fs.readFile(normalized, 'utf-8');
        try { data = JSON.parse(raw); } catch { data = raw; }
        break;
      }
      case 'write': {
        const content = ctx['content'];
        const str = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
        await fs.writeFile(normalized, str, 'utf-8');
        data = { written: str.length };
        break;
      }
      case 'list': {
        const entries = await fs.readdir(normalized, { withFileTypes: true });
        data = entries.map(e => ({ name: e.name, isDir: e.isDirectory() }));
        break;
      }
      case 'exists': {
        try { await fs.access(normalized); data = true; } catch { data = false; }
        break;
      }
      default:
        return { tool: 'fileOp', success: false, error: `Unknown operation: ${operation}` };
    }
    log.debug({ path: normalized, operation }, 'fileOp complete');
    return { tool: 'fileOp', success: true, data };
  } catch (err) {
    return { tool: 'fileOp', success: false, error: String(err) };
  }
}

function runCompute(ctx: StepContext): CodeToolResult {
  const expression = ctx['expression'] as string | undefined;
  if (!expression) return { tool: 'compute', success: false, error: 'context.expression required' };

  // Safe: only allow numbers, operators, parentheses, spaces, dots
  if (!/^[\d\s+\-*/().%]+$/.test(expression)) {
    return { tool: 'compute', success: false, error: 'Expression contains disallowed characters (only arithmetic allowed)' };
  }
  try {
    // Use Function constructor with no scope — safe for pure arithmetic
    // eslint-disable-next-line no-new-func
    const result = new Function(`"use strict"; return (${expression});`)() as number;
    return { tool: 'compute', success: true, data: result };
  } catch (err) {
    return { tool: 'compute', success: false, error: String(err) };
  }
}

function runValidate(ctx: StepContext): CodeToolResult {
  const data = ctx['data'];
  const required = ctx['required'] as string[] | undefined;

  if (!required || required.length === 0) {
    return { tool: 'validate', success: true, data: { valid: data !== null && data !== undefined } };
  }

  if (typeof data !== 'object' || data === null) {
    return { tool: 'validate', success: true, data: { valid: false, missing: required } };
  }

  const obj = data as Record<string, unknown>;
  const missing = required.filter(k => !(k in obj) || obj[k] === null || obj[k] === undefined);
  return { tool: 'validate', success: true, data: { valid: missing.length === 0, missing } };
}

function runNotify(ctx: StepContext): CodeToolResult {
  const message = (ctx['message'] as string | undefined) ?? 'Notification';
  const channel = (ctx['channel'] as string | undefined) ?? 'log';
  log.info({ channel, message }, 'tlci notify step');
  return { tool: 'notify', success: true, data: { sent: true, channel, message } };
}

async function runDbQuery(ctx: StepContext): Promise<CodeToolResult> {
  // Stub — real DB connection is caller-provided via context.execute fn
  const query = ctx['query'] as string | undefined;
  const executeFn = ctx['execute'] as ((q: string) => Promise<unknown>) | undefined;
  if (executeFn && query) {
    try {
      const rows = await executeFn(query);
      return { tool: 'dbQuery', success: true, data: rows };
    } catch (err) {
      return { tool: 'dbQuery', success: false, error: String(err) };
    }
  }
  // No executor injected — fail loudly rather than silently faking database work.
  // The classifier routes "query database" steps here; without an executor they must not
  // pretend to succeed. Callers must provide context.execute to use this tool.
  log.warn({ query }, 'dbQuery step has no executor — returning error (not silently stubbing)');
  return {
    tool: 'dbQuery',
    success: false,
    error: 'dbQuery requires context.execute (a function returning Promise<unknown>) — no stub execution. Provide an executor or reclassify this step.',
  };
}

// ─── Dispatch table ───────────────────────────────────────────────────────────

const SYNC_TOOLS: Record<string, (ctx: StepContext) => CodeToolResult> = {
  transform: runTransform,
  collectionOp: runCollectionOp,
  compute: runCompute,
  validate: runValidate,
  notify: runNotify,
};

const ASYNC_TOOLS: Record<string, (ctx: StepContext) => Promise<CodeToolResult>> = {
  httpFetch: runHttpFetch,
  httpPost: runHttpPost,
  fileOp: runFileOp,
  dbQuery: runDbQuery,
};

// ─── Public runner ────────────────────────────────────────────────────────────

/**
 * Execute a Tier 1 code tool step.
 * Returns a CodeToolResult — callers may inspect result.data for downstream steps.
 */
export async function runCodeTool(
  tool: string,
  context: StepContext = {},
  policyValidator?: PathValidator,
): Promise<CodeToolResult> {
  // fileOp is the only tool that needs path policy checks — pass validator through
  if (tool === 'fileOp') return runFileOp(context, policyValidator);
  const asyncFn = ASYNC_TOOLS[tool];
  if (asyncFn) return asyncFn(context);

  const syncFn = SYNC_TOOLS[tool];
  if (syncFn) return syncFn(context);

  // Unknown tool — log and pass through
  log.info({ tool }, 'tlci code-tool step (no implementation for this tool — pass-through)');
  return { tool, success: true, data: null };
}

/**
 * Resolve the suggested tool from a ClassifiedStep and run it.
 * The step's `context` field holds structured parameters.
 */
export async function runCodeToolStep(step: {
  id: string;
  suggestedCodeTool?: string;
  context?: Record<string, unknown>;
  description: string;
  policyValidator?: PathValidator;
}): Promise<CodeToolResult> {
  const tool = step.suggestedCodeTool ?? 'pass-through';
  const ctx = step.context ?? {};
  log.debug({ stepId: step.id, tool }, 'running code tool');
  return runCodeTool(tool, ctx, step.policyValidator);
}
