/**
 * Zora — Long-running autonomous personal AI agent for macOS
 *
 * Entry point. This module initializes the agent daemon.
 * Implementation in Tier 1, Item 7 (execution loop).
 */

export { type ZoraConfig, type ZoraPolicy, type LLMProvider } from './types.js';
export * from './providers/index.js';
export * from './config/index.js';
export * from './security/policy-engine.js';
export * from './tools/index.js';
export * from './orchestrator/index.js';
export * from './utils/fs.js';
export * from './steering/index.js';
export * from './routines/index.js';
export * from './memory/index.js';
export * from './teams/index.js';
export * from './dashboard/auth-middleware.js';
export * from './wasm/wasmtime-spike.js';
