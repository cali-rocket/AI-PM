/**
 * Responsibility: Personal Assistant runtime with hybrid handling.
 *
 * Hybrid rule:
 * - Not every user turn must become an action call.
 * - Parser first decides handling mode:
 *   action_required | reasoning_only | needs_clarification | blocked
 * - Actions remain the standard channel for data access.
 */

import type { NotionTaskRecord } from "../../tool-connectors/src";
import {
  type PersonalTaskActionIntent,
} from "./personal-task-actions";
import {
  MockPersonalTaskIntentParser,
  type PersonalTaskIntentParseResult,
  type PersonalTaskIntentParser,
} from "./personal-task-intent-parser";
import {
  MockPersonalTaskPolicyGate,
  type PersonalTaskPolicyGate,
  type PersonalTaskPolicyGateResult,
} from "./personal-task-policy-gate";
import {
  RuleBasedPersonalTaskFollowUpResolver,
  type FollowUpResolutionResult,
  type PersonalTaskFollowUpResolver,
} from "./personal-task-follow-up-resolver";
import {
  InMemoryPersonalTaskConversationStateManager,
  type ConversationState,
  type ConversationStateUpdateInput,
} from "./personal-task-conversation-state";
import type {
  AgentExecutionInput,
  AgentExecutionResult,
  AgentRuntimeContext,
  PersonalAssistantIntent,
  PersonalAssistantQueryResult,
  TaskStatusFilter,
} from "./types";

type ReadIntent =
  | "list_in_progress"
  | "list_not_started"
  | "list_with_due_date"
  | "get_task_detail"
  | "build_daily_summary";

export interface PersonalAssistantAgent {
  handleRequest(input: AgentExecutionInput, context: AgentRuntimeContext): Promise<AgentExecutionResult>;
  listTasksByStatus(status: TaskStatusFilter, context: AgentRuntimeContext): Promise<PersonalAssistantQueryResult>;
  listTasksDueSoon(context: AgentRuntimeContext, daysAhead?: number): Promise<PersonalAssistantQueryResult>;
  getTaskDetail(notionPageId: string, context: AgentRuntimeContext): Promise<PersonalAssistantQueryResult>;
  buildDailyTaskSummary(context: AgentRuntimeContext): Promise<AgentExecutionResult>;
}

export interface MockPersonalAssistantAgentOptions {
  intentParser?: PersonalTaskIntentParser;
  policyGate?: PersonalTaskPolicyGate;
  followUpResolver?: PersonalTaskFollowUpResolver;
}

export class MockPersonalAssistantAgent implements PersonalAssistantAgent {
  private readonly conversationStateManager = new InMemoryPersonalTaskConversationStateManager();
  private readonly intentParser: PersonalTaskIntentParser;
  private readonly policyGate: PersonalTaskPolicyGate;
  private readonly followUpResolver: PersonalTaskFollowUpResolver;

  constructor(options?: MockPersonalAssistantAgentOptions) {
    this.intentParser = options?.intentParser ?? new MockPersonalTaskIntentParser();
    this.policyGate = options?.policyGate ?? new MockPersonalTaskPolicyGate();
    this.followUpResolver =
      options?.followUpResolver ?? new RuleBasedPersonalTaskFollowUpResolver();
  }

