/**
 * SalienceScorer — Ranks memory items by contextual relevance.
 *
 * Spec SS5.4 "Salience-Aware Retrieval" (updated):
 *   salience = bm25Score * recencyDecay * frequencyBoost * trustScore
 *
 * Multiplicative composition ensures all factors contribute.
 * Half-life defaults to 14 days (configurable).
 */

import type { MemoryItem, SalienceScore, SourceType } from './memory-types.js';

const DEFAULT_HALF_LIFE_DAYS = 14;
const LN2 = Math.LN2;

export class SalienceScorer {
  private readonly _halfLifeDays: number;

  constructor(halfLifeDays: number = DEFAULT_HALF_LIFE_DAYS) {
    this._halfLifeDays = halfLifeDays;
  }

  /**
   * Score an item using multiplicative composition.
   * When a BM25 score is available (from MiniSearch), pass it as bm25Score.
   * Falls back to keyword relevance score when bm25Score is not provided.
   */
  scoreItem(item: MemoryItem, query: string, bm25Score?: number): SalienceScore {
    const recencyDecay = this.recencyDecay(item.last_accessed);
    const frequencyBoost = this.frequencyBoost(item.access_count);
    const trustScore = this.trustScore(item.source_type);
    const relevanceScore = bm25Score ?? this.relevanceScore(query, item);

    return {
      itemId: item.id,
      score: relevanceScore * recencyDecay * frequencyBoost * trustScore,
      components: {
        accessWeight: frequencyBoost,
        recencyDecay,
        relevanceScore,
        sourceTrustBonus: trustScore,
      },
    };
  }

  rankItems(items: MemoryItem[], query: string, limit?: number): SalienceScore[] {
    const scored = items.map(item => this.scoreItem(item, query));
    scored.sort((a, b) => b.score - a.score);
    return limit !== undefined ? scored.slice(0, limit) : scored;
  }

  recencyDecay(lastAccessed: string): number {
    const now = Date.now();
    const accessed = new Date(lastAccessed).getTime();
    const daysSince = Math.max(0, (now - accessed) / (1000 * 60 * 60 * 24));
    // Exponential decay: e^(-ln(2) * days / halfLife)
    return Math.exp((-LN2 * daysSince) / this._halfLifeDays);
  }

  frequencyBoost(accessCount: number): number {
    // Logarithmic: diminishing returns after ~10 accesses
    return 1.0 + Math.log2(1 + accessCount) * 0.15;
  }

  trustScore(sourceType: SourceType): number {
    switch (sourceType) {
      case 'user_instruction':
        return 1.0;
      case 'agent_analysis':
        return 0.7;
      case 'tool_output':
        return 0.3;
      default:
        // Fallback for unknown source types (should not happen with proper typing)
        return 0.0;
    }
  }

  relevanceScore(query: string, item: MemoryItem): number {
    const queryWords = this._tokenize(query);
    if (queryWords.length === 0) return 0;

    const itemWords = new Set(
      this._tokenize(`${item.summary} ${item.tags.join(' ')}`),
    );
    if (itemWords.size === 0) return 0;

    let matchCount = 0;
    for (const w of queryWords) {
      if (itemWords.has(w)) matchCount++;
    }
    return matchCount / queryWords.length; // normalize 0-1
  }

  /** @deprecated Use trustScore() instead */
  sourceTrustBonus(sourceType: SourceType): number {
    return this.trustScore(sourceType);
  }

  private _tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 0);
  }
}
