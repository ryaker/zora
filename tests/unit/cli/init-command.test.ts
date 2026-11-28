import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse as parseTOML } from 'smol-toml';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  generatePolicyToml,
  generateConfigToml,
  pickOllamaModel,
  scaffoldDirectories,
  writeSoulFile,
} from '../../../src/cli/init-command.js';
import { PRESETS, TOOL_STACKS } from '../../../src/cli/presets.js';
import type { DoctorResult } from '../../../src/cli/doctor.js';
import type { PresetName } from '../../../src/cli/presets.js';
import { loadConfigFromString } from '../../../src/config/loader.js';
import { DEFAULT_OLLAMA_MODEL } from '../../../src/providers/model-defaults.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zora-init-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Preset validation ────────────────────────────────────────────────

describe('PRESETS', () => {
  it.each(['locked', 'safe', 'balanced', 'power'] as PresetName[])('preset "%s" has all 4 sections', (name) => {
    const p = PRESETS[name];
    expect(p.filesystem).toBeDefined();
    expect(p.shell).toBeDefined();
    expect(p.actions).toBeDefined();
    expect(p.network).toBeDefined();
  });

  it.each(['locked', 'safe', 'balanced', 'power'] as PresetName[])('preset "%s" has valid shell mode', (name) => {
    expect(['allowlist', 'denylist', 'deny_all']).toContain(PRESETS[name].shell.mode);
  });

  it('locked preset has zero access', () => {
    expect(PRESETS.locked.filesystem.allowed_paths).toEqual([]);
    expect(PRESETS.locked.shell.mode).toBe('deny_all');
    expect(PRESETS.locked.shell.allowed_commands).toEqual([]);
    expect(PRESETS.locked.network.allowed_domains).toEqual([]);
  });

  it('safe preset denies all shell commands', () => {
    expect(PRESETS.safe.shell.mode).toBe('deny_all');
    expect(PRESETS.safe.shell.allowed_commands).toEqual([]);
  });

  it('balanced preset includes common commands', () => {
    expect(PRESETS.balanced.shell.allowed_commands).toContain('git');
    expect(PRESETS.balanced.shell.allowed_commands).toContain('npm');
  });

  it('power preset includes expanded commands', () => {
    expect(PRESETS.power.shell.allowed_commands).toContain('python3');
    expect(PRESETS.power.shell.allowed_commands).toContain('jq');
  });
});

// ── TOOL_STACKS ──────────────────────────────────────────────────────

describe('TOOL_STACKS', () => {
  it('has node, python, rust, go, general stacks', () => {
    expect(Object.keys(TOOL_STACKS)).toEqual(
      expect.arrayContaining(['node', 'python', 'rust', 'go', 'general']),
    );
  });

  it('node stack includes npm and npx', () => {
    expect(TOOL_STACKS['node']).toContain('npm');
    expect(TOOL_STACKS['node']).toContain('npx');
  });
});

// ── generatePolicyToml ───────────────────────────────────────────────

