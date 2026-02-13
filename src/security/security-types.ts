/**
 * Security module types — local to src/security/.
 *
 * Types that are only consumed within the security subsystem live here
 * to avoid bloating the global types.ts.
 */

import type { WorkerCapabilityToken } from '../types.js';

// Re-export for convenience within security modules
export type { WorkerCapabilityToken } from '../types.js';

// ─── Audit ──────────────────────────────────────────────────────────

export type AuditEntryEventType =
  | 'tool_invocation'
  | 'tool_result'
  | 'policy_violation'
  | 'handoff'
  | 'auth_error'
  | 'notification'
  | 'secret_access'
  | 'integrity_check';

export interface AuditEntry {
  entryId: string;
  jobId: string;
  eventType: AuditEntryEventType;
  timestamp: string;
  provider: string;
  toolName: string;
  parameters: Record<string, unknown>;
  result: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

// ─── Integrity ──────────────────────────────────────────────────────

export interface IntegrityBaseline {
  filePath: string;
  hash: string;
  updatedAt: string;
}

// ─── Secrets ────────────────────────────────────────────────────────

export interface SecretReference {
  name: string;
  encryptedValue: string;
  iv: string;
  authTag: string;
  salt: string;
}

// ─── Leak Detection ─────────────────────────────────────────────────

export type LeakSeverity = 'low' | 'medium' | 'high';

export interface LeakPattern {
  name: string;
  pattern: RegExp;
  severity: LeakSeverity;
}

export interface LeakMatch {
  pattern: string;
  match: string;
  severity: LeakSeverity;
}

// ─── Capability Tokens ─────────────────────────────────────────────

export interface CapabilityGrant extends WorkerCapabilityToken {
  grantedBy: string;
}
