/**
 * Responsibility: message bus contracts for structured request/response collaboration.
 * This file defines API boundaries; concrete behavior lives in implementations.
 */

import type {
  AgentMessageEnvelope,
  AgentMessageRequest,
  AgentMessageResponse,
  AgentType,
  MessageType,
  AgentHandlerRegistration,
} from "./types";

export interface MessageHistoryQuery {
  traceId?: string;
  correlationId?: string;
  participant?: AgentType;
  messageType?: MessageType;
  limit?: number;
}

export interface AgentMessageBus {
  registerHandler(registration: AgentHandlerRegistration): void;
  dispatchRequest(request: AgentMessageRequest): Promise<AgentMessageResponse>;
  dispatchResponse(response: AgentMessageResponse): Promise<void>;
  getMessageHistory(query?: MessageHistoryQuery): AgentMessageEnvelope[];

  // Compatibility aliases for earlier skeletons.
  send(request: AgentMessageRequest): Promise<AgentMessageResponse>;
  sendBatch(requests: AgentMessageRequest[]): Promise<AgentMessageResponse[]>;
}
