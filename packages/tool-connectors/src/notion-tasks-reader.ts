/**
 * Responsibility: read-only Notion personal task input contract for Personal Assistant Agent.
 * Notion DB is treated as source-of-truth for personal tasks.
 */

import type {
  NotionTaskPageBody,
  NotionTaskQuery,
  NotionTaskRecord,
} from "./types";

export interface NotionTasksReader {
  listTasks(query: NotionTaskQuery): Promise<NotionTaskRecord[]>;
  getTaskByPageId(notionPageId: string): Promise<NotionTaskRecord | null>;
  getTaskPageBody(notionPageId: string): Promise<NotionTaskPageBody | null>;
}
