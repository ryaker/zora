/**
 * Graph memory tier (MEM-30) — relational recall over an embedded graph.
 *
 * Off by default and entirely optional: `GraphMemoryClient.create()` returns an
 * inert client when the tier is disabled, when the `sparrowdb` optional
 * dependency is missing, or when the platform has no prebuilt binary. Every
 * method on an inert client is a no-op returning empty results, so callers do
 * not branch on availability.
 */

export {
  GraphIdentifierError,
  PROPERTY_KEYS,
  assertEdgeType,
  assertNodeLabel,
  assertPropertyKey,
  assertSurrogateId,
  surrogateId,
  type PropertyKey,
} from './identifiers.js';

export { GraphStore, type GraphStoreOptions } from './graph-store.js';

export {
  acquireGraphLock,
  isDatabaseLockedError,
  resetGraphLockRegistry,
  type GraphLock,
  type GraphLockResult,
} from './process-lock.js';

export { GraphMemoryClient } from './graph-memory-worker.js';

export {
  loadSparrow,
  resetSparrowLoaderCache,
  type CypherParams,
  type CypherValue,
  type SparrowDatabase,
  type SparrowLoadResult,
  type SparrowModule,
  type SparrowResult,
} from './sparrow-loader.js';

export {
  DEFAULT_GRAPH_CONFIG,
  EDGE_TYPES,
  ENTITY_KINDS,
  NODE_LABELS,
  graphConfigFromEnv,
  isEntityKind,
  type DecisionRecord,
  type DecisionResult,
  type EdgeType,
  type EntityKind,
  type EntityRecord,
  type FailureRecord,
  type FailureResult,
  type GraphMemoryConfig,
  type GraphQuery,
  type GraphQueryResult,
  type GraphStats,
  type GraphWrite,
  type NeighbourResult,
  type NodeLabel,
  type TaskRecord,
  type TaskResult,
} from './graph-types.js';
