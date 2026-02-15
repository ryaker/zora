/**
 * Router — Intelligent task-to-provider matching.
 *
 * Spec §5.1 "N-Provider Orchestration & Failover":
 *   - Task classification (complexity × resource axes)
 *   - Provider selection based on capabilities, rank, and cost
 *   - Support for routing modes (respect_ranking, optimize_cost, etc.)
 *   - Per-routine and per-task overrides
 */

import type {
  LLMProvider,
  TaskContext,
  ProviderCapability,
  CostTier,
  RoutingMode,
  TaskComplexity,
  TaskResourceType,
} from '../types.js';

export interface RouterOptions {
  providers: LLMProvider[];
  mode?: RoutingMode;
  providerOnlyName?: string;
}

export class Router {
  private readonly _providers: LLMProvider[];
  private readonly _mode: RoutingMode;
  private readonly _providerOnlyName?: string;
  private _roundRobinIndex = 0;

  /** Ordered cost tiers for comparison and filtering */
  private static readonly COST_ORDER: Record<string, number> = {
    free: 0,
    included: 1,
    metered: 2,
    premium: 3,
  };

  /** Keywords that indicate reasoning-heavy tasks, even if other keywords appear */
  private static readonly REASONING_KEYWORDS = [
    'analyze', 'explain', 'design', 'compare', 'evaluate',
    'why', 'how does', 'critique', 'review', 'assess', 'summarize',
    'plan', 'strategy', 'recommend', 'decide', 'trade-off', 'tradeoff',
  ];

  /** Keywords that indicate coding tasks */
  private static readonly CODING_KEYWORDS = [
    'code', 'refactor', 'fix bug', 'implement', 'function',
    'class', 'compile', 'debug', 'programming', 'syntax',
  ];

  /** Keywords that indicate search/research tasks */
  private static readonly SEARCH_KEYWORDS = [
    'search', 'find', 'research', 'look up', 'lookup', 'discover',
  ];

  /** Keywords that indicate data processing tasks */
  private static readonly DATA_KEYWORDS = [
    'json', 'csv', 'extract', 'parse', 'transform data', 'format',
  ];

  /** Keywords that indicate creative tasks */
  private static readonly CREATIVE_KEYWORDS = [
    'write', 'blog', 'creative', 'story', 'poem', 'essay', 'draft',
  ];

  /** Simple character count threshold — tasks below this are "simple" */
  private static readonly SIMPLE_CHAR_THRESHOLD = 20;

  constructor(options: RouterOptions) {
    this._providers = options.providers;
    this._mode = options.mode ?? 'respect_ranking';
    this._providerOnlyName = options.providerOnlyName;
  }

  /**
   * Selects the best available provider for a given task.
   * Logic follows the "Provider Selection Algorithm" in §4.2.
   */
  async selectProvider(task: TaskContext): Promise<LLMProvider> {
    // 1. Handle explicit overrides
    if (this._mode === 'provider_only' && this._providerOnlyName) {
      const fixed = await this._findAvailableProviderByName(this._providerOnlyName);
      if (fixed) return fixed;
    }

    if (task.modelPreference) {
      const preferred = await this._findAvailableProviderByName(task.modelPreference);
      if (preferred) return preferred;
    }

    // 2. Map task classification to required capabilities
    const requiredCaps = this._getRequiredCapabilities(task);

    // 3. Filter healthy and capable providers
    let candidates = await this._getCapableProviders(requiredCaps);

    // 4. Apply cost ceiling if specified (soft constraint — falls through if no match)
    if (task.maxCostTier && candidates.length > 0) {
      const filtered = this._filterByCostCeiling(candidates, task.maxCostTier);
      if (filtered.length > 0) {
        candidates = filtered;
      }
      // If all candidates exceed the ceiling, fall through to unfiltered list
      // (better to use an expensive model than fail the task entirely)
    }

    if (candidates.length === 0) {
      throw new Error(`No available provider found with capabilities: ${requiredCaps.join(', ')}`);
    }

    // 5. Sort based on routing mode
    switch (this._mode) {
      case 'optimize_cost':
        return this._sortByCost(candidates)[0]!;
      case 'round_robin': {
        const idx = this._roundRobinIndex % candidates.length;
        this._roundRobinIndex++;
        return candidates[idx]!;
      }
      case 'respect_ranking':
      default:
        return this._sortByRank(candidates)[0]!;
    }
  }