  async handleRequest(
    input: AgentExecutionInput,
    context: AgentRuntimeContext
  ): Promise<AgentExecutionResult> {
    if (!this.hasValidPersonalTasksScope(context)) {
      return this.buildScopeMismatchResult(input.intent);
    }

    const conversationKey = this.buildConversationKey(input);
    const state = this.getOrCreateConversationState(conversationKey, input, context.now);
    const userMessage = input.userText ?? "";
    const followUpResolution = this.followUpResolver.resolve({
      userText: userMessage,
      conversationState: state,
    });
    const hasExplicitDetailTarget = Boolean(input.notionPageId);

    if (followUpResolution.requiresClarification && !hasExplicitDetailTarget) {
      const parseResult = this.buildSyntheticNeedsClarificationParseResult(
        followUpResolution.clarificationQuestion ??
          "I found multiple follow-up candidates. Please tell me which task you mean.",
        followUpResolution.reasoningSummary
      );
      const response = this.buildClarificationResponse(state, parseResult);
      this.updateConversationState(
        conversationKey,
        {
          userMessage,
          parseResult,
          executionResult: response,
          reasoningSummary: followUpResolution.reasoningSummary,
        },
        context.now
      );
      return response;
    }

    let parseResult: PersonalTaskIntentParseResult;
    if (followUpResolution.canResolveFromConversationState) {
      if (this.isDetailFollowUpRequest(userMessage)) {
        const targetPageId =
          input.notionPageId ?? this.pickFollowUpDetailTarget(followUpResolution);
        if (!targetPageId) {
          const clarificationParse = this.buildSyntheticNeedsClarificationParseResult(
            "Which task should I open in detail from the recent context?",
            "Detail follow-up detected but target task is still ambiguous."
          );
          const response = this.buildClarificationResponse(state, clarificationParse);
          this.updateConversationState(
            conversationKey,
            {
              userMessage,
              parseResult: clarificationParse,
              executionResult: response,
              reasoningSummary:
                "Detail follow-up detected but target task is still ambiguous.",
            },
            context.now
          );
          return response;
        }

        parseResult = this.buildFollowUpDetailParseResult(
          userMessage,
          targetPageId,
          followUpResolution.reasoningSummary
        );
      } else if (this.isWriteLikeFollowUpRequest(userMessage)) {
        parseResult = this.intentParser.parseUserInput({
          userText: userMessage,
          fallbackIntent: input.intent,
          notionPageId: input.notionPageId,
          conversationState: state,
        });
      } else {
        const parseResultForReasoning = this.buildSyntheticReasoningParseResult(
          followUpResolution.reasoningSummary
        );
        const response = this.buildReasoningResponse(
          state,
          followUpResolution.reasoningSummary
        );
        this.updateConversationState(
          conversationKey,
          {
            userMessage,
            parseResult: parseResultForReasoning,
            executionResult: response,
            reasoningSummary: followUpResolution.reasoningSummary,
          },
          context.now
        );
        return response;
      }
    } else {
      parseResult = this.intentParser.parseUserInput({
        userText: userMessage,
        fallbackIntent: input.intent,
        notionPageId: input.notionPageId,
        conversationState: state,
      });
    }

    const policyDecision = this.policyGate.evaluate({
      parseResult,
      conversationState: state,
      requestedAt: context.now,
      userContext: {
        userId: input.userId,
        requestId: input.requestId,
        conversationId: input.conversationId,
      },
    });

    if (!policyDecision.actionExecutionRequired) {
      const response = this.buildReasoningResponse(state, parseResult.reasoningSummary);
      this.updateConversationState(conversationKey, {
        userMessage,
        parseResult,
        policyResult: policyDecision,
        executionResult: response,
        reasoningSummary: parseResult.reasoningSummary,
      }, context.now);
      return response;
    }

    if (this.policyGate.canExecuteNow(policyDecision)) {
      const actionIntent = this.resolveActionIntentForPolicy(policyDecision, parseResult);
      if (!actionIntent) {
        const response = this.buildClarificationResponse(state, {
          ...parseResult,
          mode: "needs_clarification",
          clarificationQuestion:
            policyDecision.clarificationQuestion ??
            "I could not resolve an executable action yet. Please clarify your request.",
          reasoningSummary: policyDecision.policySummary,
        });
        this.updateConversationState(conversationKey, {
          userMessage,
          parseResult,
          policyResult: policyDecision,
          executionResult: response,
          reasoningSummary: policyDecision.policySummary,
        }, context.now);
        return response;
      }

      const response = await this.executeActionIntent(actionIntent, input, context);
      this.updateConversationState(conversationKey, {
        userMessage,
        parseResult,
        policyResult: policyDecision,
        executionResult: response,
      }, context.now);
      return response;
    }

    if (this.policyGate.requiresApproval(policyDecision)) {
      const actionIntent = this.resolveActionIntentForPolicy(policyDecision, parseResult);
      if (!actionIntent) {
        const response = this.buildClarificationResponse(state, {
          ...parseResult,
          mode: "needs_clarification",
          clarificationQuestion:
            "Approval flow needs a concrete write target. Please clarify what should be created or updated.",
          reasoningSummary: policyDecision.policySummary,
        });
        this.updateConversationState(conversationKey, {
          userMessage,
          parseResult,
          policyResult: policyDecision,
          executionResult: response,
          reasoningSummary: policyDecision.policySummary,
        }, context.now);
        return response;
      }

      const response = this.buildApprovalPendingResponse(actionIntent, state);
      this.updateConversationState(conversationKey, {
        userMessage,
        parseResult,
        policyResult: policyDecision,
        executionResult: response,
      }, context.now);
      return response;
    }

    if (policyDecision.mode === "clarification_required") {
      const response = this.buildClarificationResponse(state, {
        ...parseResult,
        mode: "needs_clarification",
        clarificationQuestion:
          policyDecision.clarificationQuestion ?? parseResult.clarificationQuestion,
        reasoningSummary: policyDecision.policySummary,
      });
      this.updateConversationState(conversationKey, {
        userMessage,
        parseResult,
        policyResult: policyDecision,
        executionResult: response,
        reasoningSummary: policyDecision.policySummary,
      }, context.now);
      return response;
    }

    if (this.policyGate.shouldBlock(policyDecision)) {
      const response = this.buildPolicyBlockedResponse(policyDecision, state);
      this.updateConversationState(conversationKey, {
        userMessage,
        parseResult,
        policyResult: policyDecision,
        executionResult: response,
        reasoningSummary: policyDecision.policySummary,
      }, context.now);
      return response;
    }

    const response = this.buildPolicyBlockedResponse(
      {
        ...policyDecision,
        mode: "blocked",
        blockedReason: policyDecision.blockedReason ?? "Unable to route this request safely.",
      },
      state
    );
    this.updateConversationState(conversationKey, {
      userMessage,
      parseResult,
      policyResult: policyDecision,
      executionResult: response,
      reasoningSummary: policyDecision.policySummary,
    }, context.now);
    return response;
  }
  async listTasksByStatus(
    status: TaskStatusFilter,
    context: AgentRuntimeContext
  ): Promise<PersonalAssistantQueryResult> {
    // List path reads DB properties only. Page body is not fetched.
    const tasks = await context.notionTasksReader.listTasksByStatus(status, {
      includeDone: true,
    });

    const refs =
      tasks.length === 0
        ? (await context.sharedMemoryStore.listPersonalTaskSummaryRefs()).filter(
            (ref) => ref.status === status
          )
        : [];

    return {
      tasks,
      personalTaskSummaryRefs: refs,
    };
  }

