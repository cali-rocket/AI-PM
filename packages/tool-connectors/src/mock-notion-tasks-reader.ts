/**
 * Responsibility: in-memory mock Personal Tasks Notion reader for local development.
 * This implementation is read-only and scoped to one configured Personal Tasks database.
 */

import type { NotionTasksReader } from "./notion-tasks-reader";
import type {
  NotionTaskStatus,
  NotionTaskPageBody,
  NotionTaskQuery,
  NotionTaskRecord,
  PersonalTasksReaderConfig,
} from "./types";

const SAMPLE_NOTION_DATABASE_ID = "notion-db-personal-tasks";

const SAMPLE_TASKS: NotionTaskRecord[] = [
  {
    notionDatabaseId: SAMPLE_NOTION_DATABASE_ID,
    notionPageId: "page-task-001",
    title: "Prepare onboarding revamp meeting",
    status: "in progress",
    createdAt: "2026-03-01T09:00:00.000Z",
    dueDate: "2026-03-03T09:00:00.000Z",
    lastEditedAt: "2026-03-02T01:15:00.000Z",
  },
  {
    notionDatabaseId: SAMPLE_NOTION_DATABASE_ID,
    notionPageId: "page-task-002",
    title: "Review weekly ops risk summary",
    status: "not started",
    createdAt: "2026-03-01T12:30:00.000Z",
    dueDate: null,
    lastEditedAt: "2026-03-01T12:30:00.000Z",
  },
  {
    notionDatabaseId: SAMPLE_NOTION_DATABASE_ID,
    notionPageId: "page-task-003",
    title: "Organize sprint retrospective notes",
    status: "done",
    createdAt: "2026-02-27T03:20:00.000Z",
    dueDate: "2026-03-01T10:00:00.000Z",
    lastEditedAt: "2026-03-01T11:40:00.000Z",
  },
];

const SAMPLE_PAGE_BODIES: NotionTaskPageBody[] = [
  {
    notionPageId: "page-task-001",
    body: "Prepare three sections: KPI impact, key risks, and next actions.",
    lastEditedAt: "2026-03-02T01:15:00.000Z",
  },
  {
    notionPageId: "page-task-002",
    body: "Check two Asana blockers and reflect them in the briefing.",
    lastEditedAt: "2026-03-01T12:30:00.000Z",
  },
  {
    notionPageId: "page-task-003",
    body: "Finalize two process improvements from retrospective discussion.",
    lastEditedAt: "2026-03-01T11:40:00.000Z",
  },
];

export class MockNotionTasksReader implements NotionTasksReader {
  readonly personalTasksDatabaseId: string;
  private readonly tasks: NotionTaskRecord[];

  constructor(config?: PersonalTasksReaderConfig) {
    this.personalTasksDatabaseId =
      config?.personalTasksDatabaseId ?? SAMPLE_NOTION_DATABASE_ID;
    this.tasks = SAMPLE_TASKS.map((task) => ({
      ...task,
      notionDatabaseId: this.personalTasksDatabaseId,
    }));
  }

  async listTasks(query: NotionTaskQuery): Promise<NotionTaskRecord[]> {
    // Personal Tasks dedicated path: never reads outside configured database id.
    let rows = this.tasks.filter(
      (task) => task.notionDatabaseId === this.personalTasksDatabaseId
    );

    if (query.statuses && query.statuses.length > 0) {
      rows = rows.filter((task) => query.statuses?.includes(task.status));
    }

    if (query.includeDone === false) {
      rows = rows.filter((task) => task.status !== "done");
    }

    if (query.dueOnOrAfter) {
      const lower = new Date(query.dueOnOrAfter).getTime();
      rows = rows.filter((task) => {
        if (!task.dueDate) {
          return false;
        }
        return new Date(task.dueDate).getTime() >= lower;
      });
    }

    if (query.dueOnOrBefore) {
      const upper = new Date(query.dueOnOrBefore).getTime();
      rows = rows.filter((task) => {
        if (!task.dueDate) {
          return false;
        }
        return new Date(task.dueDate).getTime() <= upper;
      });
    }

    if (query.limit && query.limit > 0) {
      rows = rows.slice(0, query.limit);
    }

    // TODO: Add deterministic sort and cursor pagination if list size grows.
    return rows;
  }

  async listTasksByStatus(
    status: NotionTaskStatus,
    query?: Omit<NotionTaskQuery, "statuses">
  ): Promise<NotionTaskRecord[]> {
    return this.listTasks({
      ...query,
      statuses: [status],
    });
  }

  async getTaskByPageId(notionPageId: string): Promise<NotionTaskRecord | null> {
    const task = this.tasks.find((entry) => entry.notionPageId === notionPageId);
    if (!task || task.notionDatabaseId !== this.personalTasksDatabaseId) {
      return null;
    }
    return task;
  }

  async getTaskPageBody(notionPageId: string): Promise<NotionTaskPageBody | null> {
    const task = await this.getTaskByPageId(notionPageId);
    if (!task) {
      return null;
    }
    return SAMPLE_PAGE_BODIES.find((entry) => entry.notionPageId === notionPageId) ?? null;
  }
}