describe('generatePolicyToml', () => {
  it('produces valid TOML that round-trips through smol-toml', () => {
    const toml = generatePolicyToml('balanced', '~/Dev', ['~/.ssh'], ['node']);
    const parsed = parseTOML(toml);
    expect(parsed).toBeDefined();
    expect(parsed['filesystem']).toBeDefined();
    expect(parsed['shell']).toBeDefined();
    expect(parsed['actions']).toBeDefined();
    expect(parsed['network']).toBeDefined();
  });

  it('substitutes dev path for ~/Projects', () => {
    const toml = generatePolicyToml('balanced', '~/Code', [], []);
    const parsed = parseTOML(toml) as Record<string, unknown>;
    const fs = parsed['filesystem'] as Record<string, unknown>;
    const paths = fs['allowed_paths'] as string[];
    expect(paths).toContain('~/Code');
    expect(paths).not.toContain('~/Projects');
  });

  it('merges tool stack commands into allowed_commands', () => {
    const toml = generatePolicyToml('balanced', '~/Dev', [], ['node', 'python']);
    const parsed = parseTOML(toml) as Record<string, unknown>;
    const shell = parsed['shell'] as Record<string, unknown>;
    const cmds = shell['allowed_commands'] as string[];
    // node stack
    expect(cmds).toContain('npx');
    expect(cmds).toContain('tsc');
    // python stack
    expect(cmds).toContain('python3');
    expect(cmds).toContain('pip');
  });

  it('does not merge tool stacks for safe (deny_all) preset', () => {
    const toml = generatePolicyToml('safe', '~/Dev', [], ['node', 'python']);
    const parsed = parseTOML(toml) as Record<string, unknown>;
    const shell = parsed['shell'] as Record<string, unknown>;
    const cmds = shell['allowed_commands'] as string[];
    expect(cmds).toEqual([]);
  });

  it('adds custom denied paths to preset base', () => {
    const toml = generatePolicyToml('balanced', '~/Dev', ['~/SecretVault', '~/.mykeys'], []);
    const parsed = parseTOML(toml) as Record<string, unknown>;
    const fs = parsed['filesystem'] as Record<string, unknown>;
    const denied = fs['denied_paths'] as string[];
    expect(denied).toContain('~/SecretVault');
    expect(denied).toContain('~/.mykeys');
    // Also retains preset's base denied paths
    expect(denied).toContain('~/.ssh');
    expect(denied).toContain('~/.gnupg');
  });

  it('deduplicates denied paths', () => {
    // ~/.ssh is already in balanced preset
    const toml = generatePolicyToml('balanced', '~/Dev', ['~/.ssh', '~/.ssh'], []);
    const parsed = parseTOML(toml) as Record<string, unknown>;
    const fs = parsed['filesystem'] as Record<string, unknown>;
    const denied = fs['denied_paths'] as string[];
    const sshCount = denied.filter((p) => p === '~/.ssh').length;
    expect(sshCount).toBe(1);
  });
});

// ── generateConfigToml ───────────────────────────────────────────────

