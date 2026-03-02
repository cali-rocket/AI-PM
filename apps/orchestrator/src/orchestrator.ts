/**
 * Responsibility: minimal end-to-end orchestrator with Personal Assistant wiring.
 * Personal task flow preserves Notion as source-of-truth and returns a one-final-speaker response.
 */

import type { PersonalAssistantIntent } from "../../../packages/agents/src";
import type { AgentType, ConfidenceLevel } from "../../../packages/core-types/src";
import type {
  CollaborationPlan,
  OrchestrationContext,
  OrchestrationTrace,
  PrimaryAgentSelectionResult,
  UserRequest,
  UserResponse,
} from "./types";

export interface Orchestrator {
  handleUserRequest(request: UserRequest, context: OrchestrationContext): Promise<UserResponse>;
  selectPrimaryAgent(
    request: UserRequest,
    context: OrchestrationContext
  ): PrimaryAgentSelectionResult;
  buildCollaborationPlan(
    request: UserRequest,
    selection: PrimaryAgentSelectionResult,
    context: OrchestrationContext
  ): CollaborationPlan;
  finalizeResponse(input: {
    request: UserRequest;
    selection: PrimaryAgentSelectionResult;
    plan: CollaborationPlan;
    summary: string;
    confidence: ConfidenceLevel;
    usedSources: Array<"notion" | "shared_memory" | "unknown">;
    referencedNotionPageIds?: string[];
    traceNotes?: string[];
  }): UserResponse;
}

export class MockOrchestrator implements Orchestrator {
  async handleUserRequest(
    request: UserRequest,
    context: OrchestrationContext
  ): Promise<UserResponse> {
    const selection = this.selectPrimaryAgent(request, context);
    const plan = this.buildCollaborationPlan(request, selection, context);

    let summary =
      "[Mock] 요청을 수신했지만 연결된 에이전트 런타임이 없어 기본 응답으로 반환합니다.";
    let confidence: ConfidenceLevel = "needs_review";
    let usedSources: Array<"notion" | "shared_memory" | "unknown"> = ["unknown"];
    let referencedNotionPageIds: string[] = [];
    const traceNotes: string[] = [];

    if (selection.resolvedPrimaryAgent === "personal_assistant") {
      if (context.personalAssistantAgent && context.personalAssistantRuntimeContext) {
        // Read-first path: Personal Assistant runtime reads Notion source-of-truth first.
        const executionResult = await context.personalAssistantAgent.handleRequest(
          {
            requestId: request.id,
            userId: request.userId,
            notionDatabaseId: this.resolveNotionDatabaseId(request, context),
            intent: this.resolvePersonalAssistantIntent(request.text),
            notionPageId: this.tryGetNotionPageId(request.context),
            userText: request.text,
          },
          context.personalAssistantRuntimeContext
        );

        summary = executionResult.summary;
        confidence = executionResult.confidence;
        usedSources = executionResult.usedSources;
        referencedNotionPageIds = executionResult.referencedNotionPageIds;
        traceNotes.push("Delegated execution to Personal Assistant runtime.");
      } else {
        summary =
          "[Mock] personal_assistant로 라우팅되었지만 런타임 주입이 없어 실행하지 못했습니다.";
        confidence = "needs_review";
        usedSources = ["unknown"];
        traceNotes.push("Personal Assistant runtime dependency is missing.");
      }
    } else {
      // TODO: Connect Service Planning/Product Operations runtime after PA flow stabilization.
      summary = `[Mock] ${selection.resolvedPrimaryAgent} 연결은 아직 비활성화되어 있습니다.`;
      confidence = "tentative";
      usedSources = ["unknown"];
      traceNotes.push("Non-personal agents are not wired in this minimal flow.");
    }

    const response = this.finalizeResponse({
      request,
      selection,
      plan,
      summary,
      confidence,
      usedSources,
      referencedNotionPageIds,
      traceNotes,
    });

    if (context.auditLogger) {
      // TODO: Replace with richer audit schema when global AuditLogger contract is finalized.
      await context.auditLogger.logOrchestration({
        requestId: request.id,
        selectedPrimaryAgent: selection.resolvedPrimaryAgent,
        usedSources: response.usedSources,
        confidence: response.confidence,
        trace: response.trace,
        createdAt: new Date().toISOString(),
      });
    }

    return response;
  }

