/**
 * Responsibility: read-only Personal Tasks Notion reader contract for Personal Assistant Agent.
 * This reader is intentionally scoped to one configured Personal Tasks database only.
 * Notion is treated as source-of-truth for personal tasks.
 */

import type {
  NotionTaskPageBody,
  NotionTaskQuery,
  NotionTaskRecord,
  NotionTaskStatus,
} from "./types";

export interface NotionTasksReader {
  /**
   * Fixed allowed database id for Personal Tasks reads.
   */
  readonly personalTasksDatabaseId: string;
  listTasks(query: NotionTaskQuery): Promise<NotionTaskRecord[]>;
  listTasksByStatus(
    status: NotionTaskStatus,
    query?: Omit<NotionTaskQuery, "statuses">
  ): Promise<NotionTaskRecord[]>;
  getTaskByPageId(notionPageId: string): Promise<NotionTaskRecord | null>;
  getTaskPageBody(notionPageId: string): Promise<NotionTaskPageBody | null>;
}
