/**
 * Responsibility: structured agent collaboration contracts (request/response).
 * This file defines protocol-level message types and envelopes only.
 */

import type {
  AgentType as CoreAgentType,
  ConfidenceLevel as CoreConfidenceLevel,
  MessageType as CoreMessageType,
  SourceRef,
} from "../../core-types/src";

export type AgentType = CoreAgentType;

export type MessageType = CoreMessageType;

export type ConfidenceLevel = CoreConfidenceLevel;

export type EscalationReason =
  | "source_of_truth_conflict"
  | "missing_user_preference"
  | "persistent_uncertainty"
  | "high_risk_if_unconfirmed"
  | "policy_or_permission_blocked"
  | "unknown";

export interface MessageRoutingMetadata {
  traceId: string;
  correlationId: string;
  parentMessageId?: string;
  hop: number;
  maxHops: number;
  createdAt: string;
  updatedAt?: string;
  requiresResponse: boolean;
}

export interface AgentMessageRequest {
  id: string;
  messageType: MessageType;
  from: AgentType;
  to: AgentType;
  requestText: string;
  payload?: Record<string, unknown>;
  routing: MessageRoutingMetadata;
  requestedAt: string;
}

export interface AgentMessageResponse {
  id: string;
  requestId: string;
  from: AgentType;
  to: AgentType;
  responseText: string;
  payload?: Record<string, unknown>;
  confidence: ConfidenceLevel;
  supportingSources: SourceRef[];
  needsEscalationToUser: boolean;
  escalationReason?: EscalationReason;
  routing: MessageRoutingMetadata;
  respondedAt: string;
}

export type AgentMessageEnvelope =
  | {
      kind: "request";
      messageType: MessageType;
      routing: MessageRoutingMetadata;
      request: AgentMessageRequest;
    }
  | {
      kind: "response";
      messageType: MessageType;
      routing: MessageRoutingMetadata;
      response: AgentMessageResponse;
    };

export interface AgentHandlerRegistration {
  agent: AgentType;
  supportedMessageTypes: MessageType[];
  handleRequest: (request: AgentMessageRequest) => Promise<AgentMessageResponse>;
}

export interface CollaborationTrace {
  correlationId: string;
  primaryAgent: AgentType;
  involvedAgents: AgentType[];
  messageCount: number;
  completedAt: string;
}
