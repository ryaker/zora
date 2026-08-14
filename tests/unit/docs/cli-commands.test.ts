/**
 * DOC-12 — CLI command drift guard.
 *
 * Drift this prevents: docs telling a reader to run `zora-agent audit verify`
 * or `zora-agent reputation reset` when no such command is registered. A
 * copy-pasted command that exits with "unknown command" is the single most
 * expensive kind of doc rot — it is the first thing a new user hits, and it
 * makes every other instruction on the page suspect.
 *
 * How it decides: `src/cli/**` is the source of truth. The registration tree is
 * recovered statically (no importing the CLI, which would parse argv and run):
 * every `<receiver>.command('name')` call is collected, and receivers bound with
 * `const x = program.command('group')` become the parent of their subcommands.
 * `src/cli/edit-commands.ts` registers one command per key of a lookup table
 * rather than per literal, so table keys are collected too.
 *
 * A doc's first token after `zora-agent` must be a registered top-level command.
 * The second token is checked only when the first names a command group, so
 * prose like "run `zora-agent start` to launch the daemon" is not mistaken for a
 * subcommand. Options (`--verify`) are ignored — they are not commands.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT,
  formatFindings,
  isAllowed,
  loadDocs,
  stripTsComments,
  type Finding,
} from './doc-drift-helpers.js';

const CLI_DIR = path.join(REPO_ROOT, 'src/cli');

/** Map of top-level command name -> set of its subcommand names. */
function registeredCommands(): Map<string, Set<string>> {
  const tree = new Map<string, Set<string>>();
  const add = (parent: string | null, name: string): void => {
    if (parent === null) {
      if (!tree.has(name)) tree.set(name, new Set());
    } else {
      if (!tree.has(parent)) tree.set(parent, new Set());
      tree.get(parent)!.add(name);
    }
  };

  for (const entry of fs.readdirSync(CLI_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    // Collapse whitespace so multi-line commander chains read as one string.
    const src = stripTsComments(fs.readFileSync(path.join(CLI_DIR, entry.name), 'utf8')).replace(
      /\s+/g,
      ' ',
    );

    // `const secret = program .command('secret')` — remember the binding so the
    // group's own subcommands can be attributed to it.
    const groupVars = new Map<string, string>();
    for (const m of src.matchAll(
      /(?:const|let)\s+(\w+)\s*=\s*(\w+)\s*\.command\(\s*['"]([^'"\s]+)/g,
    )) {
      const varName = m[1]!;
      const receiver = m[2]!;
      const cmdName = m[3]!;
      if (receiver === 'program') {
        groupVars.set(varName, cmdName);
        add(null, cmdName);
      }
    }

    // Every `<receiver>.command('name ...')` call.
    for (const m of src.matchAll(/(\w+)\s*\.command\(\s*['"]([^'"]+)['"]/g)) {
      const receiver = m[1]!;
      // Commander accepts `'search <query>'`; only the first token is the name.
      const name = m[2]!.trim().split(/\s+/)[0]!;
      if (receiver === 'program') add(null, name);
      else if (groupVars.has(receiver)) add(groupVars.get(receiver)!, name);
    }

    // Dynamic registration: `for (const [name] of Object.entries(TABLE)) program.command(name)`.
    // Only `src/cli/edit-commands.ts` does this today; the rule is generic so a
    // second one would be picked up rather than silently missed.
    if (/\bprogram\s*\.command\(\s*[a-z]\w*\s*\)/.test(src)) {
      for (const table of src.matchAll(
        /(?:const|let)\s+\w+\s*(?::\s*Record<[^>]*>)?\s*=\s*\{([^}]*)\}/g,
      )) {
        for (const key of table[1]!.matchAll(/(?:^|[{,])\s*(\w+)\s*:\s*['"]/g)) {
          add(null, key[1]!);
        }
      }
    }
  }
  return tree;
}

/** `zora-agent <cmd> [<sub>]` occurrences in the live docs. */
const USAGE_RE = /\bzora-agent\s+([a-z][a-z0-9:-]*)(?:\s+([a-z][a-z0-9:-]*))?/g;

describe('DOC-12: zora-agent commands in docs are registered', () => {
  const tree = registeredCommands();

  it('recovers the commander registration tree from src/cli', () => {
    // Sanity anchors: if the static parse breaks, these go missing and the real
    // check below would pass vacuously.
    for (const expected of ['ask', 'status', 'doctor', 'init', 'daemon', 'memory']) {
      expect(
        tree.has(expected),
        `DOC-12: the static CLI parse did not find \`${expected}\`. Registration in src/cli/ ` +
          `probably changed shape — update registeredCommands() in this test.`,
      ).toBe(true);
    }
    expect(tree.get('daemon')).toContain('start');
  });

  it('every documented `zora-agent <cmd>` exists', () => {
    const topLevel = [...tree.keys()].sort();
    const findings: Finding[] = [];

    for (const doc of loadDocs()) {
      for (let i = 0; i < doc.lines.length; i++) {
        const line = doc.lines[i]!;
        USAGE_RE.lastIndex = 0;
        for (const m of line.matchAll(USAGE_RE)) {
          const cmd = m[1]!;
          const sub = m[2];

          if (!tree.has(cmd)) {
            if (isAllowed(doc, i, cmd)) continue;
            findings.push({
              relPath: doc.relPath,
              line: i + 1,
              found: `zora-agent ${cmd}`,
              detail: `no \`${cmd}\` command is registered in src/cli/. Registered commands: ${topLevel.join(', ')}.`,
            });
            continue;
          }

          // Only look at the second token for real command groups — otherwise
          // "`zora-agent start` to launch it" would read "to" as a subcommand.
          const subs = tree.get(cmd)!;
          if (subs.size === 0 || sub === undefined) continue;
          if (subs.has(sub)) continue;
          if (isAllowed(doc, i, sub)) continue;
          findings.push({
            relPath: doc.relPath,
            line: i + 1,
            found: `zora-agent ${cmd} ${sub}`,
            detail:
              `\`${cmd}\` has no \`${sub}\` subcommand. Its subcommands are: ` +
              `${[...subs].sort().join(', ')}.`,
          });
        }
      }
    }

    expect(
      findings,
      formatFindings('DOC-12: unregistered zora-agent commands in live documentation:', findings),
    ).toEqual([]);
  });

  it('invokes the binary package.json actually installs', () => {
    // `package.json` ships exactly one bin. A doc that says `zora status`
    // instead of `zora-agent status` documents a command that does not exist on
    // a clean install — there is no alias anywhere in the repo that creates it.
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      bin?: Record<string, string>;
    };
    const bins = Object.keys(pkg.bin ?? {});
    expect(bins.length, 'DOC-12: package.json declares no bin entries.').toBeGreaterThan(0);

    const commandNames = [...tree.keys()];
    const findings: Finding[] = [];

    for (const doc of loadDocs()) {
      let inFence = false;
      for (let i = 0; i < doc.lines.length; i++) {
        const line = doc.lines[i]!;
        if (/^\s*```/.test(line)) {
          inFence = !inFence;
          continue;
        }
        // Only shell-ish context counts: inside a fenced block, or inside
        // backticks. Prose such as "the zora daemon" is not an invocation.
        const candidates = inFence
          ? [line]
          : [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

        for (const text of candidates) {
          for (const m of text.matchAll(/(^|[\s|(])zora\s+([a-z][a-z0-9:-]*)/g)) {
            const cmd = m[2]!;
            if (!commandNames.includes(cmd)) continue; // not an invocation
            if (isAllowed(doc, i, 'zora')) continue;
            findings.push({
              relPath: doc.relPath,
              line: i + 1,
              found: `zora ${cmd}`,
              detail: `the installed binary is \`${bins.join('`, `')}\` — write \`${bins[0]} ${cmd}\`.`,
            });
          }
        }
      }
    }

    expect(
      findings,
      formatFindings('DOC-12: docs invoke a binary that is not installed:', findings),
    ).toEqual([]);
  });
});
