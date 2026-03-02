/**
 * Responsibility: in-memory mock implementation of AgentMessageBus.
 * This implementation is designed for local development/tests without external dependencies.
 */

import type { AgentMessageBus, MessageHistoryQuery } from "./message-bus";
import type {
  AgentHandlerRegistration,
  AgentMessageEnvelope,
  AgentMessageRequest,
  AgentMessageResponse,
} from "./types";
import {
  isAgentMessageRequest,
  isAgentMessageResponse,
  validateRoutingMetadata,
} from "./guards";

export class InMemoryAgentMessageBus implements AgentMessageBus {
  private readonly handlers = new Map<
    AgentHandlerRegistration["agent"],
    AgentHandlerRegistration
  >();

  private readonly history: AgentMessageEnvelope[] = [];

  registerHandler(registration: AgentHandlerRegistration): void {
    this.handlers.set(registration.agent, registration);
  }

  async dispatchRequest(request: AgentMessageRequest): Promise<AgentMessageResponse> {
    if (!isAgentMessageRequest(request) || !validateRoutingMetadata(request.routing)) {
      throw new Error("Invalid AgentMessageRequest.");
    }

    // TODO: Add stronger loop prevention (e.g. visited-agent set and TTL window).
    if (request.routing.hop > request.routing.maxHops) {
      throw new Error("Routing hop limit exceeded.");
    }

    this.history.push({
      kind: "request",
      messageType: request.messageType,
      routing: request.routing,
      request,
    });

    const handler = this.handlers.get(request.to);
    if (!handler) {
      throw new Error(`No handler registered for agent: ${request.to}`);
    }

    if (!handler.supportedMessageTypes.includes(request.messageType)) {
      throw new Error(
        `Handler ${request.to} does not support message type: ${request.messageType}`
      );
    }

    const response = await handler.handleRequest(request);
    await this.dispatchResponse(response);
    return response;
  }

  async dispatchResponse(response: AgentMessageResponse): Promise<void> {
    if (!isAgentMessageResponse(response) || !validateRoutingMetadata(response.routing)) {
      throw new Error("Invalid AgentMessageResponse.");
    }

    this.history.push({
      kind: "response",
      messageType: this.resolveMessageType(response),
      routing: response.routing,
      response,
    });
  }

  getMessageHistory(query?: MessageHistoryQuery): AgentMessageEnvelope[] {
    if (!query) {
      return [...this.history];
    }

    const filtered = this.history.filter((envelope) => {
      if (query.traceId && envelope.routing.traceId !== query.traceId) {
        return false;
      }
      if (query.correlationId && envelope.routing.correlationId !== query.correlationId) {
        return false;
      }
      if (query.messageType && envelope.messageType !== query.messageType) {
        return false;
      }
      if (query.participant) {
        if (envelope.kind === "request") {
          return (
            envelope.request.from === query.participant || envelope.request.to === query.participant
          );
        }
        return (
          envelope.response.from === query.participant || envelope.response.to === query.participant
        );
      }
      return true;
    });

    if (!query.limit || query.limit < 1) {
      return filtered;
    }

    return filtered.slice(Math.max(filtered.length - query.limit, 0));
  }

  async send(request: AgentMessageRequest): Promise<AgentMessageResponse> {
    return this.dispatchRequest(request);
  }

  async sendBatch(requests: AgentMessageRequest[]): Promise<AgentMessageResponse[]> {
    const responses: AgentMessageResponse[] = [];
    for (const request of requests) {
      // TODO: Evaluate parallel dispatch policy while preserving trace determinism.
      responses.push(await this.dispatchRequest(request));
    }
    return responses;
  }

  private resolveMessageType(response: AgentMessageResponse): AgentMessageEnvelope["messageType"] {
    const requestEnvelope = this.history.find(
      (entry) => entry.kind === "request" && entry.request.id === response.requestId
    );
    return requestEnvelope?.messageType ?? "info_request";
  }
}
