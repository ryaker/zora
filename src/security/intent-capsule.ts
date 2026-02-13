/**
 * IntentCapsuleManager — Cryptographically signed mandate bundles for goal drift detection.
 *
 * Security Hardening (Feb 2026) — ASI01 Mitigation:
 *   - Creates HMAC-SHA256 signed "Intent Capsules" at task start
 *   - Verifies capsule integrity to detect tampering
 *   - Checks each action for consistency with the original mandate
 *   - Detects goal hijacking via keyword overlap and category matching
 */

import crypto from 'node:crypto';
import type { IntentCapsule, DriftCheckResult } from './security-types.js';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'to', 'of', 'in',
  'for', 'on', 'with', 'at', 'by', 'from', 'this', 'that',
  'it', 'and', 'or', 'but', 'not', 'if', 'then', 'else',
  'please', 'help', 'me', 'i', 'you', 'we', 'they',
]);

export class IntentCapsuleManager {
  private readonly _signingKey: Buffer;
  private _activeCapsule: IntentCapsule | null = null;
  private _driftHistory: DriftCheckResult[] = [];

  constructor(signingSecret: string) {
    this._signingKey = crypto.createHash('sha256').update(signingSecret).digest();
  }

  /**
   * Create a signed intent capsule at task start.
   * The capsule captures the original mandate and cannot be
   * modified without invalidating the signature.
   */
  createCapsule(mandate: string, options?: {
    allowedActionCategories?: string[];
    ttlMs?: number;
  }): IntentCapsule {
    const capsuleId = `capsule_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const mandateHash = crypto.createHash('sha256').update(mandate).digest('hex');
    const mandateKeywords = this._extractKeywords(mandate);
    const createdAt = new Date().toISOString();
    const expiresAt = options?.ttlMs
      ? new Date(Date.now() + options.ttlMs).toISOString()
      : undefined;
    const allowedActionCategories = options?.allowedActionCategories ?? [];

    const payload = JSON.stringify({
      capsuleId, mandate, mandateHash, mandateKeywords,
      allowedActionCategories, createdAt, expiresAt,
    });

    const signature = crypto
      .createHmac('sha256', this._signingKey)
      .update(payload)
      .digest('hex');

    const capsule: IntentCapsule = {
      capsuleId, mandate, mandateHash, mandateKeywords,
      allowedActionCategories, signature, createdAt, expiresAt,
    };

    this._activeCapsule = capsule;
    this._driftHistory = [];
    return capsule;
  }

  /**
   * Verify the HMAC signature of an intent capsule.
   * Returns false if the capsule has been tampered with.
   */
  verifyCapsule(capsule: IntentCapsule): boolean {
    try {
      const payload = JSON.stringify({
        capsuleId: capsule.capsuleId,
        mandate: capsule.mandate,
        mandateHash: capsule.mandateHash,
        mandateKeywords: capsule.mandateKeywords,
        allowedActionCategories: capsule.allowedActionCategories,
        createdAt: capsule.createdAt,
        expiresAt: capsule.expiresAt,
      });

      const expectedSignature = crypto
        .createHmac('sha256', this._signingKey)
        .update(payload)
        .digest('hex');

      const sigBuffer = Buffer.from(capsule.signature, 'hex');
      const expectedBuffer = Buffer.from(expectedSignature, 'hex');

      // timingSafeEqual throws if buffer lengths differ (malformed signature)
      if (sigBuffer.length !== expectedBuffer.length) return false;

      return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    } catch {
      // Malformed signature or unexpected error — treat as verification failure
      return false;
    }
  }

  /**
   * Check if an action is consistent with the active mandate.
   * Uses category matching and keyword overlap heuristics.
   */
  checkDrift(actionType: string, actionDetail: string): DriftCheckResult {
    if (!this._activeCapsule) {
      return { consistent: true, confidence: 0, action: actionType, mandateHash: '' };
    }

    const capsule = this._activeCapsule;

    // Check capsule expiry
    if (capsule.expiresAt && new Date() > new Date(capsule.expiresAt)) {
      const result: DriftCheckResult = {
        consistent: false, confidence: 1.0,
        reason: 'Intent capsule has expired',
        action: actionType, mandateHash: capsule.mandateHash,
      };
      this._driftHistory.push(result);
      return result;
    }

    // Check action category against allowed categories
    if (capsule.allowedActionCategories.length > 0) {
      if (!capsule.allowedActionCategories.includes(actionType)) {
        const result: DriftCheckResult = {
          consistent: false, confidence: 0.8,
          reason: `Action '${actionType}' not in mandate's allowed categories: ${capsule.allowedActionCategories.join(', ')}`,
          action: actionType, mandateHash: capsule.mandateHash,
        };
        this._driftHistory.push(result);
        return result;
      }
    }

    // Keyword overlap check: does the action detail relate to the mandate?
    const actionKeywords = this._extractKeywords(actionDetail);
    const overlap = actionKeywords.filter(k => capsule.mandateKeywords.includes(k));
    // Empty action detail is neutral — skip keyword check (don't flag, don't assume match)
    if (actionKeywords.length === 0) {
      const result: DriftCheckResult = {
        consistent: true, confidence: 0.5,
        action: actionType, mandateHash: capsule.mandateHash,
      };
      this._driftHistory.push(result);
      return result;
    }
    const overlapRatio = overlap.length / actionKeywords.length;

    const consistent = overlapRatio >= 0.1; // At least 10% keyword overlap
    const confidence = consistent ? overlapRatio : 1.0 - overlapRatio;

    const result: DriftCheckResult = {
      consistent,
      confidence,
      ...(!consistent ? {
        reason: `Low mandate relevance (${(overlapRatio * 100).toFixed(0)}% keyword overlap)`,
      } : {}),
      action: actionType,
      mandateHash: capsule.mandateHash,
    };

    this._driftHistory.push(result);
    return result;
  }

  /**
   * Get the currently active capsule.
   */
  getActiveCapsule(): IntentCapsule | null {
    return this._activeCapsule;
  }

  /**
   * Get drift check history.
   */
  getDriftHistory(): DriftCheckResult[] {
    return [...this._driftHistory];
  }

  /**
   * Clear the active capsule (session end).
   */
  clearCapsule(): void {
    this._activeCapsule = null;
    this._driftHistory = [];
  }

  /**
   * Extract meaningful keywords from text, filtering stop words.
   */
  private _extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  }
}
