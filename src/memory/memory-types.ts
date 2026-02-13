/**
 * Memory module types — Tier 3 structured memory.
 *
 * Spec SS5.4: Salience-aware retrieval, proactive extraction,
 * category auto-organization.
 */

export type MemoryItemType = 'profile' | 'event' | 'knowledge' | 'behavior' | 'skill' | 'tool';
export type SourceType = 'user_instruction' | 'agent_analysis' | 'tool_output';

export interface MemoryItem {
  id: string;
  type: MemoryItemType;
  summary: string;
  source: string;
  source_type: SourceType;
  created_at: string;
  last_accessed: string;
  access_count: number;
  reinforcement_score: number;
  tags: string[];
  category: string;
}

export interface SalienceScore {
  itemId: string;
  score: number;
  components: {
    accessWeight: number;
    recencyDecay: number;
    relevanceScore: number;
    sourceTrustBonus: number;
  };
}

export interface CategorySummary {
  category: string;
  summary: string;
  item_count: number;
  last_updated: string;
  member_item_ids: string[];
}

export interface ExtractionResult {
  items: MemoryItem[];
  errors: string[];
  retries: number;
}
