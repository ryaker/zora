/**
 * Hook CLI Commands — ORCH-13
 *
 * Provides `zora hooks list` and `zora hooks test` commands
 * for inspecting and testing registered lifecycle hooks.
 */

import type { Command } from 'commander';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createLogger } from '../utils/logger.js';
import { HOOK_EVENT_NAMES, type HookConfig, type HookEventName } from '../hooks/hook-types.js';

const log = createLogger('hook-commands');

/**
 * Load hook config entries from config.toml (parsed).
 * Reads the raw TOML and extracts [[hooks]] sections.
 */
async function loadHookConfigs(configDir: string): Promise<HookConfig[]> {
  const configPath = path.join(configDir, 'config.toml');
  if (!fs.existsSync(configPath)) {
    return [];
  }

  try {
    const { loadConfig } = await import('../config/loader.js');
    const config = await loadConfig(configPath);
    return config.hooks ?? [];
  } catch (err) {
    log.warn({ err }, 'Failed to load config for hooks');
    return [];
  }
}

export function registerHookCommands(program: Command, configDir: string): void {
  const hooks = program
    .command('hooks')
    .description('Manage lifecycle hooks');

  hooks
    .command('list')
    .description('List all configured hooks from config.toml')
    .action(async () => {
      const hookConfigs = await loadHookConfigs(configDir);

      if (hookConfigs.length === 0) {
        console.log('No hooks configured in config.toml.');
        console.log('\nTo add hooks, add [[hooks]] sections to ~/.zora/config.toml:');
        console.log('');
        console.log('  [[hooks]]');
        console.log('  event = "beforeToolExecute"');
        console.log('  match = "Bash"');
        console.log('  script = "~/.zora/hooks/validate-bash.sh"');
        return;
      }

      console.log(`Found ${hookConfigs.length} hook(s):\n`);

      const maxEventLen = Math.max(...hookConfigs.map((h) => h.event.length));

      for (const hook of hookConfigs) {
        const paddedEvent = hook.event.padEnd(maxEventLen + 2);
        const matchStr = hook.match ? `match=${hook.match}` : 'match=*';
        const scriptStr = hook.script ? `script=${hook.script}` : 'no script';
        console.log(`  ${paddedEvent}${matchStr}  ${scriptStr}`);
      }

      console.log(`\nValid hook events: ${HOOK_EVENT_NAMES.join(', ')}`);
    });

  hooks
    .command('test')
    .description('Test a hook by simulating an event')
    .argument('<event>', `Hook event to test (${HOOK_EVENT_NAMES.join(', ')})`)
    .option('--tool <name>', 'Tool name for beforeToolExecute/afterToolExecute events', 'Bash')
    .option('--args <json>', 'JSON arguments for the tool', '{}')
    .action(async (event: string, _options: { tool: string; args: string }) => {
      if (!HOOK_EVENT_NAMES.includes(event as HookEventName)) {
        console.error(`Invalid hook event: ${event}`);
        console.error(`Valid events: ${HOOK_EVENT_NAMES.join(', ')}`);
        process.exit(1);
      }

      const hookConfigs = await loadHookConfigs(configDir);
      const matching = hookConfigs.filter((h) => h.event === event);

      if (matching.length === 0) {
        console.log(`No hooks configured for event "${event}".`);
        return;
      }

      console.log(`Testing ${matching.length} hook(s) for event "${event}"...\n`);

      for (const hook of matching) {
        if (!hook.script) {
          console.log(`  [skip] ${hook.event} — no script configured`);
          continue;
        }

        const scriptPath = hook.script.replace(/^~/, os.homedir());

        if (!fs.existsSync(scriptPath)) {
          console.log(`  [fail] ${hook.event} — script not found: ${scriptPath}`);
          continue;
        }

        // Check if script is executable
        try {
          fs.accessSync(scriptPath, fs.constants.X_OK);
          console.log(`  [pass] ${hook.event} — script exists and is executable: ${hook.script}`);
          if (hook.match) {
            console.log(`         match pattern: ${hook.match}`);
          }
        } catch {
          console.log(`  [warn] ${hook.event} — script exists but is NOT executable: ${hook.script}`);
          console.log(`         Run: chmod +x ${hook.script}`);
        }
      }

      console.log('\nNote: `hooks test` validates configuration only. It does not execute scripts.');
    });
}
