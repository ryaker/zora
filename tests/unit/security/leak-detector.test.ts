import { describe, it, expect, beforeEach } from 'vitest';
import { LeakDetector } from '../../../src/security/leak-detector.js';

describe('LeakDetector', () => {
  let detector: LeakDetector;

  beforeEach(() => {
    detector = new LeakDetector();
  });

  it('detects OpenAI API keys', () => {
    const text = 'My key is sk-abcdefghijklmnopqrstuvwxyz1234567890';
    const matches = detector.scan(text);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some(m => m.pattern === 'openai_api_key')).toBe(true);
  });

  it('detects Google API keys', () => {
    const text = 'API_KEY=AIzaSyA1234567890abcdefghijklmnopqrstuvw';
    const matches = detector.scan(text);
    expect(matches.some(m => m.pattern === 'google_api_key')).toBe(true);
  });

  it('detects GitHub tokens', () => {
    const text = 'token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh1234';
    const matches = detector.scan(text);
    expect(matches.some(m => m.pattern === 'github_token')).toBe(true);
  });

  it('detects Slack bot tokens', () => {
    const text = 'SLACK_TOKEN=xoxb-1234-5678-abcdefghijklmnop';
    const matches = detector.scan(text);
    expect(matches.some(m => m.pattern === 'slack_token')).toBe(true);
  });

  it('detects private key headers', () => {
    const text = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...';
    const matches = detector.scan(text);
    expect(matches.some(m => m.pattern === 'private_key')).toBe(true);
  });

  it('detects password assignments', () => {
    const text = 'password: "super-secret-value"';
    const matches = detector.scan(text);
    expect(matches.some(m => m.pattern === 'password_assignment')).toBe(true);
  });

  it('does not flag clean text', () => {
    const text = 'This is a normal function that calculates fibonacci numbers.';
    const matches = detector.scan(text);
    expect(matches).toHaveLength(0);
  });

  it('supports custom patterns', () => {
    detector.addPattern('custom_token', /\bCUSTOM_[A-Z]{20}\b/g, 'medium');
    const text = 'Token: CUSTOM_ABCDEFGHIJKLMNOPQRST';
    const matches = detector.scan(text);
    expect(matches.some(m => m.pattern === 'custom_token')).toBe(true);
  });

  it('redacts detected secrets', () => {
    const text = 'My API key is sk-abcdefghijklmnopqrstuvwxyz1234567890 and thats it';
    const redacted = detector.redact(text);
    expect(redacted).toContain('[REDACTED:openai_api_key]');
    expect(redacted).not.toContain('sk-abcdefghijklmnopqrstuvwxyz1234567890');
  });

  it('redacts multiple different secret types', () => {
    const text = 'sk-abcdefghijklmnopqrstuvwxyz1234567890 and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh1234';
    const redacted = detector.redact(text);
    expect(redacted).toContain('[REDACTED:openai_api_key]');
    expect(redacted).toContain('[REDACTED:github_token]');
  });
});
