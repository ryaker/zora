/**
 * Security barrel exports.
 */

export { PolicyEngine } from './policy-engine.js';
export type { ValidationResult } from './policy-engine.js';

export { SecretsManager } from './secrets-manager.js';
export { AuditLogger } from './audit-logger.js';
export type { AuditEntryInput, AuditFilter, ChainVerificationResult } from './audit-logger.js';
export { IntegrityGuardian } from './integrity-guardian.js';
export type { IntegrityCheckResult } from './integrity-guardian.js';
export { sanitizeInput, validateOutput, sanitizeToolOutput } from './prompt-defense.js';
export type { OutputValidationResult } from './prompt-defense.js';
export { IntentCapsuleManager } from './intent-capsule.js';
export { LeakDetector } from './leak-detector.js';
export {
  createCapabilityToken,
  enforceCapability,
  isTokenExpired,
} from './capability-tokens.js';
export type { CapabilityAction, EnforcementResult } from './capability-tokens.js';

// Re-export security-local types
export type {
  AuditEntry,
  AuditEntryEventType,
  IntegrityBaseline,
  SecretReference,
  LeakPattern,
  LeakMatch,
  LeakSeverity,
  CapabilityGrant,
  BudgetStatus,
  DryRunResult,
  IntentCapsule,
  DriftCheckResult,
} from './security-types.js';