describe('generateConfigToml', () => {
  const doctorBoth: DoctorResult = {
    node: { found: true, version: 'v22.0.0' },
    claude: { found: true, path: '/usr/local/bin/claude' },
    gemini: { found: true, path: '/usr/local/bin/gemini' },
    ollama: { found: false, endpoint: 'http://localhost:11434', models: [] },
  };

  const doctorNone: DoctorResult = {
    node: { found: true, version: 'v20.0.0' },
    claude: { found: false, path: null },
    gemini: { found: false, path: null },
    ollama: { found: false, endpoint: 'http://localhost:11434', models: [] },
  };

  const doctorOllamaOnly: DoctorResult = {
    node: { found: true, version: 'v22.0.0' },
    claude: { found: false, path: null },
    gemini: { found: false, path: null },
    ollama: { found: true, endpoint: 'http://localhost:11434', models: ['qwen3:14b', 'llama3.2'] },
  };

  it('configures Ollama as the only/primary provider when no CLIs exist (#249)', () => {
    const config = loadConfigFromString(generateConfigToml(doctorOllamaOnly));
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0]!.name).toBe('ollama');
    expect(config.providers[0]!.type).toBe('ollama');
    expect(config.providers[0]!.model).toBe('qwen3:14b');
    expect(config.providers[0]!.rank).toBe(1);
  });

  it('--primary ollama ranks Ollama first and honors --ollama-model (#249)', () => {
    const doctor: DoctorResult = { ...doctorBoth, ollama: doctorOllamaOnly.ollama };
    const config = loadConfigFromString(
      generateConfigToml(doctor, { primary: 'ollama', ollamaModel: 'llama3.2' }),
    );
    expect(config.providers.map(p => p.name)).toEqual(['ollama', 'claude', 'gemini']);
    expect(config.providers.map(p => p.rank)).toEqual([1, 2, 3]);
    expect(config.providers[0]!.model).toBe('llama3.2');
  });

  it('ranks Ollama first by default when it is running, frontier providers as failover (#260)', () => {
    const doctor: DoctorResult = { ...doctorBoth, ollama: doctorOllamaOnly.ollama };
    const config = loadConfigFromString(generateConfigToml(doctor));
    expect(config.providers.map(p => p.name)).toEqual(['ollama', 'claude', 'gemini']);
    expect(config.providers.map(p => p.rank)).toEqual([1, 2, 3]);
    // Claude is API-key backup now, not a plan login.
    expect(config.providers[1]!.cost_tier).toBe('metered');
  });

  it('does not default to Ollama when the daemon has only an embedding model (#260)', () => {
    const doctor: DoctorResult = {
      ...doctorBoth,
      ollama: { found: true, endpoint: 'http://localhost:11434', models: ['nomic-embed-text'] },
    };
    const config = loadConfigFromString(generateConfigToml(doctor));
    expect(config.providers[0]!.name).toBe('claude');
  });

  it('an explicit --primary still wins over the Ollama default (#260)', () => {
    const doctor: DoctorResult = { ...doctorBoth, ollama: doctorOllamaOnly.ollama };
    const config = loadConfigFromString(generateConfigToml(doctor, { primary: 'claude' }));
    expect(config.providers.map(p => p.name)).toEqual(['claude', 'gemini', 'ollama']);
  });

  it('picks the bake-off default model when installed, never an embedding model (#260)', () => {
    expect(pickOllamaModel(['nomic-embed-text', DEFAULT_OLLAMA_MODEL, 'qwen3:14b'])).toBe(DEFAULT_OLLAMA_MODEL);
    expect(pickOllamaModel(['nomic-embed-text', 'qwen3:14b'])).toBe('qwen3:14b');
    expect(pickOllamaModel(['nomic-embed-text'])).toBe(DEFAULT_OLLAMA_MODEL);
    expect(pickOllamaModel([])).toBe(DEFAULT_OLLAMA_MODEL);
  });

  it('produces valid TOML', () => {
    const toml = generateConfigToml(doctorBoth);
    const parsed = parseTOML(toml);
    expect(parsed).toBeDefined();
  });

  it('passes validateConfig when providers are detected', () => {
    const toml = generateConfigToml(doctorBoth);
    const config = loadConfigFromString(toml);
    expect(config.agent.name).toBe('zora');
    expect(config.providers).toHaveLength(2);
    expect(config.providers[0]!.name).toBe('claude');
    expect(config.providers[1]!.name).toBe('gemini');
  });

  it('produces valid config even with no providers', () => {
    const toml = generateConfigToml(doctorNone);
    const config = loadConfigFromString(toml);
    expect(config.agent.name).toBe('zora');
    expect(config.providers).toHaveLength(0);
  });

  it('assigns sequential ranks to detected providers', () => {
    const toml = generateConfigToml(doctorBoth);
    const config = loadConfigFromString(toml);
    expect(config.providers[0]!.rank).toBe(1);
    expect(config.providers[1]!.rank).toBe(2);
  });

  it('only includes claude when gemini is missing', () => {
    const doctor: DoctorResult = {
      node: { found: true, version: 'v22.0.0' },
      claude: { found: true, path: '/bin/claude' },
      gemini: { found: false, path: null },
    ollama: { found: false, endpoint: 'http://localhost:11434', models: [] },
    };
    const toml = generateConfigToml(doctor);
    const config = loadConfigFromString(toml);
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0]!.name).toBe('claude');
  });
});

// ── scaffoldDirectories ──────────────────────────────────────────────

describe('scaffoldDirectories', () => {
  it('creates all expected directories', () => {
    scaffoldDirectories(tmpDir);

    const expected = [
      '',
      'workspace',
      'memory',
      'memory/daily',
      'memory/items',
      'memory/categories',
      'audit',
    ];

    for (const dir of expected) {
      const fullPath = path.join(tmpDir, dir);
      expect(fs.existsSync(fullPath), `${dir} should exist`).toBe(true);
      expect(fs.statSync(fullPath).isDirectory(), `${dir} should be a directory`).toBe(true);
    }
  });

  it('is idempotent — running twice does not throw', () => {
    scaffoldDirectories(tmpDir);
    expect(() => scaffoldDirectories(tmpDir)).not.toThrow();
  });
});

// ── writeSoulFile ────────────────────────────────────────────────────

describe('writeSoulFile', () => {
  it('creates SOUL.md with content', () => {
    writeSoulFile(tmpDir);
    const soulPath = path.join(tmpDir, 'SOUL.md');
    expect(fs.existsSync(soulPath)).toBe(true);
    const content = fs.readFileSync(soulPath, 'utf-8');
    expect(content).toContain('Zora');
    expect(content).toContain('Soul File');
  });

  it('does not overwrite existing SOUL.md', () => {
    const soulPath = path.join(tmpDir, 'SOUL.md');
    fs.writeFileSync(soulPath, 'custom soul', 'utf-8');
    writeSoulFile(tmpDir);
    expect(fs.readFileSync(soulPath, 'utf-8')).toBe('custom soul');
  });
});
