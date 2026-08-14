/**
 * Security Audit CLI Commands — scan Zora installation for misconfigurations.
 *
 * Provides `zora security` command with optional --fix and --format flags.
 * Also exports `runSecurityAudit()` for use in daemon startup gating.
 */

import type { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
// ─── Types ──────────────────────────────────────────────────────────────────

type Severity = 'FAIL' | 'WARN' | 'PASS';

interface CheckResult {
  id: string;
  label: string;
  severity: Severity;
  message: string;
  /** File path and line number if applicable (e.g. "config.toml:44") */
  location?: string;
  /** Whether the --fix handler can auto-remediate this issue */
  fixable: boolean;
}

interface AuditReport {
  timestamp: string;
  checks: CheckResult[];
  failCount: number;
  warnCount: number;
  passCount: number;
}

export interface SecurityAuditOptions {
  fix?: boolean;
  format?: 'text' | 'json';
  /** Override the ~/.zora directory (used in tests) */
  zoraDir?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveZoraDir(override?: string): string {
  return override ?? path.join(os.homedir(), '.zora');
}

/** Return the octal permission bits for a path, or -1 if not accessible. */
function getPermBits(filePath: string): number {
  try {
    return fs.statSync(filePath).mode & 0o777;
  } catch {
    return -1;
  }
}

/** Attempt to chmod a path; return true on success. */
function chmodSafe(filePath: string, mode: number): boolean {
  try {
    fs.chmodSync(filePath, mode);
    return true;
  } catch {
    return false;
  }
}

/** Read a file as text, returning '' on any error. */
function readFileSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

/** Detect the running Node.js major version. */
function getNodeMajorVersion(): number {
  const match = /^v(\d+)/.exec(process.version);
  return match ? parseInt(match[1]!, 10) : 0;
}

// ─── Individual checks ──────────────────────────────────────────────────────

/** Check ~/.zora/ directory has mode 700. */
function checkZoraDirPermissions(zoraDir: string, fix: boolean): CheckResult {
  const id = 'PERM-ZORA-DIR';
  const label = `${zoraDir} permissions (700)`;

  if (!fs.existsSync(zoraDir)) {
    return { id, label, severity: 'WARN', message: `${zoraDir} does not exist — run 'zora-agent init' first`, fixable: false };
  }

  const bits = getPermBits(zoraDir);
  if (bits === -1) {
    return { id, label, severity: 'FAIL', message: `Cannot stat ${zoraDir}`, fixable: false };
  }

  if (bits === 0o700) {
    return { id, label, severity: 'PASS', message: `${zoraDir} has correct permissions (700)`, fixable: false };
  }

  if (fix) {
    const ok = chmodSafe(zoraDir, 0o700);
    if (ok) {
      return { id, label, severity: 'PASS', message: `${zoraDir} permissions fixed to 700`, fixable: true };
    }
    return { id, label, severity: 'FAIL', message: `${zoraDir} has permissions ${bits.toString(8)} — chmod failed`, fixable: true };
  }

  return {
    id, label, severity: 'FAIL',
    message: `${zoraDir} has permissions ${bits.toString(8)} — must be 700. Run 'chmod 700 ${zoraDir}' or use --fix`,
    fixable: true,
  };
}

/** Check a config file has the expected permission mode. */
function checkFilePerm(filePath: string, expectedMode: number, fix: boolean): CheckResult {
  const rel = path.basename(filePath);
  const modeStr = expectedMode.toString(8);
  // Include a sanitized parent-directory fragment to keep IDs unique when the same
  // filename appears under different directories (e.g. project vs global policy.toml).
  const parentFrag = path.basename(path.dirname(filePath)).replace(/[^a-zA-Z0-9]/g, '-').toUpperCase();
  const id = `PERM-${parentFrag}-${rel.replace(/\./g, '-').toUpperCase()}`;
  const label = `${rel} permissions (${modeStr})`;

  if (!fs.existsSync(filePath)) {
    // Not existing is only a problem if it's a required file
    return { id, label, severity: 'PASS', message: `${rel} not present — skipping permission check`, fixable: false };
  }

  const bits = getPermBits(filePath);
  if (bits === -1) {
    return { id, label, severity: 'FAIL', message: `Cannot stat ${filePath}`, fixable: false };
  }

  if (bits === expectedMode) {
    return { id, label, severity: 'PASS', message: `${rel} has correct permissions (${modeStr})`, fixable: false };
  }

  if (fix) {
    const ok = chmodSafe(filePath, expectedMode);
    if (ok) {
      return { id, label, severity: 'PASS', message: `${rel} permissions fixed to ${modeStr}`, fixable: true };
    }
    return { id, label, severity: 'FAIL', message: `${rel} has permissions ${bits.toString(8)} — chmod failed`, fixable: true };
  }

  return {
    id, label, severity: 'FAIL',
    message: `${rel} has permissions ${bits.toString(8)} — must be ${modeStr}. Run 'chmod ${modeStr} ${filePath}' or use --fix`,
    fixable: true,
  };
}

// Patterns that indicate a plaintext secret. Each pattern captures:
//   group 1 = key name, group 2 = value
const SECRET_PATTERNS: RegExp[] = [
  /^\s*(bot_token|api_key|token|secret|password|auth_token|access_token)\s*=\s*["']([^"']{8,})["']/i,
  /^\s*(bot_token|api_key|token|secret|password|auth_token|access_token)\s*=\s*([^\s#"']{8,})/i,
];

/**
 * SEC-26: `bot_token = "env:ZORA_TELEGRAM_TOKEN"` is the fix this check tells
 * people to apply. Without this exemption the remediated config still FAILs the
 * scan — and FAILs block startup — which would push users back to the plaintext
 * they just removed. An env reference holds a variable NAME, not a credential.
 */
const ENV_REFERENCE_VALUE = /^(?:env:|\$\{env:)[A-Za-z_][A-Za-z0-9_]*\}?$/;

/** Recursively collect all .toml file paths under a directory. */
function collectTomlFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTomlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.toml')) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Scan .toml files in zoraDir (recursively) for plaintext secrets. */
function checkPlaintextSecrets(zoraDir: string): CheckResult[] {
  const results: CheckResult[] = [];
  let tomlFiles: string[];
  try {
    tomlFiles = collectTomlFiles(zoraDir);
  } catch {
    return [{
      id: 'SECRET-PLAINTEXT-READDIR',
      label: 'No plaintext secrets in *.toml',
      severity: 'FAIL',
      message: `Cannot read ${zoraDir} to scan for plaintext secrets`,
      fixable: false,
    }];
  }

  for (const filePath of tomlFiles) {
    const file = path.relative(zoraDir, filePath);
    const content = readFileSafe(filePath);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const pattern of SECRET_PATTERNS) {
        const match = pattern.exec(line);
        if (match) {
          const keyName = match[1]!;
          // Already remediated: the value is an env reference, not a secret.
          if (ENV_REFERENCE_VALUE.test(match[2]!)) break;
          const lineNum = i + 1;
          const envVar = keyName.toUpperCase();
          results.push({
            id: `SECRET-PLAINTEXT-${file.replace(/[\./\\]/g, '-').toUpperCase()}-L${lineNum}`,
            label: `Plaintext secret in ${file}`,
            severity: 'FAIL',
            message: `Plaintext ${keyName} found — move it out of the file: set ${keyName} = "env:${envVar}" and export ${envVar}`,
            location: `${file}:${lineNum}`,
            fixable: false,
          });
          break; // one finding per line is enough
        }
      }
    }

    if (!results.some(r => r.label === `Plaintext secret in ${file}`)) {
      results.push({
        id: `SECRET-PLAINTEXT-${file.replace(/[\./\\]/g, '-').toUpperCase()}`,
        label: `No plaintext secrets in ${file}`,
        severity: 'PASS',
        message: `No plaintext secrets detected in ${file}`,
        fixable: false,
      });
    }
  }

  if (tomlFiles.length === 0) {
    results.push({
      id: 'SECRET-PLAINTEXT-NONE',
      label: 'No plaintext secrets in *.toml',
      severity: 'PASS',
      message: 'No .toml files found — nothing to scan',
      fixable: false,
    });
  }

  return results;
}

/** Check that daemon bind address is localhost, not 0.0.0.0. */
function checkDaemonBindAddress(zoraDir: string): CheckResult {
  const id = 'BIND-LOCALHOST';
  const label = 'Daemon binds to localhost only';

  const configPath = path.join(zoraDir, 'config.toml');
  if (!fs.existsSync(configPath)) {
    return { id, label, severity: 'PASS', message: 'config.toml not present — skipping bind address check', fixable: false };
  }

  const content = readFileSafe(configPath);
  const lines = content.split('\n');

  // Look for host = "0.0.0.0" or bind = "0.0.0.0"
  const bindPattern = /^\s*(host|bind|bind_address)\s*=\s*["']0\.0\.0\.0["']/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (bindPattern.test(line)) {
      return {
        id, label, severity: 'FAIL',
        message: `Daemon configured to bind on 0.0.0.0 — change to 127.0.0.1 or localhost`,
        location: `config.toml:${i + 1}`,
        fixable: false,
      };
    }
  }

  // Also check ZORA_BIND_HOST env var at runtime — can only warn, not fix
  const bindHost = process.env['ZORA_BIND_HOST'];
  if (bindHost && bindHost !== 'localhost' && bindHost !== '127.0.0.1' && bindHost !== '::1') {
    return {
      id, label, severity: 'FAIL',
      message: `ZORA_BIND_HOST=${bindHost} — daemon will bind on a non-localhost address`,
      fixable: false,
    };
  }

  return { id, label, severity: 'PASS', message: 'Daemon bind address is localhost', fixable: false };
}

/** Check AgentBus URL uses HTTPS if it is an external (non-localhost) address. */
function checkAgentBusUrl(zoraDir: string): CheckResult {
  const id = 'AGENTBUS-HTTPS';
  const label = 'AgentBus URL uses HTTPS for external connections';

  const configPath = path.join(zoraDir, 'config.toml');
  if (!fs.existsSync(configPath)) {
    return { id, label, severity: 'PASS', message: 'config.toml not present — skipping AgentBus check', fixable: false };
  }

  const content = readFileSafe(configPath);
  // Match agent_bus_url or agentbus_url assignments
  const urlPattern = /^\s*(?:agent_bus_url|agentbus_url)\s*=\s*["']([^"']+)["']/i;
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = urlPattern.exec(line);
    if (match) {
      const url = match[1]!;
      const isLocal = /^https?:\/\/(?:localhost|127\.0\.0\.1|::1|\[::1\])(:\d+)?/.test(url);
      if (!isLocal && url.startsWith('http://')) {
        return {
          id, label, severity: 'WARN',
          message: `AgentBus URL uses plain HTTP for external host — switch to HTTPS: ${url}`,
          location: `config.toml:${i + 1}`,
          fixable: false,
        };
      }
      return { id, label, severity: 'PASS', message: `AgentBus URL is acceptable: ${url}`, fixable: false };
    }
  }

  return { id, label, severity: 'PASS', message: 'No AgentBus URL configured — skipping', fixable: false };
}

