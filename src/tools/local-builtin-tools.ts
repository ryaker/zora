/**
 * Built-in tools for providers without an agent runtime — #254.
 *
 * On the `claude-sdk` path the SDK ships Read/Write/Edit/Bash/Glob/Grep. A
 * plain chat provider (Ollama) has none, so an Ollama primary could talk but
 * not act. These are minimal native equivalents.
 *
 * They use the SDK's tool names and argument names on purpose. Every gate in
 * the chain — `PolicyEngine.createCanUseTool()` (file_path / command / path),
 * `SensitiveFileGuardHook`, `ShellSafetyHook`, `RateLimitHook`,
 * `IrreversibilityScorerHook` — was written against those spellings (SEC-24).
 * Reusing them means the existing gates judge these tools with no new code;
 * inventing `read_file` would have needed every gate taught a new alias.
 *
 * Paths must be absolute (after `~` expansion, which mirrors
 * `PolicyEngine.validatePath`). A relative path would be resolved by the policy
 * check against the daemon's cwd and by the tool against the agent workspace —
 * two different files. Requiring absolute paths makes "the path policy judged"
 * and "the path that is opened" the same string.
 *
 * Deliberately absent: WebFetch/WebSearch (canUseTool has no domain check for
 * them yet; the SDK path has the same gap, and copying it to a second provider
 * is not the fix) and Task (subagents need the SDK).
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export interface LocalToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  input_schema: Record<string, unknown>;
  run: (input: Record<string, unknown>, ctx: { cwd: string; signal: AbortSignal }) => Promise<string>;
}

const MAX_OUTPUT_CHARS = 30_000;
const MAX_READ_LINES = 2_000;
const MAX_MATCHES = 200;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… [truncated ${text.length - MAX_OUTPUT_CHARS} chars]`
    : text;
}

function requireString(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== 'string' || v.length === 0) throw new Error(`'${key}' is required and must be a string`);
  return v;
}

/** `~` expansion as PolicyEngine does it, then insist on an absolute path. */
function absolutePath(input: Record<string, unknown>, key: string): string {
  const raw = requireString(input, key);
  const expanded = raw === '~' || raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(1)) : raw;
  if (!path.isAbsolute(expanded)) throw new Error(`'${key}' must be an absolute path, got '${raw}'`);
  return expanded;
}

/** Minimal glob → RegExp: `**` spans directories, `*` and `?` do not, `{a,b}` alternates. */
export function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') { i++; re += '(?:.*/)?'; } else { re += '.*'; }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = pattern.indexOf('}', i);
      if (end === -1) { re += '\\{'; continue; }
      re += `(?:${pattern.slice(i + 1, end).split(',').map(s => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`;
      i = end;
    } else {
      re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

async function* walk(root: string, signal: AbortSignal): AsyncGenerator<string> {
  const stack = [root];
  while (stack.length > 0) {
    if (signal.aborted) return;
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      // Symlinks are not followed: the policy check judged `root`, and a link
      // inside it could point anywhere.
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
      } else if (e.isFile()) {
        yield full;
      }
    }
  }
}

const Read: LocalToolDefinition = {
  name: 'Read',
  description: 'Read a text file. Returns numbered lines. Use offset/limit for large files.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file' },
      offset: { type: 'number', description: 'Line number to start from (1-based)' },
      limit: { type: 'number', description: `Number of lines to read (max ${MAX_READ_LINES})` },
    },
    required: ['file_path'],
  },
  async run(input) {
    const file = absolutePath(input, 'file_path');
    const lines = (await fs.readFile(file, 'utf8')).split('\n');
    const start = Math.max(1, Number(input['offset'] ?? 1));
    const limit = Math.min(MAX_READ_LINES, Math.max(1, Number(input['limit'] ?? MAX_READ_LINES)));
    const slice = lines.slice(start - 1, start - 1 + limit);
    return truncate(slice.map((l, i) => `${String(start + i).padStart(6)}\t${l}`).join('\n'));
  },
};

const Write: LocalToolDefinition = {
  name: 'Write',
  description: 'Create or overwrite a file with the given content.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file' },
      content: { type: 'string', description: 'Full file content' },
    },
    required: ['file_path', 'content'],
  },
  async run(input) {
    const file = absolutePath(input, 'file_path');
    const content = typeof input['content'] === 'string' ? input['content'] : '';
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, 'utf8');
    return `Wrote ${content.length} chars to ${file}`;
  },
};

