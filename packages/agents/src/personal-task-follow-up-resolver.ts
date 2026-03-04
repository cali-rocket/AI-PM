/**
 * Responsibility: rule-based follow-up reference resolution for Personal Task Assistant.
 *
 * This module resolves frequent deictic expressions (for example, "that task",
 * "among these", "from here") from in-session conversation state.
 */

import type { ConversationState } from "./personal-task-conversation-state";

export type FollowUpReferenceType =
  | "last_task"
  | "task_list_subset"
  | "last_result"
  | "ambiguous"
  | "none";

export type FollowUpCue =
  | "single_task_deictic"
  | "subset_deictic"
  | "last_result_deictic"
  | "detail_request";

export interface ReferenceResolutionContext {
  userText: string;
  conversationState: ConversationState;
}

export interface FollowUpResolutionResult {
  referenceType: FollowUpReferenceType;
  resolvedTaskIds: string[];
  resolvedNotionPageIds: string[];
  canResolveFromConversationState: boolean;
  requiresClarification: boolean;
  clarificationQuestion?: string;
  reasoningSummary: string;
}

export interface PersonalTaskFollowUpResolver {
  resolve(context: ReferenceResolutionContext): FollowUpResolutionResult;
  detectCues(userText: string): FollowUpCue[];
}

const SINGLE_TASK_CUES = [
  "that task",
  "this task",
  "that one",
  "\uADF8 \uC5C5\uBB34", // 그 업무
  "\uADF8\uC5C5\uBB34", // 그업무
  "\uADF8\uAC70", // 그거
  "\uC774 \uC5C5\uBB34", // 이 업무
  "\uC774\uC5C5\uBB34", // 이업무
];

const SUBSET_CUES = [
  "from those",
  "among these",
  "from the list",
  "\uC5EC\uAE30\uC11C", // 여기서
  "\uC774 \uC911\uC5D0\uC11C", // 이 중에서
  "\uC774\uC911\uC5D0\uC11C", // 이중에서
  "\uBC29\uAE08 \uBCF8 \uAC83 \uC911\uC5D0", // 방금 본 것 중에
  "\uBC29\uAE08\uBCF8\uAC83 \uC911\uC5D0", // 방금본것 중에
  "\uBC29\uAE08 \uBCF8\uAC83 \uC911\uC5D0", // 방금 본것 중에
];

const LAST_RESULT_CUES = [
  "last result",
  "previous result",
  "from the previous result",
  "\uC9C1\uC804 \uACB0\uACFC", // 직전 결과
  "\uBC29\uAE08 \uBCF8 \uAC83", // 방금 본 것
];

const DETAIL_CUES = [
  "detail",
  "show detail",
  "page body",
  "\uC0C1\uC138", // 상세
  "\uC790\uC138\uD788", // 자세히
  "\uBCF8\uBB38", // 본문
];

