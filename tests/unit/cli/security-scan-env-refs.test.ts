/**
 * SEC-26 — `zora-agent security` must accept the remediation it recommends.
 *
 * The plaintext-secret scanner flags any `bot_token = "<8+ chars>"`. Once
 * `env:VAR` resolution exists and the docs tell people to write
 * `bot_token = "env:ZORA_TELEGRAM_TOKEN"`, the remediated config would still be
 * reported as a plaintext secret — and FAILs gate daemon startup, so the user's
 * only way out would be to put the plaintext token back.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { runSecurityAuditSilent } from '../../../src/cli/security-commands.js';

async function scanFindings(configBody: string): Promise<string[]> {
  const zoraDir = fs.mkdtempSync(path.join(os.tmpdir(), `zora-sec26-scan-${crypto.randomUUID()}-`));
  try {
    fs.writeFileSync(path.join(zoraDir, 'config.toml'), configBody, { mode: 0o600 });
    const { report } = await runSecurityAuditSilent({ zoraDir });
    return report.checks
      .filter((c) => c.severity === 'FAIL' && c.label.startsWith('Plaintext secret'))
      .map((c) => c.message);
  } finally {
    fs.rmSync(zoraDir, { recursive: true, force: true });
  }
}

describe('SEC-26 — plaintext secret scan vs env: references', () => {
  it('still flags a plaintext bot_token', async () => {
    const findings = await scanFindings('[steering.telegram]\nbot_token = "123456:ABCdef-real-token"\n');
    expect(findings).toHaveLength(1);
  });

  it('does not flag an env: reference — that is the fix, not the problem', async () => {
    const findings = await scanFindings('[steering.telegram]\nbot_token = "env:ZORA_TELEGRAM_TOKEN"\n');
    expect(findings).toEqual([]);
  });

  it('does not flag the ${env:NAME} spelling either', async () => {
    const findings = await scanFindings('[steering.telegram]\nbot_token = "${env:ZORA_TELEGRAM_TOKEN}"\n');
    expect(findings).toEqual([]);
  });

  it('recommends the env: form that actually resolves', async () => {
    const findings = await scanFindings('[steering.telegram]\nbot_token = "123456:ABCdef-real-token"\n');
    expect(findings[0]).toMatch(/env:BOT_TOKEN/);
  });
});
