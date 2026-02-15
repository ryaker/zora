/**
 * Shell command parsing and validation utilities.
 *
 * Pure functions extracted from PolicyEngine for shell tokenization,
 * command splitting, base command extraction, and read-only detection.
 *
 * These are stateless string parsers with no class dependencies.
 */

import path from 'node:path';

/**
 * Set of commands considered read-only (safe to execute even in dry-run).
 */
const READ_ONLY_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'which', 'pwd',
  'wc', 'diff', 'file', 'stat', 'echo', 'env', 'printenv', 'date', 'whoami',
]);

/**
 * Tokenize a shell command string into individual arguments.
 *
 * Handles POSIX shell quoting rules:
 * - Double quotes: interprets \\", \\\\, \\$, \\` as escape sequences.
 * - Single quotes: all characters are literal (no escape sequences).
 * - Backslash outside quotes: next character is taken literally.
 * - Whitespace outside quotes: terminates the current token.
 *
 * Returns unquoted token values (quotes and escapes are resolved).
 * Used by validateCommand to extract the base command name, and by
 * _checkCommandPaths to find path-like arguments.
 */
export function shellTokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let i = 0;

  const finishToken = () => {
    if (inToken) {
      tokens.push(current);
      current = '';
      inToken = false;
    }
  };

  while (i < input.length) {
    const ch = input[i]!;

    // Whitespace outside quotes ends the current token
    if (/\s/.test(ch)) {
      finishToken();
      i++;
      continue;
    }

    inToken = true;

    if (ch === '\\' && i + 1 < input.length) {
      // Backslash escape outside quotes: take next char literally
      current += input[i + 1];
      i += 2;
      continue;
    }

    if (ch === '"') {
      // Double-quoted string: handle \", \\, \$, \`
      i++; // skip opening "
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          const next = input[i + 1]!;
          if (next === '"' || next === '\\' || next === '$' || next === '`') {
            current += next;
            i += 2;
            continue;
          }
        }
        current += input[i];
        i++;
      }
      i++; // skip closing "
      continue;
    }

    if (ch === "'") {
      // Single-quoted string: everything is literal, no escape sequences
      i++; // skip opening '
      while (i < input.length && input[i] !== "'") {
        current += input[i];
        i++;
      }
      i++; // skip closing '
      continue;
    }

    // Regular character
    current += ch;
    i++;
  }

  finishToken();
  return tokens;
}

/**
 * Splits command chains on operators (&&, ||, ;, |) while respecting:
 * - Quoted strings (single and double) -- operators inside quotes are literal.
 * - Escape sequences -- backslash-escaped characters are not treated as operators.
 * - Command substitution -- $(...) and backtick blocks are treated as opaque.
 *   Nested $() is tracked via parenDepth to avoid premature splitting.
 *
 * Each returned string is a standalone command to validate independently.
 */
export function splitChainedCommands(command: string): string[] {
  const commands: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  let parenDepth = 0; // Track $(...) nesting
  let backtickDepth = 0;

  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;
    const nextChar = command[i + 1];

    // Handle escape sequences
    if (char === '\\' && !inQuote && i + 1 < command.length) {
      current += char + (nextChar ?? '');
      i++;
      continue;
    }
    if (char === '\\' && inQuote === '"' && i + 1 < command.length) {
      const next = nextChar ?? '';
      if (next === '"' || next === '\\' || next === '$' || next === '`') {
        current += char + next;
        i++;
        continue;
      }
    }

    // Track quote state
    if (char === '"' && inQuote !== "'") {
      inQuote = inQuote === '"' ? null : '"';
      current += char;
      continue;
    }
    if (char === "'" && inQuote !== '"') {
      inQuote = inQuote === "'" ? null : "'";
      current += char;
      continue;
    }

    // Track command substitution: $( ... )
    if (!inQuote && char === '$' && nextChar === '(') {
      // Enter command substitution and consume both "$("
      parenDepth++;
      current += '$(';
      i++;
      continue;
    }
    if (!inQuote && parenDepth > 0 && char === '(') {
      // Nested parentheses inside $(...) - increment depth
      parenDepth++;
      current += char;
      continue;
    }
    if (!inQuote && char === ')' && parenDepth > 0) {
      parenDepth--;
      current += char;
      continue;
    }

    // Track backtick command substitution
    if (!inQuote && char === '`') {
      backtickDepth = backtickDepth > 0 ? 0 : 1;
      current += char;
      continue;
    }

    // Only split on operators when not inside quotes or substitutions
    if (!inQuote && parenDepth === 0 && backtickDepth === 0) {
      if (char === ';') {
        if (current.trim()) commands.push(current.trim());
        current = '';
        continue;
      }
      if (char === '&' && nextChar === '&') {
        if (current.trim()) commands.push(current.trim());
        current = '';
        i++; // Skip second &
        continue;
      }
      if (char === '|' && nextChar === '|') {
        if (current.trim()) commands.push(current.trim());
        current = '';
        i++; // Skip second |
        continue;
      }
      if (char === '|') {
        if (current.trim()) commands.push(current.trim());
        current = '';
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) commands.push(current.trim());
  return commands;
}

/**
 * Extracts the base binary name from a command string, respecting quotes
 * and escape sequences.
 */
export function extractBaseCommand(command: string): string {
  const tokens = shellTokenize(command.trim());
  if (tokens.length === 0) return '';

  // Skip common variable assignments (e.g., "FOO=bar cmd")
  let cmdToken = tokens[0]!;
  let idx = 0;
  while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx]!)) {
    idx++;
  }
  if (idx < tokens.length) {
    cmdToken = tokens[idx]!;
  }

  return path.basename(cmdToken);
}

/**
 * Determine if a bash command is read-only.
 */
export function isReadOnlyCommand(command: string): boolean {
  const base = extractBaseCommand(command);
  if (READ_ONLY_COMMANDS.has(base)) return true;
  // git status, git log, git diff are read-only
  if (base === 'git') {
    const parts = command.trim().split(/\s+/);
    const subCommand = parts[1] ?? '';
    if (['status', 'log', 'diff', 'show', 'branch', 'remote', 'tag'].includes(subCommand)) {
      return true;
    }
  }
  return false;
}