  async listTasksDueSoon(
    context: AgentRuntimeContext,
    daysAhead?: number
  ): Promise<PersonalAssistantQueryResult> {
    // List path reads DB properties only. Page body is not fetched.
    const tasks = await context.notionTasksReader.listTasks({
      includeDone: false,
    });

    const nowTs = new Date(context.now).getTime();
    const upperTs =
      typeof daysAhead === "number" && daysAhead >= 0
        ? nowTs + daysAhead * 24 * 60 * 60 * 1000
        : undefined;

    const dueTasks = tasks
      .filter((task) => task.dueDate !== null)
      .filter((task) => {
        if (!upperTs) {
          return true;
        }
        return new Date(task.dueDate as string).getTime() <= upperTs;
      })
      .sort((a, b) => {
        const aTs = new Date(a.dueDate as string).getTime();
        const bTs = new Date(b.dueDate as string).getTime();
        return aTs - bTs;
      });

    const refs =
      dueTasks.length === 0
        ? (await context.sharedMemoryStore.listPersonalTaskSummaryRefs()).filter((ref) => {
            if (!ref.dueDate) {
              return false;
            }
            if (!upperTs) {
              return true;
            }
            return new Date(ref.dueDate).getTime() <= upperTs;
          })
        : [];

    return {
      tasks: dueTasks,
      personalTaskSummaryRefs: refs,
    };
  }

  async getTaskDetail(
    notionPageId: string,
    context: AgentRuntimeContext
  ): Promise<PersonalAssistantQueryResult> {
    // Detail path reads row metadata first, then page body only for the target page.
    const task = await context.notionTasksReader.getTaskByPageId(notionPageId);
    const taskBody = await context.notionTasksReader.getTaskPageBody(notionPageId);
    const tasks = task ? [task] : [];
    const refs =
      tasks.length === 0
        ? (await context.sharedMemoryStore.listPersonalTaskSummaryRefs()).filter(
            (ref) => ref.notionPageId === notionPageId
          )
        : [];

    return {
      tasks,
      taskBody,
      personalTaskSummaryRefs: refs,
    };
  }