/** Check Node.js version is >= 20 LTS. */
function checkNodeVersion(): CheckResult {
  const id = 'NODE-VERSION';
  const label = 'Node.js >= 20 LTS';
  const major = getNodeMajorVersion();

  if (major >= 20) {
    return { id, label, severity: 'PASS', message: `Node.js ${process.version} — meets 20 LTS requirement`, fixable: false };
  }

  return {
    id, label, severity: 'WARN',
    message: `Node.js ${process.version} detected — upgrade to Node.js 20 LTS for security patches`,
    fixable: false,
  };
}

/** Check that if a Signal phone is configured, channel-policy.toml exists. */
function checkSignalPolicyFile(zoraDir: string): CheckResult {
  const id = 'SIGNAL-POLICY';
  const label = 'Signal channel has policy file';

  const configPath = path.join(zoraDir, 'config.toml');
  if (!fs.existsSync(configPath)) {
    return { id, label, severity: 'PASS', message: 'config.toml not present — skipping Signal check', fixable: false };
  }

  const content = readFileSafe(configPath);
  // Detect any signal phone number configuration
  const signalPhonePattern = /^\s*(?:signal_phone|phone_number)\s*=\s*["']([^"']+)["']/i;
  const hasSignal = signalPhonePattern.test(content);

  if (!hasSignal) {
    return { id, label, severity: 'PASS', message: 'Signal not configured — skipping policy file check', fixable: false };
  }

  const policyFile = path.join(zoraDir, 'config', 'channel-policy.toml');
  if (fs.existsSync(policyFile)) {
    return { id, label, severity: 'PASS', message: 'Signal configured and channel-policy.toml is present', fixable: false };
  }

  return {
    id, label, severity: 'WARN',
    message: `Signal phone is configured but ${policyFile} is missing — create it to restrict Signal access`,
    fixable: false,
  };
}

