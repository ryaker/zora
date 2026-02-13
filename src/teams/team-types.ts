/**
 * Team Types — Definitions for multi-agent team coordination.
 *
 * Spec v0.6 §5.7 "Multi-Agent Teams":
 *   - Teams are groups of agents that collaborate on a shared task.
 *   - Each team has a coordinator, members, and a filesystem-based mailbox.
 */

export interface AgentMember {
  agentId: string;           // e.g., "claude-security@audit-team"
  name: string;              // Friendly name
  provider: 'claude' | 'gemini';
  model: string;
  cwd: string;               // Working directory
  isActive: boolean;
  capabilities: string[];
}

export interface TeamConfig {
  name: string;
  createdAt: string;
  members: AgentMember[];
  coordinatorId: string;     // agentId of the coordinator
  persistent: boolean;       // false = ephemeral (teardown on completion)
  prNumber?: number;         // Associated PR number (for PR-lifecycle teams)
  prTitle?: string;          // Associated PR title (for PR-lifecycle teams)
}

export type MailboxMessageType = 'task' | 'result' | 'status' | 'steer' | 'handoff' | 'shutdown' | 'idle';

export interface MailboxMessage {
  from: string;              // agent name
  text: string;
  timestamp: string;
  read: boolean;
  type: MailboxMessageType;
  metadata?: Record<string, unknown>;
}
