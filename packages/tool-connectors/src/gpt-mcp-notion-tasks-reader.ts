/**
 * Responsibility: Personal Tasks dedicated reader backed by GPT + Notion MCP tools.
 *
 * Guardrails:
 * - Personal Tasks only (single configured databaseId).
 * - Read-only.
 * - List calls return DB properties only.
 * - Detail body is fetched only on explicit detail method.
 */

import type { NotionTasksReader } from "./notion-tasks-reader";
import type {
  NotionTaskPageBody,
  NotionTaskQuery,
  NotionTaskRecord,
  NotionTaskStatus,
  PersonalTasksReaderConfig,
} from "./types";
import type { PersonalTasksLlmMcpClient } from "./openai-mcp-personal-tasks-client";
import { OpenAiMcpPersonalTasksClient } from "./openai-mcp-personal-tasks-client";

export interface GptMcpNotionTasksReaderOptions {
  llmMcpClient?: PersonalTasksLlmMcpClient;
}

export class GptMcpNotionTasksReader implements NotionTasksReader {
  readonly personalTasksDatabaseId: string;

  private readonly llmMcpClient: PersonalTasksLlmMcpClient;

  constructor(
    config: PersonalTasksReaderConfig,
    options: GptMcpNotionTasksReaderOptions
  ) {
    const databaseId = config.personalTasksDatabaseId?.trim();
    if (!databaseId) {
      throw new Error("personalTasksDatabaseId is required for GptMcpNotionTasksReader.");
    }

    this.personalTasksDatabaseId = databaseId;
    this.llmMcpClient =
      options.llmMcpClient ??
      new OpenAiMcpPersonalTasksClient({
        apiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
        model: process.env.OPENAI_MODEL?.trim() ?? "",
        baseUrl: process.env.OPENAI_BASE_URL?.trim(),
        notionMcpServerUrl: process.env.NOTION_MCP_URL?.trim() ?? "https://mcp.notion.com/mcp",
        notionMcpAccessToken: process.env.NOTION_MCP_ACCESS_TOKEN?.trim(),
      });
  }

  async listTasks(query: NotionTaskQuery): Promise<NotionTaskRecord[]> {
    const rows = await this.llmMcpClient.listTasks({
      personalTasksDatabaseId: this.personalTasksDatabaseId,
      statuses: query.statuses,
      includeDone: query.includeDone,
      dueOnOrAfter: query.dueOnOrAfter,
      dueOnOrBefore: query.dueOnOrBefore,
      limit: query.limit,
    });

    let mapped = rows
      .map((row) => this.mapTaskRow(row))
      .filter((row): row is NotionTaskRecord => row !== null)
      .filter((row) => row.notionDatabaseId === this.personalTasksDatabaseId);

    // Defensive local filter pass in case model/tool output ignores filters.
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
    const row = await this.llmMcpClient.getTaskByPageId({
      personalTasksDatabaseId: this.personalTasksDatabaseId,
      notionPageId,
    });
    if (!row) {
      return null;
    }

    const mapped = this.mapTaskRow(row);
    if (!mapped) {
      return null;
    }
    if (normalizeNotionId(mapped.notionDatabaseId) !== normalizeNotionId(this.personalTasksDatabaseId)) {
      return null;
    }

    return mapped;
  }

  async getTaskPageBody(notionPageId: string): Promise<NotionTaskPageBody | null> {
    const row = await this.getTaskByPageId(notionPageId);
    if (!row) {
      return null;
    }

    const pageBody = await this.llmMcpClient.getTaskPageBody({
      personalTasksDatabaseId: this.personalTasksDatabaseId,
      notionPageId,
    });
    if (!pageBody) {
      return null;
    }
    if (
      normalizeNotionId(pageBody.notionDatabaseId) !==
      normalizeNotionId(this.personalTasksDatabaseId)
    ) {
      return null;
    }
    if (normalizeNotionId(pageBody.notionPageId) !== normalizeNotionId(row.notionPageId)) {
      return null;
    }

    return {
      notionPageId: row.notionPageId,
      body: pageBody.body,
      lastEditedAt: normalizeIsoLike(pageBody.lastEditedAt) ?? row.lastEditedAt,
    };
  }

  private mapTaskRow(value: {
    notionDatabaseId: string;
    notionPageId: string;
    title: string;
    status: NotionTaskStatus;
    createdAt: string;
    dueDate: string | null;
    lastEditedAt: string;
  }): NotionTaskRecord | null {
    const notionDatabaseId = value.notionDatabaseId?.trim();
    const notionPageId = value.notionPageId?.trim();
    const title = value.title?.trim() ?? "";
    const status = normalizeStatus(value.status);
    const createdAt = normalizeIsoLike(value.createdAt);
    const lastEditedAt = normalizeIsoLike(value.lastEditedAt);
    const dueDate = normalizeDateOrNull(value.dueDate);

    if (!notionDatabaseId || !notionPageId || !status || !createdAt || !lastEditedAt) {
      return null;
    }

    return {
      notionDatabaseId,
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

function normalizeNotionId(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}