// ─── Core audit runner ───────────────────────────────────────────────────────

/**
 * Run all security checks and return an AuditReport.
 * If fix=true, auto-remediate fixable issues.
 */
async function buildReport(opts: SecurityAuditOptions): Promise<AuditReport> {
  const zoraDir = resolveZoraDir(opts.zoraDir);
  const fix = opts.fix ?? false;

  const checks: CheckResult[] = [];

  // 1. ~/.zora/ directory permissions
  checks.push(checkZoraDirPermissions(zoraDir, fix));

  // 2. config.toml permissions
  checks.push(checkFilePerm(path.join(zoraDir, 'config.toml'), 0o600, fix));

  // 3. policy.toml permissions (local zoraDir)
  const localPolicyPath = path.join(zoraDir, 'policy.toml');
  checks.push(checkFilePerm(localPolicyPath, 0o600, fix));
  // Also audit global ~/.zora/policy.toml when zoraDir is a project directory
  const globalPolicyPath = path.join(os.homedir(), '.zora', 'policy.toml');
  if (path.resolve(globalPolicyPath) !== path.resolve(localPolicyPath)) {
    checks.push(checkFilePerm(globalPolicyPath, 0o600, fix));
  }

  // 4. Plaintext secrets in *.toml
  if (fs.existsSync(zoraDir)) {
    checks.push(...checkPlaintextSecrets(zoraDir));
  }

  // 5. Daemon bind address
  checks.push(checkDaemonBindAddress(zoraDir));

  // 6. AgentBus URL uses HTTPS
  checks.push(checkAgentBusUrl(zoraDir));

  // 7. Node.js version
  checks.push(checkNodeVersion());

  // 8. Signal policy file
  checks.push(checkSignalPolicyFile(zoraDir));

  const failCount = checks.filter(c => c.severity === 'FAIL').length;
  const warnCount = checks.filter(c => c.severity === 'WARN').length;
  const passCount = checks.filter(c => c.severity === 'PASS').length;

  return {
    timestamp: new Date().toISOString(),
    checks,
    failCount,
    warnCount,
    passCount,
  };
}