  /**
   * Classifies a task based on its context to determine required capabilities.
   * Uses multi-factor classification: keyword scoring, token count, and
   * linguistic analysis. Reasoning keywords take priority over domain keywords
   * to avoid misrouting analytical tasks (e.g. "analyze this code" → reasoning).
   */
  classifyTask(taskText: string): { complexity: TaskComplexity; resourceType: TaskResourceType } {
    const text = taskText.toLowerCase();

    // Score each resource type by keyword matches
    const scores: Record<TaskResourceType, number> = {
      reasoning: 0,
      coding: 0,
      search: 0,
      data: 0,
      creative: 0,
      mixed: 0,
    };

    const CATEGORY_CONFIGS = [
      { keywords: Router.REASONING_KEYWORDS, key: 'reasoning' as TaskResourceType, weight: 2 },
      { keywords: Router.CODING_KEYWORDS, key: 'coding' as TaskResourceType, weight: 1 },
      { keywords: Router.SEARCH_KEYWORDS, key: 'search' as TaskResourceType, weight: 1 },
      { keywords: Router.DATA_KEYWORDS, key: 'data' as TaskResourceType, weight: 1 },
      { keywords: Router.CREATIVE_KEYWORDS, key: 'creative' as TaskResourceType, weight: 1 },
    ];

    for (const config of CATEGORY_CONFIGS) {
      for (const kw of config.keywords) {
        if (text.includes(kw)) {
          scores[config.key] += config.weight;
        }
      }
    }

    // Pick the resource type with highest score; default to reasoning
    let resourceType: TaskResourceType = 'reasoning';
    let maxScore = 0;
    for (const [type, score] of Object.entries(scores) as [TaskResourceType, number][]) {
      if (type === 'mixed') continue;
      if (score > maxScore) {
        maxScore = score;
        resourceType = type;
      }
    }

    // Complexity heuristics — multi-factor
    let complexity: TaskComplexity = 'moderate';

    // Complex indicators: architecture, security, refactoring, or multiple domains
    const nonZeroScores = Object.values(scores).filter((s) => s > 0).length;
    if (
      text.includes('refactor') ||
      text.includes('security') ||
      text.includes('architect') ||
      nonZeroScores >= 3
    ) {
      complexity = 'complex';
    } else {
      // Estimate character count by whitespace splitting (rough approximation)
      const charCount = text.split(/\s+/).length;
      if (charCount < Router.SIMPLE_CHAR_THRESHOLD && !text.includes('research')) {
        complexity = 'simple';
      }
    }

    return { complexity, resourceType };
  }

  // ─── Private Helpers ──────────────────────────────────────────────

  private _getRequiredCapabilities(task: TaskContext): ProviderCapability[] {
    const caps: ProviderCapability[] = [];

    // Map resource type to core capability
    switch (task.resourceType) {
      case 'coding':
        caps.push('coding');
        break;
      case 'search':
        caps.push('search');
        break;
      case 'data':
        caps.push('structured-data');
        break;
      case 'creative':
        caps.push('creative');
        break;
      case 'reasoning':
        caps.push('reasoning');
        break;
    }

    // High complexity usually implies reasoning
    if (task.complexity === 'complex') {
      caps.push('reasoning');
    }

    return Array.from(new Set(caps)); // Dedupe
  }

  private async _getCapableProviders(required: ProviderCapability[]): Promise<LLMProvider[]> {
    const capable = [];
    for (const p of this._providers) {
      const hasAll = required.every((cap) => p.capabilities.includes(cap));
      if (hasAll && (await p.isAvailable())) {
        capable.push(p);
      }
    }
    return capable;
  }

  private _sortByRank(providers: LLMProvider[]): LLMProvider[] {
    return [...providers].sort((a, b) => a.rank - b.rank);
  }

  private _sortByCost(providers: LLMProvider[]): LLMProvider[] {
    return [...providers].sort((a, b) => {
      const costA = Router.COST_ORDER[a.costTier] ?? 3;
      const costB = Router.COST_ORDER[b.costTier] ?? 3;
      if (costA !== costB) return costA - costB;
      return a.rank - b.rank; // Tie-breaker by rank
    });
  }

  /**
   * Filter providers whose cost tier is at or below the ceiling.
   */
  private _filterByCostCeiling(providers: LLMProvider[], maxCostTier: CostTier): LLMProvider[] {
    const maxCost = Router.COST_ORDER[maxCostTier] ?? 3;
    return providers.filter((p) => (Router.COST_ORDER[p.costTier] ?? 3) <= maxCost);
  }

  /**
   * Finds a provider by name and checks if it's available.
   */
  private async _findAvailableProviderByName(name: string): Promise<LLMProvider | undefined> {
    const provider = this._providers.find((p) => p.name === name);
    if (provider && (await provider.isAvailable())) {
      return provider;
    }
    return undefined;
  }
}
