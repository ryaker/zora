/**
 * SalienceScorer — Ranks memory items by contextual relevance.
 *
 * Spec SS5.4 "Salience-Aware Retrieval":
 *   salience = (access_count * 0.3)
 *            + recency_decay(last_accessed)
 *            + relevance_score(query, item)
 *            + source_trust_bonus(source_type)
 */

import type { MemoryItem, SalienceScore, SourceType } from './memory-types.js';

const HALF_LIFE_DAYS = 7;
const LN2 = Math.LN2;

export class SalienceScorer {
  scoreItem(item: MemoryItem, query: string): SalienceScore {
    const accessWeight = item.access_count * 0.3;
    const recencyDecay = this.recencyDecay(item.last_accessed);
    const relevanceScore = this.relevanceScore(query, item);
    const sourceTrustBonus = this.sourceTrustBonus(item.source_type);

    return {
      itemId: item.id,
      score: accessWeight + recencyDecay + relevanceScore + sourceTrustBonus,
      components: {
        accessWeight,
        recencyDecay,
        relevanceScore,
        sourceTrustBonus,
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
    return Math.exp((-LN2 * daysSince) / HALF_LIFE_DAYS);
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

  sourceTrustBonus(sourceType: SourceType): number {
    switch (sourceType) {
      case 'user_instruction':
        return 0.2;
      case 'agent_analysis':
        return 0.1;
      case 'tool_output':
        return 0.0;
    }
  }

  private _tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 0);
  }
}
