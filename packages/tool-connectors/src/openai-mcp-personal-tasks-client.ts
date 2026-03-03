/**
 * Responsibility: runtime client that asks GPT (Responses API) to read Personal Tasks
 * through an attached Notion MCP tool.
 *
 * Guardrails:
 * - Read-only behavior only.
 * - Always scoped to a single configured Personal Tasks databaseId.
 * - No generic Notion exploration beyond Personal Tasks task retrieval.
 */

import type { NotionTaskStatus } from "./types";

export interface OpenAiMcpPersonalTasksClientConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  notionMcpServerUrl: string;
  notionMcpServerLabel?: string;
  notionMcpAccessToken?: string;
  timeoutMs?: number;
}

export interface LlmPersonalTaskRow {
  notionDatabaseId: string;
  notionPageId: string;
  title: string;
  status: NotionTaskStatus;
  createdAt: string;
  dueDate: string | null;
  lastEditedAt: string;
}

export interface LlmPersonalTaskPageBody {
  notionDatabaseId: string;
  notionPageId: string;
  body: string;
  lastEditedAt: string;
}

export interface PersonalTasksLlmMcpClient {
  listTasks(input: {
    personalTasksDatabaseId: string;
    statuses?: NotionTaskStatus[];
    includeDone?: boolean;
    dueOnOrBefore?: string;
    dueOnOrAfter?: string;
    limit?: number;
  }): Promise<LlmPersonalTaskRow[]>;
  getTaskByPageId(input: {
    personalTasksDatabaseId: string;
    notionPageId: string;
  }): Promise<LlmPersonalTaskRow | null>;
  getTaskPageBody(input: {
    personalTasksDatabaseId: string;
    notionPageId: string;
  }): Promise<LlmPersonalTaskPageBody | null>;
}

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 45_000;

const STATUS_VALUES: NotionTaskStatus[] = ["not started", "in progress", "done"];

const TASK_ROW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "notionDatabaseId",
    "notionPageId",
    "title",
    "status",
    "createdAt",
    "dueDate",
    "lastEditedAt",
  ],
  properties: {
    notionDatabaseId: { type: "string" },
    notionPageId: { type: "string" },
    title: { type: "string" },
    status: {
      type: "string",
      enum: STATUS_VALUES,
    },
    createdAt: { type: "string" },
    dueDate: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
    lastEditedAt: { type: "string" },
  },
} as const;

const LIST_TASKS_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tasks"],
  properties: {
    tasks: {
      type: "array",
      items: TASK_ROW_SCHEMA,
    },
  },
} as const;

const GET_TASK_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["task"],
  properties: {
    task: {
      anyOf: [TASK_ROW_SCHEMA, { type: "null" }],
    },
  },
} as const;

const GET_TASK_BODY_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pageBody"],
  properties: {
    pageBody: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["notionDatabaseId", "notionPageId", "body", "lastEditedAt"],
          properties: {
            notionDatabaseId: { type: "string" },
            notionPageId: { type: "string" },
            body: { type: "string" },
            lastEditedAt: { type: "string" },
          },
        },
        { type: "null" },
      ],
    },
  },
} as const;

export class OpenAiMcpPersonalTasksClient implements PersonalTasksLlmMcpClient {
  private readonly config: Required<
    Pick<OpenAiMcpPersonalTasksClientConfig, "apiKey" | "model" | "notionMcpServerUrl">
  > &
    Omit<OpenAiMcpPersonalTasksClientConfig, "apiKey" | "model" | "notionMcpServerUrl">;

  constructor(config: OpenAiMcpPersonalTasksClientConfig) {
    const apiKey = config.apiKey?.trim();
    const model = config.model?.trim();
    const notionMcpServerUrl = config.notionMcpServerUrl?.trim();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for gpt_mcp mode.");
    }
    if (!model) {
      throw new Error("OPENAI_MODEL is required for gpt_mcp mode.");
    }
    if (!notionMcpServerUrl) {
      throw new Error("NOTION_MCP_URL is required for gpt_mcp mode.");
    }

    this.config = {
      ...config,
      apiKey,
      model,
      notionMcpServerUrl,
      baseUrl: config.baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL,
      notionMcpServerLabel: config.notionMcpServerLabel?.trim() || "notion_personal_tasks",
      notionMcpAccessToken: config.notionMcpAccessToken?.trim(),
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
  }

  async listTasks(input: {
    personalTasksDatabaseId: string;
    statuses?: NotionTaskStatus[];
    includeDone?: boolean;
    dueOnOrBefore?: string;
    dueOnOrAfter?: string;
    limit?: number;
  }): Promise<LlmPersonalTaskRow[]> {
    const payload = await this.callStructuredJson<{ tasks: unknown[] }>({
      schemaName: "personal_tasks_list_response",
      schema: LIST_TASKS_RESPONSE_SCHEMA,
      input,
      operationInstructions:
        "Return task rows from the Personal Tasks database. Read-only. No write calls.",
    });

    const rows = Array.isArray(payload.tasks) ? payload.tasks : [];
    return rows.map(parseTaskRow).filter((row): row is LlmPersonalTaskRow => row !== null);
  }

