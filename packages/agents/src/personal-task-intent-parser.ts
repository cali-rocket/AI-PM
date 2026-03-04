/**
 * Responsibility: intent parsing contract for Personal Task Assistant.
 *
 * This parser decides whether a turn needs an action call or can be answered from
 * conversation state. Current implementation is rule-based mock and can be replaced
 * with LLM parser later behind the same interface.
 */

import type { ConfidenceLevel } from "../../core-types/src";
import type { NotionTaskRecord } from "../../tool-connectors/src";
import type { PersonalAssistantIntent } from "./types";
import type {
  PersonalTaskActionIntent,
  PersonalTaskActionSlots,
} from "./personal-task-actions";
import type { ConversationState } from "./personal-task-conversation-state";

export type IntentHandlingMode =
  | "action_required"
  | "reasoning_only"
  | "needs_clarification"
  | "blocked";

export interface PersonalTaskIntentParseResult {
  mode: IntentHandlingMode;
  actionIntent?: PersonalTaskActionIntent;
  confidence: ConfidenceLevel;
  reasoningSummary: string;
  clarificationQuestion?: string;
  usedConversationState: boolean;
  canAnswerWithoutAction: boolean;
}

export interface PersonalTaskIntentParserInput {
  userText: string;
  fallbackIntent: PersonalAssistantIntent;
  notionPageId?: string;
  conversationState: ConversationState;
}

export interface PersonalTaskIntentParser {
  parseUserInput(input: PersonalTaskIntentParserInput): PersonalTaskIntentParseResult;
  shouldUseAction(input: PersonalTaskIntentParserInput): boolean;
  shouldUseConversationState(input: PersonalTaskIntentParserInput): boolean;
}

const TASK_NOUN_CUES = [
  "task",
  "tasks",
  "todo",
  "to-do",
  "\uC5C5\uBB34", // 업무
  "\uD560\uC77C", // 할일
];

const LIST_ACTION_CUES = [
  "list",
  "show",
  "lookup",
  "find",
  "in progress",
  "not started",
  "done",
  "due",
  "today",
  "\uBCF4\uC5EC", // 보여
  "\uC870\uD68C", // 조회
  "\uC9C4\uD589 \uC911", // 진행 중
  "\uBBF8\uC2DC\uC791", // 미시작
  "\uB9C8\uAC10", // 마감
  "\uC624\uB298", // 오늘
];

const FOLLOW_UP_REASONING_CUES = [
  "from here",
  "from those",
  "among these",
  "what next",
  "which one",
  "\uC5EC\uAE30\uC11C", // 여기서
  "\uC774 \uC911\uC5D0\uC11C", // 이 중에서
  "\uC774\uC911\uC5D0\uC11C", // 이중에서
  "\uBC29\uAE08 \uBCF8 \uAC83 \uC911\uC5D0", // 방금 본 것 중에
  "\uBC29\uAE08\uBCF8\uAC83 \uC911\uC5D0", // 방금본것 중에
  "\uBC29\uAE08 \uBCF8\uAC83 \uC911\uC5D0", // 방금 본것 중에
  "\uC5B4\uB5A4 \uAC8C", // 어떤 게
  "\uBB50 \uD558\uBA74", // 뭐 하면
  "\uB2E4\uC74C", // 다음
];

const DETAIL_CUES = [
  "detail",
  "show detail",
  "page body",
  "body",
  "\uC0C1\uC138", // 상세
  "\uC0C1\uC138\uD788", // 상세히
  "\uC790\uC138\uD788", // 자세히
  "\uBCF8\uBB38", // 본문
  "\uB0B4\uC6A9 \uBCF4\uC5EC", // 내용 보여
];

const CREATE_CUES = [
  "create",
  "add",
  "register",
  "\uCD94\uAC00", // 추가
  "\uB9CC\uB4E4", // 만들
  "\uB4F1\uB85D", // 등록
];

const UPDATE_CUES = [
  "update",
  "modify",
  "change",
  "\uC218\uC815", // 수정
  "\uBCC0\uACBD", // 변경
  "\uC5C5\uB370\uC774\uD2B8", // 업데이트
];