  selectPrimaryAgent(
    request: UserRequest,
    context: OrchestrationContext
  ): PrimaryAgentSelectionResult {
    const explicitTarget = request.targetAgent ?? (request.target && request.target !== "desk" ? request.target : undefined);
    if (explicitTarget) {
      return {
        resolvedPrimaryAgent: explicitTarget,
        reason: "user_selected",
        matchedIntent: explicitTarget === "personal_assistant" ? "personal_execution" : "unknown",
        notes: ["User explicitly selected a target agent."],
      };
    }

    const text = request.text.toLowerCase();
    if (this.containsAny(text, ["오늘", "할 일", "개인 업무", "진행 중", "todo", "task", "my task"])) {
      return {
        resolvedPrimaryAgent: "personal_assistant",
        reason: "desk_intent",
        matchedIntent: "personal_execution",
        notes: ["Matched minimal personal assistant intent keywords."],
      };
    }
    if (this.containsAny(text, ["idea", "아이디어", "전략", "서비스"])) {
      return {
        resolvedPrimaryAgent: "service_planning_ideation",
        reason: "desk_intent",
        matchedIntent: "service_ideation",
      };
    }
    if (this.containsAny(text, ["리스크", "마감", "프로젝트", "blocker"])) {
      return {
        resolvedPrimaryAgent: "product_operations",
        reason: "desk_intent",
        matchedIntent: "project_operations",
      };
    }

    return {
      resolvedPrimaryAgent: context.defaultAgent,
      reason: "fallback_default",
      matchedIntent: "unknown",
      notes: ["No clear intent match. Using default agent."],
    };
  }

  buildCollaborationPlan(
    _request: UserRequest,
    selection: PrimaryAgentSelectionResult,
    _context: OrchestrationContext
  ): CollaborationPlan {
    if (selection.resolvedPrimaryAgent === "personal_assistant") {
      return {
        resolvedPrimaryAgent: selection.resolvedPrimaryAgent,
        requiresCollaboration: false,
        tasks: [],
        notes: [
          "Minimal mode: no cross-agent collaboration for personal assistant path.",
          "Personal assistant runtime handles Notion-first reads and optional shared-memory refs.",
        ],
      };
    }

    return {
      resolvedPrimaryAgent: selection.resolvedPrimaryAgent,
      requiresCollaboration: false,
      tasks: [],
      notes: ["Runtime wiring for non-personal agents is pending."],
    };
  }

  finalizeResponse(input: {
    request: UserRequest;
    selection: PrimaryAgentSelectionResult;
    plan: CollaborationPlan;
    summary: string;
    confidence: ConfidenceLevel;
    usedSources: Array<"notion" | "shared_memory" | "unknown">;
    referencedNotionPageIds?: string[];
    traceNotes?: string[];
  }): UserResponse {
    const trace: OrchestrationTrace = {
      selectedBy: input.selection.reason,
      selectedIntent: input.selection.matchedIntent,
      collaborationTaskCount: input.plan.tasks.length,
      notes: input.traceNotes,
      referencedNotionPageIds: input.referencedNotionPageIds,
    };

    return {
      id: `resp:${input.request.id}`,
      requestId: input.request.id,
      primaryAgent: input.selection.resolvedPrimaryAgent,
      resolvedPrimaryAgent: input.selection.resolvedPrimaryAgent,
      summary: input.summary,
      confidence: input.confidence,
      usedSources: input.usedSources,
      generatedAt: new Date().toISOString(),
      trace,
    };
  }

  private resolvePersonalAssistantIntent(text: string): PersonalAssistantIntent {
    const normalized = text.toLowerCase();
    if (this.containsAny(normalized, ["진행 중", "in progress"])) {
      return "list_in_progress";
    }
    if (this.containsAny(normalized, ["미시작", "아직 시작", "not started"])) {
      return "list_not_started";
    }
    if (this.containsAny(normalized, ["마감", "due"])) {
      return "list_with_due_date";
    }
    if (this.containsAny(normalized, ["상세", "본문", "detail", "body"])) {
      return "get_task_detail";
    }
    return "build_daily_summary";
  }

  private resolveNotionDatabaseId(request: UserRequest, context: OrchestrationContext): string {
    const fromRequest = request.context?.notionDatabaseId;
    if (typeof fromRequest === "string" && fromRequest.length > 0) {
      return fromRequest;
    }
    return context.personalAssistantNotionDatabaseId ?? "notion-db-personal-tasks";
  }

  private tryGetNotionPageId(context: UserRequest["context"]): string | undefined {
    const value = context?.notionPageId;
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    return undefined;
  }

  private containsAny(text: string, keywords: string[]): boolean {
    return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
  }
}
