/**
 * Responsibility: read-first tool connector contracts for external systems.
 * This layer normalizes external data access without write operations.
 * Personal tasks are sourced from Notion (source-of-truth), not shared memory.
 */

import type {
  AgentType,
  NotionTaskStatus as CoreNotionTaskStatus,
  SourceRef,
} from "../../core-types/src";

export type ToolName = "slack" | "asana" | "google_calendar" | "notion" | "web_search";

export interface ToolReadQuery {
  requestId: string;
  fromAgent: AgentType;
  query: string;
  filters?: Record<string, unknown>;
}

export interface ToolReadResult {
  items: Array<Record<string, unknown>>;
  sourceRefs: SourceRef[];
  fetchedAt: string;
}

export interface ToolHealth {
  healthy: boolean;
  checkedAt: string;
  message?: string;
}

export interface ToolConnector {
  readonly tool: ToolName;
  readonly mode: "read_only";
  read(query: ToolReadQuery): Promise<ToolReadResult>;
  healthCheck(): Promise<ToolHealth>;
}

export interface ToolConnectorRegistry {
  get(tool: ToolName): ToolConnector;
  list(): ToolConnector[];
}

/**
 * Notion personal task status from source-of-truth schema.
 */
export type NotionTaskStatus = CoreNotionTaskStatus;

/**
 * Configuration for a Personal Tasks dedicated Notion reader.
 * This value must point to a single allowed Personal Tasks database.
 */
export interface PersonalTasksReaderConfig {
  personalTasksDatabaseId: string;
}

/**
 * One Notion DB row treated as one Notion page for a personal task.
 * Only the agreed MVP properties are represented.
 */
export interface NotionTaskRecord {
  notionDatabaseId: string;
  notionPageId: string;
  title: string;
  status: NotionTaskStatus;
  createdAt: string;
  dueDate: string | null;
  lastEditedAt: string;
}

/**
 * Page body payload for a personal task page.
 */
export interface NotionTaskPageBody {
  notionPageId: string;
  body: string;
  lastEditedAt: string;
}

/**
 * Read query for listing task rows from the configured Personal Tasks DB only.
 */
export interface NotionTaskQuery {
  statuses?: NotionTaskStatus[];
  includeDone?: boolean;
  dueOnOrBefore?: string;
  dueOnOrAfter?: string;
  limit?: number;
}