  async buildDailyTaskSummary(context: AgentRuntimeContext): Promise<AgentExecutionResult> {
    const [inProgress, notStarted, dueTasks] = await Promise.all([
      this.listTasksByStatus("in progress", context),
      this.listTasksByStatus("not started", context),
      this.listTasksDueSoon(context),
    ]);

    const mergedTasks = this.uniqueTasks([
      ...inProgress.tasks,
      ...notStarted.tasks,
      ...dueTasks.tasks,
    ]);
    const mergedRefs = [
      ...inProgress.personalTaskSummaryRefs,
      ...notStarted.personalTaskSummaryRefs,
      ...dueTasks.personalTaskSummaryRefs,
    ];
    const uniqueRefs = this.uniqueRefs(mergedRefs);
    const usedSources: Array<"notion" | "shared_memory"> =
      uniqueRefs.length > 0 ? ["notion", "shared_memory"] : ["notion"];

    const summary =
      mergedTasks.length === 0 && uniqueRefs.length === 0
        ? "Daily personal task summary: no matching tasks found in Personal Tasks."
        : uniqueRefs.length > 0 && mergedTasks.length === 0
          ? `Daily personal task summary: no live Notion rows matched, so ${uniqueRefs.length} cached refs were used.`
          : `Daily personal task summary: in-progress ${inProgress.tasks.length}, not-started ${notStarted.tasks.length}, with due date ${dueTasks.tasks.length}.`;

    return {
      speaker: "personal_assistant",
      summary,
      usedSources,
      confidence: this.resolveDailySummaryConfidence(usedSources),
      referencedNotionPageIds: this.collectPageIds(mergedTasks),
      queryResult: {
        tasks: mergedTasks,
        personalTaskSummaryRefs: uniqueRefs,
      },
      intent: "build_daily_summary",
    };
  }
  private async executeActionIntent(
    actionIntent: PersonalTaskActionIntent,
    input: AgentExecutionInput,
    context: AgentRuntimeContext
  ): Promise<AgentExecutionResult> {
    if (actionIntent.action === "get_task_detail") {
      const notionPageId = actionIntent.slots.pageId ?? input.notionPageId;
      if (!notionPageId) {
        return {
          speaker: "personal_assistant",
          summary: "Task detail needs a target pageId.",
          usedSources: [],
          confidence: "needs_review",
          referencedNotionPageIds: [],
          queryResult: {
            tasks: [],
            taskBody: null,
            personalTaskSummaryRefs: [],
          },
          intent: "needs_clarification",
        };
      }

      const result = await this.getTaskDetail(notionPageId, context);
      const usedSources = this.buildUsedSources(result);
      const title = result.tasks[0]?.title ?? notionPageId;
      const bodyPreview = this.previewBody(result.taskBody?.body);
      const summary =
        result.tasks.length === 0
          ? result.personalTaskSummaryRefs.length > 0
            ? `Task detail could not be confirmed from live Notion rows for ${notionPageId}. Cached summary refs exist.`
            : `Task detail could not be found for ${notionPageId} in Personal Tasks.`
          : bodyPreview
            ? `Task detail loaded: ${title}. Body preview: ${bodyPreview}`
            : `Task detail loaded: ${title}. Page body is empty or unavailable.`;
      return {
        speaker: "personal_assistant",
        summary,
        usedSources,
        confidence: this.resolveDetailConfidence(result, usedSources),
        referencedNotionPageIds: this.collectPageIds(result.tasks),
        queryResult: result,
        intent: "get_task_detail",
      };
    }

    if (actionIntent.action === "list_tasks") {
      const resolvedReadIntent = this.resolveReadIntentForListAction(actionIntent, input.intent);

      if (resolvedReadIntent === "list_in_progress") {
        const result = await this.listTasksByStatus("in progress", context);
        return this.buildListResult(
          "In-progress personal tasks (properties only)",
          resolvedReadIntent,
          result
        );
      }

      if (resolvedReadIntent === "list_not_started") {
        const result = await this.listTasksByStatus("not started", context);
        return this.buildListResult(
          "Not-started personal tasks (properties only)",
          resolvedReadIntent,
          result
        );
      }

      if (resolvedReadIntent === "list_with_due_date") {
        const result = await this.listTasksDueSoon(context, input.daysAhead);
        return this.buildListResult(
          "Personal tasks with due date (properties only)",
          resolvedReadIntent,
          result
        );
      }

      return this.buildDailyTaskSummary(context);
    }

    // Write actions are not executed in current MVP.
    return {
      speaker: "personal_assistant",
      summary: "Write actions are not executable in MVP. This request remains approval-pending.",
      usedSources: [],
      confidence: "tentative",
      referencedNotionPageIds: [],
      queryResult: {
        tasks: [],
        taskBody: null,
        personalTaskSummaryRefs: [],
      },
      intent: "approval_pending",
    };
  }

