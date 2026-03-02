/**
 * Responsibility: protocol-level runtime guards/validators for message safety checks.
 * Keep checks lightweight; can be replaced by schema validators later.
 */

import type {
  AgentMessageRequest,
  AgentMessageResponse,
  AgentType,
  ConfidenceLevel,
  MessageRoutingMetadata,
  MessageType,
} from "./types";

const AGENT_TYPES: AgentType[] = [
  "service_planning_ideation",
  "product_operations",
  "personal_assistant",
];

const MESSAGE_TYPES: MessageType[] = [
  "info_request",
  "feasibility_check",
  "schedule_check",
  "priority_review",
  "context_summary_request",
  "risk_check",
  "user_attention_check",
  "escalation_to_user",
];

const CONFIDENCE_LEVELS: ConfidenceLevel[] = [
  "confirmed",
  "likely",
  "tentative",
  "needs_review",
];

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isAgentType(value: unknown): value is AgentType {
  return typeof value === "string" && AGENT_TYPES.includes(value as AgentType);
}

export function isMessageType(value: unknown): value is MessageType {
  return typeof value === "string" && MESSAGE_TYPES.includes(value as MessageType);
}

export function isConfidenceLevel(value: unknown): value is ConfidenceLevel {
  return typeof value === "string" && CONFIDENCE_LEVELS.includes(value as ConfidenceLevel);
}

export function validateRoutingMetadata(value: unknown): value is MessageRoutingMetadata {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (typeof value.traceId !== "string") {
    return false;
  }
  if (typeof value.correlationId !== "string") {
    return false;
  }
  if (typeof value.hop !== "number" || typeof value.maxHops !== "number") {
    return false;
  }
  if (typeof value.createdAt !== "string") {
    return false;
  }
  if (typeof value.requiresResponse !== "boolean") {
    return false;
  }
  return true;
}

export function isAgentMessageRequest(value: unknown): value is AgentMessageRequest {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (typeof value.id !== "string") {
    return false;
  }
  if (!isMessageType(value.messageType)) {
    return false;
  }
  if (!isAgentType(value.from) || !isAgentType(value.to)) {
    return false;
  }
  if (typeof value.requestText !== "string") {
    return false;
  }
  if (typeof value.requestedAt !== "string") {
    return false;
  }
  if (!validateRoutingMetadata(value.routing)) {
    return false;
  }
  return true;
}

export function isAgentMessageResponse(value: unknown): value is AgentMessageResponse {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (typeof value.id !== "string") {
    return false;
  }
  if (typeof value.requestId !== "string") {
    return false;
  }
  if (!isAgentType(value.from) || !isAgentType(value.to)) {
    return false;
  }
  if (typeof value.responseText !== "string") {
    return false;
  }
  if (!isConfidenceLevel(value.confidence)) {
    return false;
  }
  if (!Array.isArray(value.supportingSources)) {
    return false;
  }
  if (typeof value.needsEscalationToUser !== "boolean") {
    return false;
  }
  if (typeof value.respondedAt !== "string") {
    return false;
  }
  if (!validateRoutingMetadata(value.routing)) {
    return false;
  }
  return true;
}

export function validateRequestForDispatch(request: AgentMessageRequest): boolean {
  // TODO: Expand with protocol policy checks (permission scope, rate limits, recursion thresholds).
  return isAgentMessageRequest(request);
}
