/**
 * LeakDetector — Secret leak scanning and redaction.
 *
 * Spec §5.5 "Leak Detection":
 *   - Built-in patterns for common secret formats
 *   - Custom pattern registration
 *   - Text redaction
 */

import type { LeakPattern, LeakMatch, LeakSeverity } from './security-types.js';

const BUILT_IN_PATTERNS: LeakPattern[] = [
  // OpenAI / Anthropic API keys
  { name: 'openai_api_key', pattern: /\bsk-[A-Za-z0-9]{20,}\b/g, severity: 'high' },
  // Google AI API keys
  { name: 'google_api_key', pattern: /\bAIza[A-Za-z0-9_-]{35,}\b/g, severity: 'high' },
  // GitHub personal access tokens
  { name: 'github_token', pattern: /\bghp_[A-Za-z0-9]{36,}\b/g, severity: 'high' },
  // Slack bot tokens
  { name: 'slack_token', pattern: /\bxoxb-[A-Za-z0-9-]+\b/g, severity: 'high' },
  // JWT tokens
  { name: 'jwt_token', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, severity: 'medium' },
  // Base64 encoded blocks > 50 chars (potential encoded secrets)
  { name: 'base64_block', pattern: /\b[A-Za-z0-9+/]{50,}={0,2}\b/g, severity: 'low' },
  // Private key headers
  { name: 'private_key', pattern: /-----BEGIN\s+(RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, severity: 'high' },
  // AWS access key IDs
  { name: 'aws_access_key', pattern: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, severity: 'high' },
  // Generic secret assignment patterns
  { name: 'password_assignment', pattern: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{4,}["']/gi, severity: 'medium' },
];

export class LeakDetector {
  private readonly _patterns: LeakPattern[];

  constructor() {
    // Deep-copy built-in patterns to avoid shared state between instances
    this._patterns = BUILT_IN_PATTERNS.map(p => ({
      ...p,
      pattern: new RegExp(p.pattern.source, p.pattern.flags),
    }));
  }

  /**
   * Scan text for potential secret leaks.
   */
  scan(text: string): LeakMatch[] {
    const matches: LeakMatch[] = [];

    for (const { name, pattern, severity } of this._patterns) {
      // Reset lastIndex for global regexes
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        matches.push({
          pattern: name,
          match: match[0],
          severity,
        });
      }
    }

    return matches;
  }

  /**
   * Add a custom leak detection pattern.
   */
  addPattern(name: string, pattern: RegExp, severity: LeakSeverity): void {
    this._patterns.push({ name, pattern, severity });
  }

  /**
   * Redact detected secrets, replacing them with `[REDACTED:{patternName}]`.
   */
  redact(text: string): string {
    let result = text;

    for (const { name, pattern } of this._patterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      result = result.replace(regex, `[REDACTED:${name}]`);
    }

    return result;
  }
}