  private resolveReadIntentForListAction(
    actionIntent: PersonalTaskActionIntent,
    fallbackIntent: PersonalAssistantIntent
  ): ReadIntent {
    if (actionIntent.slots.status === "in progress") {
      return "list_in_progress";
    }
    if (actionIntent.slots.status === "not started") {
      return "list_not_started";
    }
    if (fallbackIntent === "list_with_due_date") {
      return "list_with_due_date";
    }
    return "build_daily_summary";
  }

  private resolveActionIntentForPolicy(
    policyDecision: PersonalTaskPolicyGateResult,
    parseResult: PersonalTaskIntentParseResult
  ): PersonalTaskActionIntent | undefined {
    return policyDecision.resolvedActionIntent ?? parseResult.actionIntent;
  }

  private isDetailFollowUpRequest(userMessage: string): boolean {
    const normalized = userMessage.toLowerCase();
    return this.containsAny(normalized, [
      "detail",
      "show detail",
      "page body",
      "body",
      "\uC0C1\uC138", // 상세
      "\uC0C1\uC138\uD788", // 상세히
      "\uC790\uC138\uD788", // 자세히
      "\uBCF8\uBB38", // 본문
    ]);
  }
  private isWriteLikeFollowUpRequest(userMessage: string): boolean {
    const normalized = userMessage.toLowerCase();
    return this.containsAny(normalized, [
      "create",
      "add",
      "update",
      "modify",
      "done",
      "mark",
      "\uB4F1\uB85D", // 등록
      "\uCD94\uAC00", // 추가
      "\uC218\uC815", // 수정
      "\uBCC0\uACBD", // 변경
      "\uC644\uB8CC", // 완료
    ]);
  }
  private pickFollowUpDetailTarget(
    followUpResolution: FollowUpResolutionResult
  ): string | undefined {
    if (followUpResolution.resolvedNotionPageIds.length === 1) {
      return followUpResolution.resolvedNotionPageIds[0];
    }
    return undefined;
  }

  private buildFollowUpDetailParseResult(
    userMessage: string,
    notionPageId: string,
    reasoningSummary: string
  ): PersonalTaskIntentParseResult {
    return {
      mode: "action_required",
      actionIntent: {
        action: "get_task_detail",
        slots: { pageId: notionPageId },
        confidence: "likely",
        rawUserText: userMessage,
        reasoningNote:
          "Follow-up resolver mapped this turn to one recent task detail target.",
        requiresApproval: false,
        canExecuteImmediately: true,
      },
      confidence: "likely",
      reasoningSummary,
      usedConversationState: true,
      canAnswerWithoutAction: false,
    };
  }

  private buildSyntheticReasoningParseResult(
    reasoningSummary: string
  ): PersonalTaskIntentParseResult {
    return {
      mode: "reasoning_only",
      confidence: "likely",
      reasoningSummary,
      usedConversationState: true,
      canAnswerWithoutAction: true,
    };
  }

  private buildSyntheticNeedsClarificationParseResult(
    clarificationQuestion: string,
    reasoningSummary: string
  ): PersonalTaskIntentParseResult {
    return {
      mode: "needs_clarification",
      confidence: "needs_review",
      reasoningSummary,
      clarificationQuestion,
      usedConversationState: true,
      canAnswerWithoutAction: false,
    };
  }

