/**
 * Responsibility: minimal Personal Assistant runtime stub (read-first).
 * Notion Personal Tasks DB is the source-of-truth; shared memory refs are optional cache hints.
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
  listTasksByStatus(status: TaskStatusFilter, context: AgentRuntimeContext): Promise<PersonalAssistantQueryResult>;
  listTasksDueSoon(context: AgentRuntimeContext, daysAhead?: number): Promise<PersonalAssistantQueryResult>;
  getTaskDetail(notionPageId: string, context: AgentRuntimeContext): Promise<PersonalAssistantQueryResult>;
  buildDailyTaskSummary(context: AgentRuntimeContext): Promise<AgentExecutionResult>;
}

export class MockPersonalAssistantAgent implements PersonalAssistantAgent {
  async handleRequest(
    input: AgentExecutionInput,
    context: AgentRuntimeContext
  ): Promise<AgentExecutionResult> {
    if (!this.hasValidPersonalTasksScope(context)) {
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
        intent: input.intent,
      };
    }

    switch (input.intent) {
      case "list_in_progress": {
        const result = await this.listTasksByStatus("in progress", context);
        return this.buildListResult("In-progress personal tasks (properties only)", input.intent, result);
      }
      case "list_not_started": {
        const result = await this.listTasksByStatus("not started", context);
        return this.buildListResult("Not-started personal tasks (properties only)", input.intent, result);
      }
      case "list_with_due_date": {
        const result = await this.listTasksDueSoon(context, input.daysAhead);
        return this.buildListResult("Personal tasks with due date (properties only)", input.intent, result);
      }
      case "get_task_detail": {
        if (!input.notionPageId) {
          return {
            speaker: "personal_assistant",
            summary: "Task detail request requires notionPageId.",
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

        const result = await this.getTaskDetail(input.notionPageId, context);
        const title = result.tasks[0]?.title ?? input.notionPageId;
        const bodyPreview = this.previewBody(result.taskBody?.body);
        const summary = bodyPreview
          ? `Task detail loaded: ${title}. Body preview: ${bodyPreview}`
          : `Task detail loaded: ${title}. Page body is empty or unavailable.`;
        const usedSources = this.buildUsedSources(result);
        return {
          speaker: "personal_assistant",
          summary,
          usedSources,
          confidence: this.resolveDetailConfidence(result, usedSources),
          referencedNotionPageIds: this.collectPageIds(result.tasks),
          queryResult: result,
          intent: input.intent,
        };
      }
      case "build_daily_summary":
      default:
        return this.buildDailyTaskSummary(context);
    }
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
      uniqueRefs.length > 0 && mergedTasks.length === 0
        ? `Daily personal task summary (properties only): Notion rows were empty and ${uniqueRefs.length} cache refs were used.`
        : `Daily personal task summary (properties only): in-progress ${inProgress.tasks.length}, not-started ${notStarted.tasks.length}, with due date ${dueTasks.tasks.length}.`;

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

  private hasValidPersonalTasksScope(context: AgentRuntimeContext): boolean {
    return context.notionTasksReader.personalTasksDatabaseId === context.personalTasksDatabaseId;
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
      return `${title}: Notion rows were empty and ${refCount} cache refs were available.`;
    }
    return `${title}: no results.`;
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
