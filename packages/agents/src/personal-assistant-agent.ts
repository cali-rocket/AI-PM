/**
 * Responsibility: minimal Personal Assistant runtime stub (read-first).
 * Notion is the personal-task source-of-truth; shared memory refs are optional cache hints.
 */

import type { NotionTaskRecord } from "../../tool-connectors/src";
import type {
  AgentExecutionInput,
  AgentExecutionResult,
  AgentRuntimeContext,
  PersonalAssistantQueryResult,
  TaskStatusFilter,
} from "./types";

export interface PersonalAssistantAgent {
  handleRequest(input: AgentExecutionInput, context: AgentRuntimeContext): Promise<AgentExecutionResult>;
  listTasksByStatus(
    notionDatabaseId: string,
    status: TaskStatusFilter,
    context: AgentRuntimeContext
  ): Promise<PersonalAssistantQueryResult>;
  listTasksDueSoon(
    notionDatabaseId: string,
    context: AgentRuntimeContext,
    daysAhead?: number
  ): Promise<PersonalAssistantQueryResult>;
  getTaskDetail(
    notionDatabaseId: string,
    notionPageId: string,
    context: AgentRuntimeContext
  ): Promise<PersonalAssistantQueryResult>;
  buildDailyTaskSummary(
    notionDatabaseId: string,
    context: AgentRuntimeContext
  ): Promise<AgentExecutionResult>;
}

export class MockPersonalAssistantAgent implements PersonalAssistantAgent {
  async handleRequest(
    input: AgentExecutionInput,
    context: AgentRuntimeContext
  ): Promise<AgentExecutionResult> {
    switch (input.intent) {
      case "list_in_progress": {
        const result = await this.listTasksByStatus(input.notionDatabaseId, "in progress", context);
        return this.buildListResult("진행 중인 개인 업무", input.intent, result);
      }
      case "list_not_started": {
        const result = await this.listTasksByStatus(input.notionDatabaseId, "not started", context);
        return this.buildListResult("아직 시작하지 않은 개인 업무", input.intent, result);
      }
      case "list_with_due_date": {
        const result = await this.listTasksDueSoon(
          input.notionDatabaseId,
          context,
          input.daysAhead
        );
        return this.buildListResult("마감일이 있는 개인 업무", input.intent, result);
      }
      case "get_task_detail": {
        if (!input.notionPageId) {
          return {
            speaker: "personal_assistant",
            summary: "업무 상세를 조회하려면 notionPageId가 필요합니다.",
            usedSources: [],
            confidence: "needs_review",
            referencedNotionPageIds: [],
            queryResult: {
              tasks: [],
              taskBody: null,
              personalTaskSummaryRefs: [],
            },
            intent: input.intent,
          };
        }

        const result = await this.getTaskDetail(
          input.notionDatabaseId,
          input.notionPageId,
          context
        );
        const title = result.tasks[0]?.title ?? input.notionPageId;
        const bodyPreview = this.previewBody(result.taskBody?.body);
        const detailSummary = bodyPreview
          ? `업무 상세 조회 완료: ${title} / 본문 미리보기: ${bodyPreview}`
          : `업무 상세 조회 완료: ${title} / 본문 정보가 비어 있거나 확인되지 않았습니다.`;
        const usedSources = this.buildUsedSources(result);
        return {
          speaker: "personal_assistant",
          summary: detailSummary,
          usedSources,
          confidence: this.resolveDetailConfidence(result, usedSources),
          referencedNotionPageIds: this.collectPageIds(result.tasks),
          queryResult: result,
          intent: input.intent,
        };
      }
      case "build_daily_summary":
      default:
        return this.buildDailyTaskSummary(input.notionDatabaseId, context);
    }
  }

  async listTasksByStatus(
    notionDatabaseId: string,
    status: TaskStatusFilter,
    context: AgentRuntimeContext
  ): Promise<PersonalAssistantQueryResult> {
    // Source-of-truth read path: always query Notion first.
    const tasks = await context.notionTasksReader.listTasks({
      notionDatabaseId,
      statuses: [status],
      includeDone: true,
    });

    // shared memory is only used as fallback/reference when Notion has no direct match.
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
    notionDatabaseId: string,
    context: AgentRuntimeContext,
    daysAhead?: number
  ): Promise<PersonalAssistantQueryResult> {
    // Read-first: base list from Notion, then lightweight date filtering.
    const tasks = await context.notionTasksReader.listTasks({
      notionDatabaseId,
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
    notionDatabaseId: string,
    notionPageId: string,
    context: AgentRuntimeContext
  ): Promise<PersonalAssistantQueryResult> {
    // Source-of-truth read for row metadata and page body.
    const task = await context.notionTasksReader.getTaskByPageId(notionPageId);
    const taskBody = await context.notionTasksReader.getTaskPageBody(notionPageId);
    const tasks = task && task.notionDatabaseId === notionDatabaseId ? [task] : [];
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

  async buildDailyTaskSummary(
    notionDatabaseId: string,
    context: AgentRuntimeContext
  ): Promise<AgentExecutionResult> {
    const [inProgress, notStarted, dueTasks] = await Promise.all([
      this.listTasksByStatus(notionDatabaseId, "in progress", context),
      this.listTasksByStatus(notionDatabaseId, "not started", context),
      this.listTasksDueSoon(notionDatabaseId, context),
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
      uniqueRefs.length > 0 && mergedTasks.length === 0
        ? `오늘 개인 업무 요약: Notion 직접 조회 결과는 비어 있고, 캐시 참조 ${uniqueRefs.length}건이 있습니다.`
        : `오늘 개인 업무 요약: 진행 중 ${inProgress.tasks.length}건, 미시작 ${notStarted.tasks.length}건, 마감일 있음 ${dueTasks.tasks.length}건.`;

    return {
      speaker: "personal_assistant",
      summary,
      usedSources,
      confidence: "likely",
      referencedNotionPageIds: this.collectPageIds(mergedTasks),
      queryResult: {
        tasks: mergedTasks,
        personalTaskSummaryRefs: uniqueRefs,
      },
      intent: "build_daily_summary",
    };
  }

  private buildListResult(
    title: string,
    intent: AgentExecutionInput["intent"],
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

  private buildUsedSources(result: PersonalAssistantQueryResult): Array<"notion" | "shared_memory"> {
    if (result.personalTaskSummaryRefs.length > 0) {
      return ["notion", "shared_memory"];
    }
    return ["notion"];
  }

  private resolveListConfidence(
    result: PersonalAssistantQueryResult,
    usedSources: Array<"notion" | "shared_memory">
  ): "confirmed" | "likely" {
    // Confirmed when based on direct Notion read only; likely when cache refs are mixed in.
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
      return `${title}: ${names.join(", ")}`;
    }
    if (refCount > 0) {
      return `${title}: Notion 직접 조회 항목은 없고, 캐시 참조 ${refCount}건이 있습니다.`;
    }
    return `${title}: 조회된 항목이 없습니다.`;
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
}
