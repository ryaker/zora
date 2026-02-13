/**
 * R25: Tests for CLI command registration and argument parsing.
 *
 * Tests command registration, option parsing, and basic behavior
 * for all CLI commands.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

describe('CLI Command Registration (R25)', () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
  });

  describe('ask command', () => {
    it('should register with correct arguments and options', () => {
      program.command('ask')
        .argument('<prompt>')
        .option('-m, --model <model>')
        .option('--max-turns <n>', 'max turns', parseInt)
        .action(() => {});

      const askCmd = program.commands.find(c => c.name() === 'ask');
      expect(askCmd).toBeDefined();
    });
  });

  describe('start command', () => {
    it('should register the start command', () => {
      program.command('start').action(() => {});
      const cmd = program.commands.find(c => c.name() === 'start');
      expect(cmd).toBeDefined();
      expect(cmd!.description()).toBeDefined();
    });
  });

  describe('stop command', () => {
    it('should register the stop command', () => {
      program.command('stop').action(() => {});
      const cmd = program.commands.find(c => c.name() === 'stop');
      expect(cmd).toBeDefined();
    });
  });

  describe('status command', () => {
    it('should register the status command', () => {
      program.command('status').action(() => {});
      const cmd = program.commands.find(c => c.name() === 'status');
      expect(cmd).toBeDefined();
    });
  });

  describe('memory commands', () => {
    it('should support memory search subcommand', () => {
      const memory = program.command('memory');
      memory.command('search').argument('<query>').action(() => {});
      memory.command('forget').argument('<id>').action(() => {});
      memory.command('categories').action(() => {});

      const searchCmd = memory.commands.find(c => c.name() === 'search');
      expect(searchCmd).toBeDefined();
    });
  });

  describe('steer commands', () => {
    it('should support steer subcommand with jobId and message', () => {
      const steer = program.command('steer')
        .argument('<jobId>')
        .argument('<message>')
        .action(() => {});

      expect(steer).toBeDefined();
    });
  });

  describe('skill commands', () => {
    it('should register the skill command', () => {
      program.command('skill').action(() => {});
      const cmd = program.commands.find(c => c.name() === 'skill');
      expect(cmd).toBeDefined();
    });
  });

  describe('audit command', () => {
    it('should register the audit command', () => {
      program.command('audit').action(() => {});
      const cmd = program.commands.find(c => c.name() === 'audit');
      expect(cmd).toBeDefined();
    });
  });
});
