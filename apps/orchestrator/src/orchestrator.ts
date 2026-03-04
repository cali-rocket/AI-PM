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
      "[Mock] Request received, but selected runtime is not wired yet so a fallback response is returned.";
    let confidence: ConfidenceLevel = "needs_review";
    let usedSources: Array<"notion" | "shared_memory" | "unknown"> = ["unknown"];
    let referencedNotionPageIds: string[] = [];
    const traceNotes: string[] = [];

    if (selection.resolvedPrimaryAgent === "personal_assistant") {
      if (context.personalAssistantAgent && context.personalAssistantRuntimeContext) {
        const runtime = context.personalAssistantRuntimeContext;
        const readerDatabaseId = runtime.notionTasksReader.personalTasksDatabaseId;
        if (readerDatabaseId !== context.personalTasksDatabaseId) {
          summary =
            "[Mock] Personal Tasks databaseId mismatch between orchestrator config and Personal Tasks reader.";
          confidence = "needs_review";
          usedSources = ["unknown"];
          traceNotes.push("Detected databaseId mismatch; skipped Personal Assistant execution.");
        } else {
          const executionResult = await context.personalAssistantAgent.handleRequest(
            {
              requestId: request.id,
              userId: request.userId,
              conversationId: request.conversationId,
              intent: this.resolvePersonalAssistantIntent(request),
              notionPageId: this.tryGetNotionPageId(request.context),
              userText: request.text,
            },
            runtime
          );

          summary = executionResult.summary;
          confidence = executionResult.confidence;
          usedSources = executionResult.usedSources;
          referencedNotionPageIds = executionResult.referencedNotionPageIds;
          traceNotes.push(
            `Delegated execution to Personal Assistant runtime (databaseId=${context.personalTasksDatabaseId}).`
          );
        }
      } else {
        summary = "[Mock] Routed to personal_assistant but runtime dependencies are missing.";
        confidence = "needs_review";
        usedSources = ["unknown"];
        traceNotes.push("Personal Assistant runtime dependency is missing.");
      }
    } else {
      // TODO: Connect Service Planning/Product Operations runtime after PA flow stabilization.
      summary = `[Mock] ${selection.resolvedPrimaryAgent} runtime is not wired yet.`;
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
    const explicitTarget =
      request.targetAgent ?? (request.target && request.target !== "desk" ? request.target : undefined);
    if (explicitTarget) {
      return {
        resolvedPrimaryAgent: explicitTarget,
        reason: "user_selected",
        matchedIntent: explicitTarget === "personal_assistant" ? "personal_execution" : "unknown",
        notes: ["User explicitly selected a target agent."],
      };
    }

    if (this.isPersonalTaskContext(request)) {
      return {
        resolvedPrimaryAgent: "personal_assistant",
        reason: "desk_intent",
        matchedIntent: "personal_execution",
        notes: ["Matched personal task intent keywords for desk request routing."],
      };
    }

    const normalized = request.text.toLowerCase();
    if (this.containsAny(normalized, ["idea", "ideation", "\uc544\uc774\ub514\uc5b4", "\uae30\ud68d", "\uc11c\ube44\uc2a4"])) {
      return {
        resolvedPrimaryAgent: "service_planning_ideation",
        reason: "desk_intent",
        matchedIntent: "service_ideation",
      };
    }
    if (
      this.containsAny(normalized, [
        "deadline",
        "blocker",
        "project",
        "operations",
        "\ub9c8\uac10",
        "\ud504\ub85c\uc81d\ud2b8",
        "\ub9ac\uc2a4\ud06c",
      ])
    ) {
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
          "Personal Assistant handles Notion Personal Tasks reads first, shared-memory refs second.",
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

  private resolvePersonalAssistantIntent(request: UserRequest): PersonalAssistantIntent {
    const normalized = request.text.toLowerCase();

    if (this.tryGetNotionPageId(request.context)) {
      return "get_task_detail";
    }
    if (
      this.containsAny(normalized, [
        "detail",
        "body",
        "page",
        "\uc0c1\uc138",
        "\ubcf8\ubb38",
        "\ud398\uc774\uc9c0",
      ])
    ) {
      return "get_task_detail";
    }
    if (this.containsAny(normalized, ["\uc9c4\ud589 \uc911", "in progress"])) {
      return "list_in_progress";
    }
    if (this.containsAny(normalized, ["\ubbf8\uc2dc\uc791", "\uc2dc\uc791 \uc804", "not started"])) {
      return "list_not_started";
    }
    if (this.containsAny(normalized, ["\ub9c8\uac10", "due", "deadline"])) {
      return "list_with_due_date";
    }
    return "build_daily_summary";
  }

  private isPersonalTaskContext(request: UserRequest): boolean {
    if (this.tryGetNotionPageId(request.context)) {
      return true;
    }

    const normalized = request.text.toLowerCase();
    return this.containsAny(normalized, [
      "task",
      "tasks",
      "todo",
      "to-do",
      "my task",
      "notion",
      "personal task",
      "\uac1c\uc778 \uc5c5\ubb34",
      "\uc5c5\ubb34",
      "\ud560\uc77c",
      "\ud560 \uc77c",
      "\uc624\ub298",
      "\uc9c4\ud589 \uc911",
      "\uc0c1\uc138",
      "\ubcf8\ubb38",
    ]);
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
