/**
 * Responsibility: orchestrator contracts for minimal end-to-end routing.
 * This structure prioritizes Personal Assistant flow with read-first and one-final-speaker principles.
 */

import type { AgentRuntimeContext as PersonalAssistantRuntimeContext } from "../../../packages/agents/src";
import type { PersonalAssistantAgent } from "../../../packages/agents/src";
import type { AgentType, ConfidenceLevel, NotificationLevel } from "../../../packages/core-types/src";
import type { MessageType } from "../../../packages/agent-protocol/src";

export interface UserRequest {
  id: string;
  userId: string;
  conversationId: string;
  text: string;
  requestedAt: string;
  // New explicit targeting field.
  targetAgent?: AgentType;
  // Backward-compatible field from earlier drafts.
  target?: AgentType | "desk";
  context?: Record<string, unknown>;
}

export interface OrchestrationTrace {
  selectedBy: PrimaryAgentSelectionResult["reason"];
  selectedIntent: PrimaryAgentSelectionResult["matchedIntent"];
  collaborationTaskCount: number;
  notes?: string[];
  referencedNotionPageIds?: string[];
}

export interface UserResponse {
  id: string;
  requestId: string;
  primaryAgent: AgentType;
  resolvedPrimaryAgent: AgentType;
  summary: string;
  confidence: ConfidenceLevel;
  usedSources: Array<"notion" | "shared_memory" | "unknown">;
  generatedAt: string;
  trace?: OrchestrationTrace;
}

export interface PrimaryAgentSelectionResult {
  resolvedPrimaryAgent: AgentType;
  reason: "user_selected" | "desk_intent" | "fallback_default";
  matchedIntent:
    | "service_ideation"
    | "project_operations"
    | "personal_execution"
    | "unknown";
  notes?: string[];
}

export interface CollaborationTask {
  to: AgentType;
  messageType: MessageType;
  rationale: string;
}

export interface CollaborationPlan {
  resolvedPrimaryAgent: AgentType;
  requiresCollaboration: boolean;
  tasks: CollaborationTask[];
  notes: string[];
}

export interface ProactiveUpdate {
  id: string;
  from: AgentType;
  level: NotificationLevel;
  summary: string;
  createdAt: string;
}

export interface OrchestrationAuditEvent {
  requestId: string;
  selectedPrimaryAgent: AgentType;
  usedSources: Array<"notion" | "shared_memory" | "unknown">;
  confidence: ConfidenceLevel;
  trace?: OrchestrationTrace;
  createdAt: string;
}

export interface AuditLogger {
  logOrchestration(event: OrchestrationAuditEvent): Promise<void> | void;
}

export interface OrchestrationContext {
  now: string;
  availableAgents: AgentType[];
  defaultAgent: AgentType;
  mode: "read_first";

  // Personal Assistant minimum runtime wiring.
  personalAssistantAgent?: PersonalAssistantAgent;
  personalAssistantRuntimeContext?: PersonalAssistantRuntimeContext;
  personalTasksDatabaseId: string;

  // Optional observability hook.
  auditLogger?: AuditLogger;
}
