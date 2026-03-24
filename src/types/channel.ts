/**
 * Zora Signal Secure Channel Types
 *
 * Types for the channel identity, messaging, and capability enforcement
 * system. These are the foundation for the entire Signal integration.
 *
 * See: SPEC-signal-secure-channel.md §5
 */

// INVARIANT-1: No tool execution without a valid, current CapabilitySet
// INVARIANT-4: Channel message content never reaches privileged LLM directly

export interface ChannelIdentity {
  type: "signal" | "telegram" | "whatsapp" | "slack" | "teams" | string;
  phoneNumber: string;       // E.164 format: "+14155551234" (or platform-specific ID)
  signalUuid?: string;       // Signal's internal UUID (more stable than phone)
  displayName?: string;      // Contact name from signal-cli or platform username
  isLinkedDevice: boolean;
}

export interface ChannelMessage {
  id: string;                // Signal timestamp as string
  from: ChannelIdentity;
  channelId: string;         // "direct" | group UUID
  channelType: "direct" | "group";
  content: string;           // Raw message text
  timestamp: Date;
  attachments?: string[];    // File paths of downloaded attachments
  /** PM Zora only: routing target project name, set by SignalIntakeAdapter */
  project?: string;
}

export interface CapabilitySet {
  senderPhone: string;
  channelId: string;
  role: string;              // "trusted_admin" | "trusted_user" | "read_only" | "denied"
  allowedTools: string[];    // Tool names from Zora's tool registry
  destructiveOpsAllowed: boolean;
  actionBudget: number;      // Max actions per task
  paramConstraints?: {
    // Optional per-tool constraints (Tenuo-inspired)
    bash?: { commandAllowlist?: string[]; commandBlocklist?: string[] };
    write_file?: { pathAllowlist?: string[] };
  };
}

export interface ScopedTask {
  intent: StructuredIntent;
  capability: CapabilitySet;
  channelMessage: ChannelMessage;
}

export interface StructuredIntent {
  goal: string;              // Extracted by QuarantineProcessor
  params: Record<string, unknown>;
  taintLevel: "trusted" | "channel_sourced";  // CaMeL provenance tag
  /** Set by QuarantineProcessor when injection patterns are detected */
  suspicious?: boolean;
  /** Human-readable reason why the intent was flagged */
  suspicious_reason?: string;
}

/**
 * Returns a fresh denied CapabilitySet — used when sender is not in policy or role is null.
 * Returns a new object each call to prevent mutation of the default-deny path.
 */
export function deniedCapability(): CapabilitySet {
  return {
    senderPhone: "",
    channelId: "",
    role: "denied",
    allowedTools: [],
    destructiveOpsAllowed: false,
    actionBudget: 0,
  };
}
