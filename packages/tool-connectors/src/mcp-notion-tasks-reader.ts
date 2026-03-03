/**
 * Responsibility: Personal Tasks dedicated Notion MCP reader (read-only).
 *
 * Guardrails:
 * - Only reads from the configured `personalTasksDatabaseId`.
 * - No write actions.
 * - No generic Notion exploration outside this dedicated scope.
 *
 * Mapping assumptions (needs runtime verification against real MCP payloads):
 * - Status is mapped from source label into: not started | in progress | done.
 * - createdAt / lastEditedAt are always present for valid rows.
 * - Page body can be reduced to one plain-text string from MCP fetch output.
 */

import type { NotionTasksReader } from "./notion-tasks-reader";
import type {
  NotionTaskPageBody,
  NotionTaskQuery,
  NotionTaskRecord,
  NotionTaskStatus,
  PersonalTasksReaderConfig,
} from "./types";
import {
  NotionMcpRuntimeBridgeClient,
  type NotionMcpClientConfig,
  type PersonalTasksDataSourceInfo,
  type PersonalTasksMcpBridgeClient,
  type PersonalTasksMcpTaskRow,
} from "./notion-mcp-bridge-client";

interface McpNotionTasksReaderOptions {
  mcpBridgeClient?: PersonalTasksMcpBridgeClient;
  mcpClientConfig?: NotionMcpClientConfig;
}

export class McpNotionTasksReader implements NotionTasksReader {
  readonly personalTasksDatabaseId: string;

  private readonly mcpBridgeClient: PersonalTasksMcpBridgeClient;
  private cachedSourceInfo?: Promise<PersonalTasksDataSourceInfo>;

  constructor(
    config: PersonalTasksReaderConfig,
    options?: McpNotionTasksReaderOptions
  ) {
    const databaseId = config.personalTasksDatabaseId?.trim();
    if (!databaseId) {
      throw new Error("personalTasksDatabaseId is required for McpNotionTasksReader.");
    }

    this.personalTasksDatabaseId = databaseId;
    this.mcpBridgeClient =
      options?.mcpBridgeClient ??
      new NotionMcpRuntimeBridgeClient(
        options?.mcpClientConfig ?? {
          serverUrl: process.env.NOTION_MCP_URL?.trim() ?? "https://mcp.notion.com/mcp",
          accessToken: process.env.NOTION_MCP_ACCESS_TOKEN?.trim() ?? "",
        }
      );
  }

  async listTasks(query: NotionTaskQuery): Promise<NotionTaskRecord[]> {
    const sourceInfo = await this.getSourceInfo();
    const rows = await this.mcpBridgeClient.queryTaskRows({
      dataSourceUrl: sourceInfo.dataSourceUrl,
      schemaColumns: sourceInfo.schemaColumns,
    });

    let mapped = rows
      .map((row) => this.mapTaskRow(row))
      .filter((row): row is NotionTaskRecord => row !== null);

    if (query.statuses && query.statuses.length > 0) {
      mapped = mapped.filter((row) => query.statuses?.includes(row.status));
    }

    if (query.includeDone === false) {
      mapped = mapped.filter((row) => row.status !== "done");
    }

    if (query.dueOnOrAfter) {
      const lower = new Date(query.dueOnOrAfter).getTime();
      mapped = mapped.filter((row) => {
        if (!row.dueDate) {
          return false;
        }
        return new Date(row.dueDate).getTime() >= lower;
      });
    }

    if (query.dueOnOrBefore) {
      const upper = new Date(query.dueOnOrBefore).getTime();
      mapped = mapped.filter((row) => {
        if (!row.dueDate) {
          return false;
        }
        return new Date(row.dueDate).getTime() <= upper;
      });
    }

    if (query.limit && query.limit > 0) {
      mapped = mapped.slice(0, query.limit);
    }

    return mapped;
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
    // Keep scope strict: page lookups are constrained to rows from Personal Tasks DB.
    const allRows = await this.listTasks({});
    const normalizedTarget = normalizeNotionId(notionPageId);
    return (
      allRows.find(
        (row) => normalizeNotionId(row.notionPageId) === normalizedTarget
      ) ?? null
    );
  }

  async getTaskPageBody(notionPageId: string): Promise<NotionTaskPageBody | null> {
    const task = await this.getTaskByPageId(notionPageId);
    if (!task) {
      return null;
    }

    const page = await this.mcpBridgeClient.fetchPageBody(task.notionPageId);
    return {
      notionPageId: task.notionPageId,
      body: page.body ?? "",
      lastEditedAt: normalizeIsoLike(page.lastEditedAt) ?? task.lastEditedAt,
    };
  }

  private async getSourceInfo(): Promise<PersonalTasksDataSourceInfo> {
    if (!this.cachedSourceInfo) {
      this.cachedSourceInfo = this.mcpBridgeClient.getDataSourceInfo(
        this.personalTasksDatabaseId
      );
    }

    const sourceInfo = await this.cachedSourceInfo;
    if (
      normalizeNotionId(sourceInfo.databaseId) !==
      normalizeNotionId(this.personalTasksDatabaseId)
    ) {
      throw new Error(
        "MCP returned a different database than configured personalTasksDatabaseId."
      );
    }
    return sourceInfo;
  }

  private mapTaskRow(row: PersonalTasksMcpTaskRow): NotionTaskRecord | null {
    const notionPageId = extractPageIdFromUrl(row.pageUrl);
    const title = row.title?.trim() ?? "";
    const status = normalizeStatus(row.status);
    const createdAt = normalizeIsoLike(row.createdAt);
    const lastEditedAt = normalizeIsoLike(row.lastEditedAt);
    const dueDate = normalizeDateOrNull(row.dueDate);

    // Defensive guard: skip rows that cannot be safely mapped into current strict contract.
    if (!notionPageId || !status || !createdAt || !lastEditedAt) {
      return null;
    }

    return {
      notionDatabaseId: this.personalTasksDatabaseId,
      notionPageId,
      title,
      status,
      createdAt,
      dueDate,
      lastEditedAt,
    };
  }
}

function normalizeStatus(rawStatus: string | null): NotionTaskStatus | null {
  if (!rawStatus) {
    return null;
  }

  const normalized = rawStatus.trim().toLowerCase();
  if (normalized === "not started") {
    return "not started";
  }
  if (normalized === "in progress") {
    return "in progress";
  }
  if (normalized === "done") {
    return "done";
  }

  // Confirm with production data if localized labels should be mapped explicitly.
  return null;
}

function normalizeIsoLike(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes("T")) {
    return trimmed;
  }
  if (trimmed.includes(" ")) {
    return trimmed.replace(" ", "T");
  }
  return trimmed;
}

function normalizeDateOrNull(value: string | null): string | null {
  const normalized = normalizeIsoLike(value);
  return normalized && normalized.length > 0 ? normalized : null;
}

function extractPageIdFromUrl(pageUrl: string): string | null {
  const withHyphen = pageUrl.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (withHyphen) {
    return withHyphen[1].toLowerCase();
  }

  const compact = pageUrl.match(/([a-f0-9]{32})/i);
  if (compact) {
    return compact[1].toLowerCase();
  }

  return null;
}

function normalizeNotionId(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}
