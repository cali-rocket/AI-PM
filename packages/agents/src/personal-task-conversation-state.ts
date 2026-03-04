/**
 * Responsibility: in-session conversation working state for Personal Task Assistant.
 *
 * This state is not source-of-truth. It stores only recent interaction context
 * to support follow-up turns such as "that task", "among these", and "from here".
 */

import type { ConfidenceLevel } from "../../core-types/src";
import type { NotionTaskPageBody, NotionTaskRecord } from "../../tool-connectors/src";
import type { PersonalTaskActionType } from "./personal-task-actions";
import type { PersonalTaskIntentParseResult } from "./personal-task-intent-parser";
import type {
  PersonalTaskPolicyGateResult,
  PolicyExecutionMode,
} from "./personal-task-policy-gate";
import type { AgentExecutionResult } from "./types";

export interface LastActionContext {
  actionType: PersonalTaskActionType;
  usedSources: Array<"notion" | "shared_memory">;
  confidence: ConfidenceLevel;
  referencedNotionPageIds: string[];
  summary: string;
}

export interface ConversationState {
  conversationId: string;
  userId: string;
  lastUserMessage?: string;
  lastAgentSummary?: string;
  lastActionType?: PersonalTaskActionType;
  lastActionMode?: PolicyExecutionMode | "reasoning_only";
  lastReferencedTaskIds: string[];
  lastReferencedNotionPageIds: string[];
  lastTaskListSnapshot?: NotionTaskRecord[];
  lastTaskBodySnapshot?: NotionTaskPageBody | null;
  lastReasoningTopic?: string;
  lastActionContext?: LastActionContext;
  updatedAt: string;
}

export interface ConversationStateUpdateInput {
  userMessage: string;
  parseResult?: PersonalTaskIntentParseResult;
  policyResult?: PersonalTaskPolicyGateResult;
  executionResult?: AgentExecutionResult;
  reasoningSummary?: string;
}

export function createInitialConversationState(input: {
  conversationId: string;
  userId: string;
  now: string;
}): ConversationState {
  return {
    conversationId: input.conversationId,
    userId: input.userId,
    updatedAt: input.now,
    lastReferencedTaskIds: [],
    lastReferencedNotionPageIds: [],
  };
}