const Edit: LocalToolDefinition = {
  name: 'Edit',
  description: 'Replace an exact string in a file. old_string must be unique unless replace_all is true.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file' },
      old_string: { type: 'string', description: 'Exact text to replace' },
      new_string: { type: 'string', description: 'Replacement text' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  async run(input) {
    const file = absolutePath(input, 'file_path');
    const oldStr = requireString(input, 'old_string');
    const newStr = typeof input['new_string'] === 'string' ? input['new_string'] : '';
    const text = await fs.readFile(file, 'utf8');
    const count = text.split(oldStr).length - 1;
    if (count === 0) throw new Error('old_string not found in file');
    if (count > 1 && input['replace_all'] !== true) {
      throw new Error(`old_string occurs ${count} times; make it unique or set replace_all`);
    }
    const updated = input['replace_all'] === true ? text.split(oldStr).join(newStr) : text.replace(oldStr, () => newStr);
    await fs.writeFile(file, updated, 'utf8');
    return `Edited ${file} (${input['replace_all'] === true ? count : 1} replacement${count > 1 && input['replace_all'] === true ? 's' : ''})`;
  },
};

const Bash: LocalToolDefinition = {
  name: 'Bash',
  description: 'Run a shell command in the agent workspace. Returns stdout, stderr and the exit code.',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to run' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default 120000, max 600000)' },
    },
    required: ['command'],
  },
  run(input, ctx) {
    const command = requireString(input, 'command');
    const timeout = Math.min(600_000, Math.max(1_000, Number(input['timeout'] ?? 120_000)));
    return new Promise((resolve) => {
      const child = spawn('bash', ['-c', command], { cwd: ctx.cwd, signal: ctx.signal, timeout });
      let out = '';
      child.stdout.on('data', (d) => { out += String(d); });
      child.stderr.on('data', (d) => { out += String(d); });
      child.on('error', (err) => resolve(truncate(`${out}\n[error] ${err.message}`)));
      child.on('close', (code, sig) => {
        resolve(truncate(`${out}${out.endsWith('\n') || !out ? '' : '\n'}[exit ${code ?? sig}]`));
      });
    });
  },
};

const Glob: LocalToolDefinition = {
  name: 'Glob',
  description: 'Find files under a directory matching a glob pattern such as "**/*.ts".',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern, relative to path' },
      path: { type: 'string', description: 'Absolute directory to search' },
    },
    required: ['pattern', 'path'],
  },
  async run(input, ctx) {
    const root = absolutePath(input, 'path');
    const re = globToRegExp(requireString(input, 'pattern'));
    const hits: string[] = [];
    for await (const file of walk(root, ctx.signal)) {
      if (re.test(path.relative(root, file).split(path.sep).join('/'))) hits.push(file);
      if (hits.length >= MAX_MATCHES) break;
    }
    return hits.length ? hits.join('\n') : 'No files matched';
  },
};

const Grep: LocalToolDefinition = {
  name: 'Grep',
  description: 'Search file contents under a directory with a regular expression. Returns path:line:text.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'JavaScript regular expression' },
      path: { type: 'string', description: 'Absolute directory or file to search' },
      glob: { type: 'string', description: 'Only search files matching this glob, e.g. "*.ts"' },
      case_insensitive: { type: 'boolean' },
    },
    required: ['pattern', 'path'],
  },
  async run(input, ctx) {
    const root = absolutePath(input, 'path');
    const re = new RegExp(requireString(input, 'pattern'), input['case_insensitive'] === true ? 'i' : '');
    const fileFilter = typeof input['glob'] === 'string' ? globToRegExp(input['glob'].includes('/') ? input['glob'] : `**/${input['glob']}`) : null;
    const stat = await fs.stat(root);
    const files: AsyncIterable<string> = stat.isFile() ? (async function* () { yield root; })() : walk(root, ctx.signal);
    const hits: string[] = [];
    for await (const file of files) {
      if (fileFilter && !fileFilter.test(path.relative(root, file).split(path.sep).join('/'))) continue;
      let text: string;
      try {
        const st = await fs.stat(file);
        if (st.size > 2 * 1024 * 1024) continue;
        text = await fs.readFile(file, 'utf8');
      } catch {
        continue;
      }
      if (text.includes('\u0000')) continue; // binary
      const lines = text.split('\n');
      for (let i = 0; i < lines.length && hits.length < MAX_MATCHES; i++) {
        if (re.test(lines[i]!)) hits.push(`${file}:${i + 1}:${lines[i]!.slice(0, 300)}`);
      }
      if (hits.length >= MAX_MATCHES) break;
    }
    return hits.length ? truncate(hits.join('\n')) : 'No matches';
  },
};

/** The built-in set, in the order offered to the model. */
export const LOCAL_BUILTIN_TOOLS: readonly LocalToolDefinition[] = [Read, Write, Edit, Bash, Glob, Grep];