const DONE_UPDATE_CUES = [
  "mark done",
  "done",
  "\uC644\uB8CC \uCC98\uB9AC", // 완료 처리
  "\uC644\uB8CC\uB85C", // 완료로
  "\uC0C1\uD0DC \uBCC0\uACBD", // 상태 변경
];

const APPROVAL_BYPASS_CUES = [
  "without approval",
  "skip approval",
  "force update",
  "\uC2B9\uC778 \uC5C6\uC774", // 승인 없이
  "\uBC14\uB85C \uBC18\uC601", // 바로 반영
  "\uBC14\uB85C \uC218\uC815", // 바로 수정
  "\uC9C0\uAE08 \uBC14\uB85C", // 지금 바로
];

export class MockPersonalTaskIntentParser implements PersonalTaskIntentParser {
  parseUserInput(input: PersonalTaskIntentParserInput): PersonalTaskIntentParseResult {
    const text = input.userText.trim();
    const normalized = text.toLowerCase();
    const writeAction = this.detectWriteActionType(normalized);
    const detailLike = this.isDetailRequestText(normalized);

    if (this.detectApprovalBypassAttempt(normalized)) {
      return {
        mode: "blocked",
        confidence: "confirmed",
        reasoningSummary:
          "Write execution without approval is blocked by current Personal Task policy.",
        usedConversationState: false,
        canAnswerWithoutAction: false,
      };
    }

    if (writeAction) {
      return {
        mode: "action_required",
        actionIntent: {
          action: writeAction,
          slots: this.buildWriteSlots(input, normalized),
          confidence: "likely",
          rawUserText: text,
          reasoningNote: "Detected write-like request from natural language.",
          requiresApproval: true,
          canExecuteImmediately: false,
        },
        confidence: "likely",
        reasoningSummary: "Write intent detected; route to policy gate for approval workflow.",
        usedConversationState: false,
        canAnswerWithoutAction: false,
      };
    }

    if (detailLike || input.fallbackIntent === "get_task_detail") {
      const resolvedPageId = this.resolvePageIdForDetail(input);
      if (resolvedPageId) {
        return {
          mode: "action_required",
          actionIntent: {
            action: "get_task_detail",
            slots: { pageId: resolvedPageId },
            confidence: "likely",
            rawUserText: text,
            reasoningNote: "Detail request requires one page body fetch.",
            requiresApproval: false,
            canExecuteImmediately: true,
          },
          confidence: "likely",
          reasoningSummary: "Detail request identified; action call is required.",
          usedConversationState: resolvedPageId !== input.notionPageId,
          canAnswerWithoutAction: false,
        };
      }

      return {
        mode: "needs_clarification",
        confidence: "needs_review",
        reasoningSummary: "Detail intent detected but target task is missing.",
        clarificationQuestion:
          "어떤 업무를 상세로 볼까요? pageId를 지정하거나 먼저 목록을 조회해줘.",
        usedConversationState: this.getRecentTasks(input.conversationState).length > 0,
        canAnswerWithoutAction: false,
      };
    }

    if (this.shouldUseConversationState(input)) {
      return {
        mode: "reasoning_only",
        confidence: "likely",
        reasoningSummary:
          "This looks like a contextual follow-up. Answer from recent task context without a new action.",
        usedConversationState: true,
        canAnswerWithoutAction: true,
      };
    }

    if (this.shouldUseAction(input)) {
      return {
        mode: "action_required",
        actionIntent: this.buildListActionIntent(input),
        confidence: "likely",
        reasoningSummary: "Task lookup intent detected. Use read action path.",
        usedConversationState: false,
        canAnswerWithoutAction: false,
      };
    }

    if (this.getRecentTasks(input.conversationState).length > 0) {
      return {
        mode: "reasoning_only",
        confidence: "tentative",
        reasoningSummary:
          "No explicit action request found. Continue as conversational follow-up from recent context.",
        usedConversationState: true,
        canAnswerWithoutAction: true,
      };
    }

    return {
      mode: "needs_clarification",
      confidence: "needs_review",
      reasoningSummary: "Input intent is ambiguous and no recent context is available.",
      clarificationQuestion: "업무 목록 조회인지, 특정 업무 상세 조회인지 알려줘.",
      usedConversationState: false,
      canAnswerWithoutAction: false,
    };
  }