  async getTaskByPageId(input: {
    personalTasksDatabaseId: string;
    notionPageId: string;
  }): Promise<LlmPersonalTaskRow | null> {
    const payload = await this.callStructuredJson<{ task: unknown }>({
      schemaName: "personal_tasks_get_row_response",
      schema: GET_TASK_RESPONSE_SCHEMA,
      input,
      operationInstructions:
        "Return only one matching task row in Personal Tasks DB, or null if missing.",
    });

    return parseTaskRow(payload.task);
  }

  async getTaskPageBody(input: {
    personalTasksDatabaseId: string;
    notionPageId: string;
  }): Promise<LlmPersonalTaskPageBody | null> {
    const payload = await this.callStructuredJson<{ pageBody: unknown }>({
      schemaName: "personal_tasks_get_body_response",
      schema: GET_TASK_BODY_RESPONSE_SCHEMA,
      input,
      operationInstructions:
        "Return page body only for the matching row in Personal Tasks DB, or null if missing.",
    });

    return parseTaskPageBody(payload.pageBody);
  }

  private async callStructuredJson<T>(input: {
    schemaName: string;
    schema: Record<string, unknown>;
    operationInstructions: string;
    input: Record<string, unknown>;
  }): Promise<T> {
    const url = `${this.config.baseUrl!.replace(/\/$/, "")}/responses`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.config.timeoutMs);

    const systemPrompt = [
      "You are a runtime data adapter for a PM personal assistant.",
      "Use only the connected Notion MCP tool.",
      "Read-only mode. Never write.",
      "Database scope is strict: only the provided personalTasksDatabaseId is allowed.",
      input.operationInstructions,
      "Return only JSON that matches the response schema.",
    ].join(" ");

    const requestBody: Record<string, unknown> = {
      model: this.config.model,
      tools: [this.buildNotionMcpTool()],
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(input.input),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: input.schemaName,
          schema: input.schema,
          strict: true,
        },
      },
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `OpenAI Responses API request failed (${response.status}): ${truncate(errorBody, 500)}`
        );
      }

      const data = (await response.json()) as Record<string, unknown>;
      return extractStructuredPayload<T>(data);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error during OpenAI MCP call.";
      throw new Error(`GPT MCP read failed: ${message}`);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private buildNotionMcpTool(): Record<string, unknown> {
    const tool: Record<string, unknown> = {
      type: "mcp",
      server_label: this.config.notionMcpServerLabel,
      server_url: this.config.notionMcpServerUrl,
      require_approval: "never",
    };

    if (this.config.notionMcpAccessToken) {
      tool.headers = {
        Authorization: `Bearer ${this.config.notionMcpAccessToken}`,
      };
    }

    return tool;
  }
}

function parseTaskRow(value: unknown): LlmPersonalTaskRow | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const notionDatabaseId = asString(record.notionDatabaseId);
  const notionPageId = asString(record.notionPageId);
  const title = asString(record.title);
  const status = asStatus(record.status);
  const createdAt = asString(record.createdAt);
  const lastEditedAt = asString(record.lastEditedAt);
  const dueDate = asNullableString(record.dueDate);
  if (
    !notionDatabaseId ||
    !notionPageId ||
    !title ||
    !status ||
    !createdAt ||
    !lastEditedAt
  ) {
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

function parseTaskPageBody(value: unknown): LlmPersonalTaskPageBody | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const notionDatabaseId = asString(record.notionDatabaseId);
  const notionPageId = asString(record.notionPageId);
  const body = asString(record.body);
  const lastEditedAt = asString(record.lastEditedAt);
  if (!notionDatabaseId || !notionPageId || body === null || !lastEditedAt) {
    return null;
  }

  return {
    notionDatabaseId,
    notionPageId,
    body,
    lastEditedAt,
  };
}

function extractStructuredPayload<T>(responseJson: Record<string, unknown>): T {
  const outputParsed = responseJson.output_parsed;
  if (asRecord(outputParsed) || Array.isArray(outputParsed)) {
    return outputParsed as T;
  }

  const output = Array.isArray(responseJson.output) ? responseJson.output : [];
  for (const item of output) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const content = Array.isArray(record.content) ? record.content : [];
    for (const chunk of content) {
      const chunkRecord = asRecord(chunk);
      if (!chunkRecord) {
        continue;
      }

      const parsed = chunkRecord.parsed;
      if (asRecord(parsed) || Array.isArray(parsed)) {
        return parsed as T;
      }

      const textCandidate = asString(chunkRecord.text);
      if (!textCandidate) {
        continue;
      }
      const parsedFromText = tryParseJson(textCandidate);
      if (parsedFromText !== null) {
        return parsedFromText as T;
      }
    }
  }

  const fallbackText = asString(responseJson.output_text);
  if (fallbackText) {
    const parsedFromOutputText = tryParseJson(fallbackText);
    if (parsedFromOutputText !== null) {
      return parsedFromOutputText as T;
    }
  }

  throw new Error("Failed to extract structured JSON payload from model response.");
}

function tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return typeof value === "string" ? value : null;
}

function asStatus(value: unknown): NotionTaskStatus | null {
  if (value === "not started" || value === "in progress" || value === "done") {
    return value;
  }
  return null;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}