  private buildReasoningResponse(
    state: ConversationState,
    reasoningSummary: string
  ): AgentExecutionResult {
    const tasks = state.lastTaskListSnapshot ?? [];
    if (tasks.length === 0) {
      return {
        speaker: "personal_assistant",
        summary: "I do not have recent task context yet. Ask for a task list first.",
        usedSources: [],
        confidence: "needs_review",
        referencedNotionPageIds: [],
        queryResult: {
          tasks: [],
          taskBody: null,
          personalTaskSummaryRefs: [],
        },
        intent: "needs_clarification",
      };
    }

    const quickCandidate = this.pickQuickFinishCandidate(tasks);
    const guidance = quickCandidate
      ? `Suggested quick candidate: "${quickCandidate.title}" (status: ${quickCandidate.status}).`
      : "No clear quick candidate found in recent tasks.";
    const summary = `${reasoningSummary} ${guidance}`.trim();

    return {
      speaker: "personal_assistant",
      summary,
      usedSources: this.resolveReasoningUsedSources(state),
      confidence: "likely",
      referencedNotionPageIds: this.collectPageIds(tasks),
      queryResult: {
        tasks,
        taskBody: state.lastTaskBodySnapshot ?? null,
        personalTaskSummaryRefs: [],
      },
      intent: "conversational_follow_up",
    };
  }

  private buildClarificationResponse(
    state: ConversationState,
    parseResult: PersonalTaskIntentParseResult
  ): AgentExecutionResult {
    return {
      speaker: "personal_assistant",
      summary:
        parseResult.clarificationQuestion ??
        "어떤 업무를 의미하는지 한 번만 더 구체적으로 알려줘.",
      usedSources: this.resolveReasoningUsedSources(state),
      confidence: "needs_review",
      referencedNotionPageIds: state.lastReferencedNotionPageIds,
      queryResult: {
        tasks: state.lastTaskListSnapshot ?? [],
        taskBody: state.lastTaskBodySnapshot ?? null,
        personalTaskSummaryRefs: [],
      },
      intent: "needs_clarification",
    };
  }
  private buildApprovalPendingResponse(
    actionIntent: PersonalTaskActionIntent,
    state: ConversationState
  ): AgentExecutionResult {
    const actionLabel =
      actionIntent.action === "create_task" ? "create task" : "update task";
    return {
      speaker: "personal_assistant",
      summary: `Detected a ${actionLabel} request. MVP policy keeps write actions as approval-pending only.`,
      usedSources: [],
      confidence: "tentative",
      referencedNotionPageIds: state.lastReferencedNotionPageIds,
      queryResult: {
        tasks: state.lastTaskListSnapshot ?? [],
        taskBody: null,
        personalTaskSummaryRefs: [],
      },
      intent: "approval_pending",
    };
  }

  private buildPolicyBlockedResponse(
    policyDecision: PersonalTaskPolicyGateResult,
    state: ConversationState
  ): AgentExecutionResult {
    return {
      speaker: "personal_assistant",
      summary:
        policyDecision.blockedReason ??
        policyDecision.policySummary ??
        "This request is blocked by current policy.",
      usedSources: this.resolveReasoningUsedSources(state),
      confidence: "needs_review",
      referencedNotionPageIds: state.lastReferencedNotionPageIds,
      queryResult: {
        tasks: state.lastTaskListSnapshot ?? [],
        taskBody: null,
        personalTaskSummaryRefs: [],
      },
      intent: "needs_clarification",
    };
  }

  private getOrCreateConversationState(
    conversationKey: string,
    input: AgentExecutionInput,
    now: string
  ): ConversationState {
    return this.conversationStateManager.getOrCreate(conversationKey, {
      conversationId: input.conversationId ?? `${input.userId}:default`,
      userId: input.userId,
      now,
    });
  }

  private updateConversationState(
    conversationKey: string,
    update: ConversationStateUpdateInput,
    now: string
  ): ConversationState {
    return this.conversationStateManager.update(conversationKey, update, now);
  }

  private buildConversationKey(input: AgentExecutionInput): string {
    return `${input.userId}:${input.conversationId ?? "default"}`;
  }

  private buildListResult(
    title: string,
    intent: PersonalAssistantIntent,
    result: PersonalAssistantQueryResult
  ): AgentExecutionResult {
    const names = result.tasks.map((task) => task.title).slice(0, 5);
    const summary = this.buildListSummary(title, names, result.personalTaskSummaryRefs.length);
    const usedSources = this.buildUsedSources(result);
    const confidence = this.resolveListConfidence(result, usedSources);

    return {
      speaker: "personal_assistant",
      summary,
      usedSources,
      confidence,
      referencedNotionPageIds: this.collectPageIds(result.tasks),
      queryResult: result,
      intent,
    };
  }

