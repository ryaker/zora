/**
 * TEST-03: CLI Commands Functional Tests
 *
 * Tests functional behavior of CLI commands:
 * - Memory commands (search, forget, categories)
 * - Audit commands
 * - Steer command (steer, flags, approve, reject)
 * - Doctor command checks
 * - Init command behavior
 * - Command registration completeness
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerMemoryCommands } from '../../../src/cli/memory-commands.js';
import { registerAuditCommands } from '../../../src/cli/audit-commands.js';
import { registerSteerCommands } from '../../../src/cli/steer-commands.js';
import { registerInitCommand } from '../../../src/cli/init-command.js';
import { registerSkillCommands } from '../../../src/cli/skill-commands.js';

describe('CLI Functional Tests', () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('memory commands', () => {
    it('registers memory command group', () => {
      registerMemoryCommands(program);
      const memCmd = program.commands.find(c => c.name() === 'memory');
      expect(memCmd).toBeDefined();
      expect(memCmd!.description()).toBeTruthy();
    });

    it('memory has search subcommand', () => {
      registerMemoryCommands(program);
      const memCmd = program.commands.find(c => c.name() === 'memory');
      const searchCmd = memCmd?.commands.find(c => c.name() === 'search');
      expect(searchCmd).toBeDefined();
    });

    it('memory has forget subcommand', () => {
      registerMemoryCommands(program);
      const memCmd = program.commands.find(c => c.name() === 'memory');
      const forgetCmd = memCmd?.commands.find(c => c.name() === 'forget');
      expect(forgetCmd).toBeDefined();
    });

    it('memory has categories subcommand', () => {
      registerMemoryCommands(program);
      const memCmd = program.commands.find(c => c.name() === 'memory');
      const catCmd = memCmd?.commands.find(c => c.name() === 'categories');
      expect(catCmd).toBeDefined();
    });
  });

  describe('audit commands', () => {
    it('registers audit command', () => {
      registerAuditCommands(program);
      const auditCmd = program.commands.find(c => c.name() === 'audit');
      expect(auditCmd).toBeDefined();
      expect(auditCmd!.description()).toBeTruthy();
    });
  });

  describe('steer commands', () => {
    it('registers steer command', () => {
      registerSteerCommands(program, '/tmp/test-zora');
      const steerCmd = program.commands.find(c => c.name() === 'steer');
      expect(steerCmd).toBeDefined();
    });

    it('registers flags command', () => {
      registerSteerCommands(program, '/tmp/test-zora');
      const flagsCmd = program.commands.find(c => c.name() === 'flags');
      expect(flagsCmd).toBeDefined();
    });

    it('registers approve command', () => {
      registerSteerCommands(program, '/tmp/test-zora');
      const approveCmd = program.commands.find(c => c.name() === 'approve');
      expect(approveCmd).toBeDefined();
    });

    it('registers reject command', () => {
      registerSteerCommands(program, '/tmp/test-zora');
      const rejectCmd = program.commands.find(c => c.name() === 'reject');
      expect(rejectCmd).toBeDefined();
    });
  });

  describe('skill commands', () => {
    it('registers skill command', () => {
      registerSkillCommands(program);
      const skillCmd = program.commands.find(c => c.name() === 'skill');
      expect(skillCmd).toBeDefined();
    });
  });

  describe('init command', () => {
    it('registers init command', () => {
      registerInitCommand(program);
      const initCmd = program.commands.find(c => c.name() === 'init');
      expect(initCmd).toBeDefined();
    });
  });

  describe('doctor command', () => {
    it('exports runDoctorChecks function', async () => {
      const { runDoctorChecks } = await import('../../../src/cli/doctor.js');
      expect(typeof runDoctorChecks).toBe('function');
    });
  });

  describe('command descriptions', () => {
    it('all top-level commands have descriptions', () => {
      registerMemoryCommands(program);
      registerAuditCommands(program);
      registerSteerCommands(program, '/tmp/test-zora');
      registerSkillCommands(program);
      registerInitCommand(program);

      for (const cmd of program.commands) {
        expect(cmd.description()).toBeTruthy();
      }
    });
  });
});
