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

  /** Ordered cost tiers for comparison and filtering */
  private static readonly COST_ORDER: Record<string, number> = {
    free: 0,
    included: 1,
    metered: 2,
    premium: 3,
  };

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
      case 'round_robin':
        // Simplified round-robin for v1: just pick random from top candidates
        return candidates[Math.floor(Math.random() * candidates.length)]!;
      case 'respect_ranking':
      default:
        return this._sortByRank(candidates)[0]!;
    }
  }

  /**
   * Classifies a task based on its context to determine required capabilities.
   * This implements the classification logic from §5.1.
   */
  classifyTask(taskText: string): { complexity: TaskComplexity; resourceType: TaskResourceType } {
    const text = taskText.toLowerCase();

    // Resource Type heuristics
    let resourceType: TaskResourceType = 'reasoning';
    if (text.includes('search') || text.includes('find') || text.includes('research')) {
      resourceType = 'search';
    } else if (text.includes('code') || text.includes('refactor') || text.includes('fix bug')) {
      resourceType = 'coding';
    } else if (text.includes('json') || text.includes('csv') || text.includes('extract')) {
      resourceType = 'data';
    } else if (text.includes('write') || text.includes('blog') || text.includes('creative')) {
      resourceType = 'creative';
    }

    // Complexity heuristics
    let complexity: TaskComplexity = 'moderate';
    if (text.includes('refactor') || text.includes('security') || text.includes('architect')) {
      complexity = 'complex';
    } else if (text.length < 50 && !text.includes('research')) {
      complexity = 'simple';
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