  private buildScopeMismatchResult(intent: PersonalAssistantIntent): AgentExecutionResult {
    return {
      speaker: "personal_assistant",
      summary:
        "Personal Tasks reader scope mismatch: configured databaseId and runtime databaseId are different.",
      usedSources: [],
      confidence: "needs_review",
      referencedNotionPageIds: [],
      queryResult: {
        tasks: [],
        taskBody: null,
        personalTaskSummaryRefs: [],
      },
      intent,
    };
  }

  private hasValidPersonalTasksScope(context: AgentRuntimeContext): boolean {
    return context.notionTasksReader.personalTasksDatabaseId === context.personalTasksDatabaseId;
  }

  private buildUsedSources(result: PersonalAssistantQueryResult): Array<"notion" | "shared_memory"> {
    if (result.personalTaskSummaryRefs.length > 0) {
      return ["notion", "shared_memory"];
    }
    return ["notion"];
  }

  private resolveReasoningUsedSources(
    state: ConversationState
  ): Array<"notion" | "shared_memory"> {
    const sources = state.lastActionContext?.usedSources ?? [];
    const resolved = sources.filter(
      (source): source is "notion" | "shared_memory" =>
        source === "notion" || source === "shared_memory"
    );
    return resolved;
  }

  private resolveListConfidence(
    result: PersonalAssistantQueryResult,
    usedSources: Array<"notion" | "shared_memory">
  ): "confirmed" | "likely" {
    if (usedSources.includes("shared_memory") || result.personalTaskSummaryRefs.length > 0) {
      return "likely";
    }
    return "confirmed";
  }

  private resolveDetailConfidence(
    result: PersonalAssistantQueryResult,
    usedSources: Array<"notion" | "shared_memory">
  ): "confirmed" | "likely" | "needs_review" {
    if (result.tasks.length === 0) {
      return "needs_review";
    }
    if (result.taskBody?.body && usedSources.length === 1 && usedSources[0] === "notion") {
      return "confirmed";
    }
    if (usedSources.includes("shared_memory")) {
      return "likely";
    }
    return "likely";
  }

  private buildListSummary(title: string, names: string[], refCount: number): string {
    if (names.length > 0) {
      return `${title}: ${names.join(", ")} (${names.length} shown)`;
    }
    if (refCount > 0) {
      return `${title}: no live Notion rows matched; ${refCount} cached refs were available.`;
    }
    return `${title}: no matching tasks found.`;
  }

  private resolveDailySummaryConfidence(
    usedSources: Array<"notion" | "shared_memory">
  ): "confirmed" | "likely" {
    if (usedSources.includes("shared_memory")) {
      return "likely";
    }
    return "confirmed";
  }
  private pickQuickFinishCandidate(tasks: NotionTaskRecord[]): NotionTaskRecord | null {
    const activeTasks = tasks.filter((task) => task.status !== "done");
    if (activeTasks.length === 0) {
      return null;
    }

    const sorted = [...activeTasks].sort((a, b) => {
      const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      if (aDue !== bDue) {
        return aDue - bDue;
      }
      return a.title.localeCompare(b.title);
    });

    return sorted[0] ?? null;
  }

  private previewBody(body?: string): string | null {
    if (!body) {
      return null;
    }
    const normalized = body.trim().replace(/\s+/g, " ");
    if (normalized.length === 0) {
      return null;
    }
    return normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized;
  }

  private collectPageIds(tasks: NotionTaskRecord[]): string[] {
    const ids = new Set<string>();
    for (const task of tasks) {
      ids.add(task.notionPageId);
    }
    return Array.from(ids);
  }

  private uniqueTasks(tasks: NotionTaskRecord[]): NotionTaskRecord[] {
    const map = new Map<string, NotionTaskRecord>();
    for (const task of tasks) {
      map.set(task.notionPageId, task);
    }
    return Array.from(map.values());
  }

  private uniqueRefs(refs: PersonalAssistantQueryResult["personalTaskSummaryRefs"]) {
    const map = new Map<string, PersonalAssistantQueryResult["personalTaskSummaryRefs"][number]>();
    for (const ref of refs) {
      map.set(ref.notionPageId, ref);
    }
    return Array.from(map.values());
  }

  private containsAny(text: string, keywords: string[]): boolean {
    return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
  }
}