export function reduceConversationState(
  state: ConversationState,
  input: ConversationStateUpdateInput,
  now: string
): ConversationState {
  const next: ConversationState = {
    ...state,
    lastUserMessage: input.userMessage,
    updatedAt: now,
  };

  if (input.reasoningSummary) {
    next.lastReasoningTopic = input.reasoningSummary;
  }

  if (input.parseResult?.mode === "reasoning_only") {
    next.lastActionMode = "reasoning_only";
    if (input.executionResult) {
      next.lastAgentSummary = input.executionResult.summary;
      next.lastTaskBodySnapshot = input.executionResult.queryResult.taskBody ?? null;
    } else if (input.reasoningSummary) {
      next.lastAgentSummary = input.reasoningSummary;
    }
    return next;
  }

  if (input.parseResult?.mode === "needs_clarification") {
    next.lastActionMode = "clarification_required";
    if (input.executionResult) {
      next.lastAgentSummary = input.executionResult.summary;
    }
    return clearStaleActionContext(next);
  }

  if (input.parseResult?.mode === "blocked") {
    next.lastActionMode = "blocked";
    if (input.executionResult) {
      next.lastAgentSummary = input.executionResult.summary;
    }
    return clearStaleActionContext(next);
  }

  if (!input.executionResult) {
    if (input.policyResult?.mode === "clarification_required") {
      next.lastActionMode = "clarification_required";
      return clearStaleActionContext(next);
    }

    if (input.policyResult?.mode === "blocked") {
      next.lastActionMode = "blocked";
      return clearStaleActionContext(next);
    }

    return next;
  }

  const result = input.executionResult;
  next.lastAgentSummary = result.summary;
  next.lastTaskBodySnapshot = result.queryResult.taskBody ?? null;

  if (input.policyResult) {
    next.lastActionMode = input.policyResult.mode;
  }

  const resolvedActionType =
    input.policyResult?.resolvedActionIntent?.action ?? input.parseResult?.actionIntent?.action;
  if (resolvedActionType) {
    next.lastActionType = resolvedActionType;
  }

  const mergedReferences = mergeReferencedTasks({
    previousTaskIds: state.lastReferencedTaskIds,
    previousNotionPageIds: state.lastReferencedNotionPageIds,
    newTasks: result.queryResult.tasks,
    newNotionPageIds: result.referencedNotionPageIds,
    pinToFrontPageId:
      resolvedActionType === "get_task_detail"
        ? input.policyResult?.resolvedActionIntent?.slots.pageId ??
          result.referencedNotionPageIds[0]
        : undefined,
  });
  next.lastReferencedTaskIds = mergedReferences.taskIds;
  next.lastReferencedNotionPageIds = mergedReferences.notionPageIds;

  if (resolvedActionType === "list_tasks") {
    next.lastTaskListSnapshot = result.queryResult.tasks;
  }

  if (resolvedActionType === "get_task_detail" && !next.lastTaskListSnapshot) {
    next.lastTaskListSnapshot = result.queryResult.tasks;
  }

  if (resolvedActionType) {
    next.lastActionContext = {
      actionType: resolvedActionType,
      usedSources: result.usedSources,
      confidence: result.confidence,
      referencedNotionPageIds: result.referencedNotionPageIds,
      summary: result.summary,
    };
  }

  if (input.policyResult?.mode === "clarification_required" || input.policyResult?.mode === "blocked") {
    return clearStaleActionContext(next);
  }

  return next;
}

export function mergeReferencedTasks(input: {
  previousTaskIds: string[];
  previousNotionPageIds: string[];
  newTasks: NotionTaskRecord[];
  newNotionPageIds: string[];
  pinToFrontPageId?: string;
}): {
  taskIds: string[];
  notionPageIds: string[];
} {
  const nextTaskIds = dedupe([
    ...input.newTasks.map((task) => task.notionPageId),
    ...input.newNotionPageIds,
    ...input.previousTaskIds,
  ]);
  const nextPageIds = dedupe([
    ...input.newNotionPageIds,
    ...input.newTasks.map((task) => task.notionPageId),
    ...input.previousNotionPageIds,
  ]);

  if (!input.pinToFrontPageId) {
    return {
      taskIds: nextTaskIds,
      notionPageIds: nextPageIds,
    };
  }

  return {
    taskIds: moveToFront(nextTaskIds, input.pinToFrontPageId),
    notionPageIds: moveToFront(nextPageIds, input.pinToFrontPageId),
  };
}

export function clearStaleActionContext(state: ConversationState): ConversationState {
  // TODO: add TTL / decay rule so old snapshots are pruned automatically.
  return state;
}

export class InMemoryPersonalTaskConversationStateManager {
  private readonly states = new Map<string, ConversationState>();

  getOrCreate(key: string, seed: { conversationId: string; userId: string; now: string }): ConversationState {
    const existing = this.states.get(key);
    if (existing) {
      return existing;
    }

    const initial = createInitialConversationState(seed);
    this.states.set(key, initial);
    return initial;
  }

  update(
    key: string,
    input: ConversationStateUpdateInput,
    now: string
  ): ConversationState {
    const current = this.states.get(key);
    if (!current) {
      throw new Error(
        "Conversation state does not exist for this key. Call getOrCreate(...) before update(...)."
      );
    }
    const next = reduceConversationState(current, input, now);
    this.states.set(key, next);
    return next;
  }

  set(key: string, state: ConversationState): void {
    this.states.set(key, state);
  }
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function moveToFront(values: string[], target: string): string[] {
  const filtered = values.filter((value) => value !== target);
  return [target, ...filtered];
}
