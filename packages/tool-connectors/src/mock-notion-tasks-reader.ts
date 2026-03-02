/**
 * Responsibility: in-memory mock Notion personal task reader for local development.
 * Source-of-truth semantics are preserved as read-only contracts.
 */

import type { NotionTasksReader } from "./notion-tasks-reader";
import type { NotionTaskPageBody, NotionTaskQuery, NotionTaskRecord } from "./types";

const SAMPLE_NOTION_DATABASE_ID = "notion-db-personal-tasks";

const SAMPLE_TASKS: NotionTaskRecord[] = [
  {
    notionDatabaseId: SAMPLE_NOTION_DATABASE_ID,
    notionPageId: "page-task-001",
    title: "온보딩 개편 회의 준비",
    status: "in progress",
    createdAt: "2026-03-01T09:00:00.000Z",
    dueDate: "2026-03-03T09:00:00.000Z",
    lastEditedAt: "2026-03-02T01:15:00.000Z",
  },
  {
    notionDatabaseId: SAMPLE_NOTION_DATABASE_ID,
    notionPageId: "page-task-002",
    title: "주간 운영 리스크 요약 확인",
    status: "not started",
    createdAt: "2026-03-01T12:30:00.000Z",
    dueDate: null,
    lastEditedAt: "2026-03-01T12:30:00.000Z",
  },
  {
    notionDatabaseId: SAMPLE_NOTION_DATABASE_ID,
    notionPageId: "page-task-003",
    title: "지난 스프린트 회고 메모 정리",
    status: "done",
    createdAt: "2026-02-27T03:20:00.000Z",
    dueDate: "2026-03-01T10:00:00.000Z",
    lastEditedAt: "2026-03-01T11:40:00.000Z",
  },
];

const SAMPLE_PAGE_BODIES: NotionTaskPageBody[] = [
  {
    notionPageId: "page-task-001",
    body: "회의 아젠다 3개 정리: KPI 영향, 리스크, 다음 액션.",
    lastEditedAt: "2026-03-02T01:15:00.000Z",
  },
  {
    notionPageId: "page-task-002",
    body: "Asana blocker 2건 근거 확인 후 오전 브리핑에 반영.",
    lastEditedAt: "2026-03-01T12:30:00.000Z",
  },
  {
    notionPageId: "page-task-003",
    body: "회고에서 나온 개선안 2개를 문장으로 확정.",
    lastEditedAt: "2026-03-01T11:40:00.000Z",
  },
];

export class MockNotionTasksReader implements NotionTasksReader {
  async listTasks(query: NotionTaskQuery): Promise<NotionTaskRecord[]> {
    let rows = SAMPLE_TASKS.filter((task) => task.notionDatabaseId === query.notionDatabaseId);

    if (query.statuses && query.statuses.length > 0) {
      const statuses = query.statuses;
      rows = rows.filter((task) => statuses.includes(task.status));
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

  async getTaskByPageId(notionPageId: string): Promise<NotionTaskRecord | null> {
    return SAMPLE_TASKS.find((task) => task.notionPageId === notionPageId) ?? null;
  }

  async getTaskPageBody(notionPageId: string): Promise<NotionTaskPageBody | null> {
    return SAMPLE_PAGE_BODIES.find((entry) => entry.notionPageId === notionPageId) ?? null;
  }
}
