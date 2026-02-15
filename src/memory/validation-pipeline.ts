/**
 * ValidationPipeline — Gates for memory_save quality control.
 *
 * Gates (in order):
 *   1. Min length: content must be >= 15 characters
 *   2. Transient state rejection: reject ephemeral observations
 *   3. Jaccard dedup: reject if >0.7 similarity with existing item
 *   4. Contradiction detection: same tags + conflicting content
 *   5. Rate limit: max 10 saves per session
 */

import type { MemoryItem } from './memory-types.js';

const MIN_LENGTH = 15;
const DEDUP_THRESHOLD = 0.7;
const MAX_SAVES_PER_SESSION = 10;

const TRANSIENT_PATTERNS = [
  /\bis busy\b/i,
  /\bis waiting\b/i,
  /\bjust now\b/i,
  /\bcurrently\b/i,
  /\bright now\b/i,
  /\bat the moment\b/i,
  /\bis typing\b/i,
  /\bis loading\b/i,
];

export interface MemoryValidationResult {
  valid: boolean;
  reason?: string;
  /** If dedup matches an existing item, its ID is provided for update instead */
  duplicateOf?: string;
  /** If contradiction detected, the conflicting item ID */
  conflictsWith?: string;
}

export class ValidationPipeline {
  private _saveCount = 0;

  /**
   * Validate a memory save request against all gates.
   */
  validate(content: string, tags: string[], existingItems: MemoryItem[]): MemoryValidationResult {
    // Gate 1: Minimum length
    if (content.length < MIN_LENGTH) {
      return { valid: false, reason: `Content too short (${content.length} chars, minimum ${MIN_LENGTH})` };
    }

    // Gate 2: Transient state rejection
    for (const pattern of TRANSIENT_PATTERNS) {
      if (pattern.test(content)) {
        return { valid: false, reason: `Transient state detected: matches pattern "${pattern.source}"` };
      }
    }

    // Gate 3: Jaccard dedup
    const contentWords = this._wordSet(content);
    for (const existing of existingItems) {
      const existingWords = this._wordSet(existing.summary);
      const similarity = this._jaccardSimilarity(contentWords, existingWords);
      if (similarity > DEDUP_THRESHOLD) {
        return {
          valid: false,
          reason: `Duplicate detected (${(similarity * 100).toFixed(0)}% similar to "${existing.id}")`,
          duplicateOf: existing.id,
        };
      }
    }

    // Gate 4: Contradiction detection (same tags + conflicting content)
    if (tags.length > 0) {
      for (const existing of existingItems) {
        const tagOverlap = tags.filter(t => existing.tags.includes(t));
        if (tagOverlap.length >= Math.min(tags.length, existing.tags.length) && tagOverlap.length > 0) {
          // Same tags — check if content contradicts
          const contentSim = this._jaccardSimilarity(contentWords, this._wordSet(existing.summary));
          // Similar topic (some word overlap) but not a duplicate → potential contradiction
          if (contentSim > 0.2 && contentSim <= DEDUP_THRESHOLD) {
            return {
              valid: false,
              reason: `Possible contradiction with "${existing.id}" (same tags, different content). Update the existing item instead.`,
              conflictsWith: existing.id,
            };
          }
        }
      }
    }

    // Gate 5: Rate limit
    if (this._saveCount >= MAX_SAVES_PER_SESSION) {
      return { valid: false, reason: `Rate limit exceeded (${MAX_SAVES_PER_SESSION} saves per session)` };
    }

    // All gates passed
    this._saveCount++;
    return { valid: true };
  }

  /**
   * Reset the per-session save counter (call on new session start).
   */
  resetSession(): void {
    this._saveCount = 0;
  }

  /**
   * Current save count for the session.
   */
  get saveCount(): number {
    return this._saveCount;
  }

  private _wordSet(text: string): Set<string> {
    return new Set(
      text.toLowerCase().split(/\W+/).filter(w => w.length > 0),
    );
  }

  private _jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1;
    let intersection = 0;
    for (const word of a) {
      if (b.has(word)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }
}