  shouldUseAction(input: PersonalTaskIntentParserInput): boolean {
    const normalized = input.userText.toLowerCase();
    if (this.detectWriteActionType(normalized)) {
      return true;
    }
    if (this.isDetailRequestText(normalized)) {
      return true;
    }

    return (
      this.containsAny(normalized, TASK_NOUN_CUES) ||
      this.containsAny(normalized, LIST_ACTION_CUES)
    );
  }

  shouldUseConversationState(input: PersonalTaskIntentParserInput): boolean {
    const normalized = input.userText.toLowerCase();
    if (this.getRecentTasks(input.conversationState).length === 0) {
      return false;
    }

    return this.containsAny(normalized, FOLLOW_UP_REASONING_CUES);
  }

  private buildListActionIntent(
    input: PersonalTaskIntentParserInput
  ): PersonalTaskActionIntent {
    const normalized = input.userText.toLowerCase();
    const slots: PersonalTaskActionSlots = {};

    if (this.containsAny(normalized, ["in progress", "\uC9C4\uD589 \uC911"])) {
      slots.status = "in progress";
    } else if (
      this.containsAny(normalized, [
        "not started",
        "\uBBF8\uC2DC\uC791",
        "\uC2DC\uC791 \uC804",
      ])
    ) {
      slots.status = "not started";
    } else if (this.containsAny(normalized, ["done", "\uC644\uB8CC"])) {
      slots.status = "done";
    }

    return {
      action: "list_tasks",
      slots,
      confidence: "likely",
      rawUserText: input.userText,
      reasoningNote: "General task list lookup.",
      requiresApproval: false,
      canExecuteImmediately: true,
    };
  }

  private detectWriteActionType(
    normalizedText: string
  ): "create_task" | "update_task" | null {
    if (!this.containsAny(normalizedText, TASK_NOUN_CUES)) {
      return null;
    }
    if (this.containsAny(normalizedText, CREATE_CUES)) {
      return "create_task";
    }
    if (this.containsAny(normalizedText, UPDATE_CUES)) {
      return "update_task";
    }
    if (this.containsAny(normalizedText, DONE_UPDATE_CUES)) {
      return "update_task";
    }
    return null;
  }

  private detectApprovalBypassAttempt(normalizedText: string): boolean {
    return this.containsAny(normalizedText, APPROVAL_BYPASS_CUES);
  }

  private isDetailRequestText(normalizedText: string): boolean {
    return this.containsAny(normalizedText, DETAIL_CUES);
  }

  private resolvePageIdForDetail(
    input: PersonalTaskIntentParserInput
  ): string | undefined {
    if (input.notionPageId) {
      return input.notionPageId;
    }
    if (input.conversationState.lastReferencedNotionPageIds.length === 1) {
      return input.conversationState.lastReferencedNotionPageIds[0];
    }
    return undefined;
  }

  private buildWriteSlots(
    input: PersonalTaskIntentParserInput,
    normalizedText: string
  ): PersonalTaskActionSlots {
    const slots: PersonalTaskActionSlots = {};
    if (input.notionPageId) {
      slots.pageId = input.notionPageId;
    }
    if (this.containsAny(normalizedText, ["done", "\uC644\uB8CC"])) {
      slots.status = "done";
    } else if (this.containsAny(normalizedText, ["in progress", "\uC9C4\uD589"])) {
      slots.status = "in progress";
    } else if (
      this.containsAny(normalizedText, ["not started", "\uBBF8\uC2DC\uC791"])
    ) {
      slots.status = "not started";
    }
    return slots;
  }

  private containsAny(text: string, keywords: string[]): boolean {
    return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
  }

  private getRecentTasks(state: ConversationState): NotionTaskRecord[] {
    return state.lastTaskListSnapshot ?? [];
  }
}