export class RuleBasedPersonalTaskFollowUpResolver
  implements PersonalTaskFollowUpResolver
{
  resolve(context: ReferenceResolutionContext): FollowUpResolutionResult {
    const normalized = context.userText.trim().toLowerCase();
    const cues = this.detectCues(normalized);
    const state = context.conversationState;
    const recentList = state.lastTaskListSnapshot ?? [];
    const pageIds = state.lastReferencedNotionPageIds;
    const taskIds = state.lastReferencedTaskIds;
    const hasContext =
      recentList.length > 0 || pageIds.length > 0 || Boolean(state.lastAgentSummary);

    if (cues.length === 0) {
      return {
        referenceType: "none",
        resolvedTaskIds: [],
        resolvedNotionPageIds: [],
        canResolveFromConversationState: false,
        requiresClarification: false,
        reasoningSummary: "No strong follow-up cue detected. Use default intent parsing.",
      };
    }

    if (!hasContext) {
      return {
        referenceType: "none",
        resolvedTaskIds: [],
        resolvedNotionPageIds: [],
        canResolveFromConversationState: false,
        requiresClarification: false,
        reasoningSummary:
          "Follow-up cue detected, but no usable conversation context is available yet.",
      };
    }

    if (this.hasCue(cues, "subset_deictic")) {
      if (recentList.length > 0) {
        const listPageIds = recentList.map((task) => task.notionPageId);
        return {
          referenceType: "task_list_subset",
          resolvedTaskIds: listPageIds,
          resolvedNotionPageIds: listPageIds,
          canResolveFromConversationState: true,
          requiresClarification: false,
          reasoningSummary:
            "Resolved follow-up as subset of the latest task list snapshot.",
        };
      }

      if (pageIds.length === 1) {
        return {
          referenceType: "last_task",
          resolvedTaskIds: [pageIds[0]],
          resolvedNotionPageIds: [pageIds[0]],
          canResolveFromConversationState: true,
          requiresClarification: false,
          reasoningSummary:
            "Subset-like cue detected, but only one recent task exists. Using last task.",
        };
      }

      if (pageIds.length > 1) {
        return {
          referenceType: "ambiguous",
          resolvedTaskIds: taskIds,
          resolvedNotionPageIds: pageIds,
          canResolveFromConversationState: false,
          requiresClarification: true,
          clarificationQuestion:
            "최근 목록의 어떤 업무를 뜻하는지 제목 또는 page id 하나를 알려줘.",
          reasoningSummary:
            "Follow-up references a subset, but the target cannot be uniquely resolved.",
        };
      }
    }

    if (this.hasCue(cues, "single_task_deictic")) {
      if (pageIds.length === 1) {
        return {
          referenceType: "last_task",
          resolvedTaskIds: [pageIds[0]],
          resolvedNotionPageIds: [pageIds[0]],
          canResolveFromConversationState: true,
          requiresClarification: false,
          reasoningSummary:
            "Resolved single-task follow-up from the latest referenced task.",
        };
      }

      if (pageIds.length > 1) {
        return {
          referenceType: "ambiguous",
          resolvedTaskIds: taskIds,
          resolvedNotionPageIds: pageIds,
          canResolveFromConversationState: false,
          requiresClarification: true,
          clarificationQuestion:
            "최근에 참조된 업무가 여러 개야. 어떤 업무인지 지정해줘.",
          reasoningSummary:
            "Single-task cue detected, but multiple recent tasks are still in context.",
        };
      }
    }

    if (this.hasCue(cues, "last_result_deictic")) {
      const resultPageIds =
        pageIds.length > 0 ? pageIds : recentList.map((task) => task.notionPageId);
      if (resultPageIds.length > 0 || Boolean(state.lastAgentSummary)) {
        return {
          referenceType: "last_result",
          resolvedTaskIds: resultPageIds,
          resolvedNotionPageIds: resultPageIds,
          canResolveFromConversationState: true,
          requiresClarification: false,
          reasoningSummary: "Resolved follow-up as a reference to the last assistant result.",
        };
      }
    }

    if (this.hasCue(cues, "detail_request") && pageIds.length > 1) {
      return {
        referenceType: "ambiguous",
        resolvedTaskIds: taskIds,
        resolvedNotionPageIds: pageIds,
        canResolveFromConversationState: false,
        requiresClarification: true,
        clarificationQuestion:
          "상세를 보여줄 대상을 하나로 정해줘. 제목 또는 page id를 알려줘.",
        reasoningSummary:
          "Detail cue detected, but there are multiple candidate tasks in recent context.",
      };
    }

    if (pageIds.length === 1) {
      return {
        referenceType: "last_task",
        resolvedTaskIds: [pageIds[0]],
        resolvedNotionPageIds: [pageIds[0]],
        canResolveFromConversationState: true,
        requiresClarification: false,
        reasoningSummary:
          "Fallback follow-up resolution selected the last referenced task.",
      };
    }

    return {
      referenceType: "none",
      resolvedTaskIds: [],
      resolvedNotionPageIds: [],
      canResolveFromConversationState: false,
      requiresClarification: false,
      reasoningSummary:
        "Follow-up cue was detected but no stable reference mapping rule matched.",
    };
  }

  detectCues(userText: string): FollowUpCue[] {
    const cues = new Set<FollowUpCue>();
    const normalized = userText.toLowerCase();

    if (this.containsAny(normalized, SINGLE_TASK_CUES)) {
      cues.add("single_task_deictic");
    }

    if (this.containsAny(normalized, SUBSET_CUES)) {
      cues.add("subset_deictic");
    }

    if (this.containsAny(normalized, LAST_RESULT_CUES)) {
      cues.add("last_result_deictic");
    }

    if (this.containsAny(normalized, DETAIL_CUES)) {
      cues.add("detail_request");
    }

    return Array.from(cues);
  }

  private hasCue(cues: FollowUpCue[], target: FollowUpCue): boolean {
    return cues.includes(target);
  }

  private containsAny(text: string, keywords: string[]): boolean {
    return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
  }
}