// ─── Output formatters ───────────────────────────────────────────────────────

function formatText(report: AuditReport): string {
  const date = report.timestamp.replace('T', ' ').replace(/\.\d+Z$/, '');
  const lines: string[] = [`Zora Security Audit — ${date}`, ''];

  for (const check of report.checks) {
    const icon = check.severity === 'PASS' ? '✓' : check.severity === 'FAIL' ? '✗' : '⚠';
    const label = check.severity === 'PASS' ? '\x1b[32mPASS\x1b[0m'
                : check.severity === 'FAIL' ? '\x1b[31mFAIL\x1b[0m'
                : '\x1b[33mWARN\x1b[0m';
    const loc = check.location ? ` (${check.location})` : '';
    lines.push(`${icon} ${label}  ${check.message}${loc}`);
  }

  lines.push('');
  const parts: string[] = [];
  if (report.failCount > 0) parts.push(`\x1b[31m${report.failCount} FAIL${report.failCount !== 1 ? 's' : ''}\x1b[0m`);
  if (report.warnCount > 0) parts.push(`\x1b[33m${report.warnCount} WARN${report.warnCount !== 1 ? 's' : ''}\x1b[0m`);
  if (parts.length === 0) parts.push('\x1b[32mAll checks passed\x1b[0m');
  lines.push(parts.join(', ') + '.');

  return lines.join('\n');
}

function formatJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run the security audit.
 *
 * @returns Exit code: 0 if no FAILs, 1 if any FAILs present.
 */
export async function runSecurityAudit(opts: SecurityAuditOptions = {}): Promise<number> {
  const report = await buildReport(opts);
  const format = opts.format ?? 'text';

  if (format === 'json') {
    console.log(formatJson(report));
  } else {
    console.log(formatText(report));
  }

  return report.failCount > 0 ? 1 : 0;
}

/**
 * Run the security audit silently and return whether there are FAILs.
 * Used for daemon startup gating — no console output.
 */
export async function runSecurityAuditSilent(opts: SecurityAuditOptions = {}): Promise<{ exitCode: number; report: AuditReport }> {
  const report = await buildReport(opts);
  return { exitCode: report.failCount > 0 ? 1 : 0, report };
}

/**
 * Register the `security` command on the given Commander program.
 */
export function registerSecurityCommands(program: Command): void {
  program
    .command('security')
    .description('Scan the Zora installation for security misconfigurations')
    .option('--fix', 'Auto-fix WARN/FAIL issues where possible (chmod corrections)')
    .option('--format <format>', 'Output format: text or json', 'text')
    .action(async (opts: { fix?: boolean; format?: string }) => {
      const format = (opts.format === 'json' ? 'json' : 'text') as 'text' | 'json';
      const exitCode = await runSecurityAudit({ fix: opts.fix, format });
      process.exitCode = exitCode;
    });
}
