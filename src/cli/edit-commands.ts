/**
 * Edit CLI Commands — open human-protected config files in $EDITOR.
 *
 * Spec §5.9 "CLI Interface" — config/policy/soul/memory edit subcommands.
 */

import type { Command } from 'commander';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { createLogger } from '../utils/logger.js';

const log = createLogger('edit-commands');
const EDITABLE_FILES: Record<string, string> = {
  config: 'config.toml',
  policy: 'policy.toml',
  soul: 'SOUL.md',
};

export function registerEditCommands(
  program: Command,
  configDir: string,
): void {
  for (const [name, filename] of Object.entries(EDITABLE_FILES)) {
    const cmd = program.command(name).description(`Manage ${filename}`);

    cmd
      .command('edit')
      .description(`Open ${filename} in $EDITOR`)
      .action(async () => {
        const filePath = path.join(configDir, filename);

        if (!fs.existsSync(filePath)) {
          log.error({ filePath }, 'File not found');
          process.exitCode = 1;
          return;
        }

        const editor = process.env['EDITOR'] ?? process.env['VISUAL'] ?? 'vi';

        const parts = editor.split(/\s+/);
        const cmd = parts[0]!;
        const editorArgs = [...parts.slice(1), filePath];
        const child = spawn(cmd, editorArgs, { stdio: 'inherit' });

        await new Promise<void>((resolve, reject) => {
          child.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`Editor exited with code ${code}`));
            }
          });
          child.on('error', reject);
        });
      });
  }
}
