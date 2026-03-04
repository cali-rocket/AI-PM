/**
 * Responsibility: minimal runtime Notion MCP client adapter for Personal Tasks reads.
 * This file intentionally avoids any codex CLI dependency.
 *
 * Runtime assumptions:
 * - The process can reach Notion MCP server over HTTPS.
 * - Authentication is handled by the MCP client/OAuth session outside app business logic.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { NotionMcpAuthSessionManager } from "./notion-mcp-auth-session";
import { NotionMcpOAuthLoginRequiredError } from "./notion-mcp-auth-session";

export interface PersonalTasksSchemaColumns {
  title: string;
  status: string;
  created: string;
  due: string;
  lastEdited: string;
}

export interface PersonalTasksDataSourceInfo {
  databaseId: string;
  dataSourceUrl: string;
  schemaColumns: PersonalTasksSchemaColumns;
}

export interface PersonalTasksMcpTaskRow {
  pageUrl: string;
  title: string | null;
  status: string | null;
  createdAt: string | null;
  dueDate: string | null;
  lastEditedAt: string | null;
}

export interface PersonalTasksMcpPageBody {
  pageId: string;
  body: string;
  lastEditedAt: string | null;
}

export interface PersonalTasksMcpBridgeClient {
  getDataSourceInfo(databaseId: string): Promise<PersonalTasksDataSourceInfo>;
  queryTaskRows(input: {
    dataSourceUrl: string;
    schemaColumns: PersonalTasksSchemaColumns;
  }): Promise<PersonalTasksMcpTaskRow[]>;
  fetchPageBody(pageId: string): Promise<PersonalTasksMcpPageBody>;
}

export interface NotionMcpClientConfig {
  serverUrl: string;
  accessToken?: string;
  authSessionManager?: NotionMcpAuthSessionManager;
  timeoutMs?: number;
}

interface ResolvedToolNames {
  fetch: string;
  queryDataSources: string;
}

/**
 * Personal Tasks read-only adapter using MCP TypeScript SDK transport.
 */
export class NotionMcpRuntimeBridgeClient implements PersonalTasksMcpBridgeClient {
  private readonly config: NotionMcpClientConfig;
  private readonly timeoutMs: number;
  private readonly authSessionManager?: NotionMcpAuthSessionManager;

  private client?: Client;
  private transport?: StreamableHTTPClientTransport;
  private toolNames?: ResolvedToolNames;

  constructor(config: NotionMcpClientConfig) {
    const serverUrl = config.serverUrl?.trim();
    if (!serverUrl) {
      throw new Error("Notion MCP serverUrl is required.");
    }

    this.config = {
      serverUrl,
      accessToken: config.accessToken?.trim(),
      authSessionManager: config.authSessionManager,
      timeoutMs: config.timeoutMs,
    };
    this.timeoutMs = config.timeoutMs ?? 45_000;
    this.authSessionManager = config.authSessionManager;
  }

  async getDataSourceInfo(databaseId: string): Promise<PersonalTasksDataSourceInfo> {
    const fetchTool = await this.resolveToolName("fetch");
    const databaseResult = await this.callTool(fetchTool, { id: databaseId });
    const databasePayload = extractJsonBlobFromToolResult(databaseResult);
    const databaseText = asString(databasePayload.text) ?? "";

    let stateObject = extractDataSourceStateObject(databaseText);
    let dataSourceUrl =
      asString(stateObject?.url) ?? extractFirstDataSourceUrl(databaseText);

    // MCP responses can differ by deployment/version:
    // - database fetch may include only data-source references
    // - data-source fetch usually includes full schema state
    if ((!stateObject || !asRecord(stateObject.schema)) && dataSourceUrl) {
      const dataSourceResult = await this.callTool(fetchTool, { id: dataSourceUrl });
      const dataSourcePayload = extractJsonBlobFromToolResult(dataSourceResult);
      const dataSourceText = asString(dataSourcePayload.text) ?? "";
      stateObject = extractDataSourceStateObject(dataSourceText) ?? stateObject;
      dataSourceUrl =
        asString(stateObject?.url) ??
        extractFirstDataSourceUrl(dataSourceText) ??
        dataSourceUrl;
    }

    if (!stateObject) {
      throw new Error(
        "Failed to parse data source state from notion-fetch response. Verify MCP fetch payload tags."
      );
    }

    const schema = asRecord(stateObject.schema);
    if (!dataSourceUrl || !schema) {
      throw new Error(
        "Missing data source url/schema in notion-fetch response. Verify database -> data source resolution."
      );
    }

    const schemaColumns = resolveSchemaColumns(schema);
    return {
      databaseId,
      dataSourceUrl,
      schemaColumns,
    };
  }

  async queryTaskRows(input: {
    dataSourceUrl: string;
    schemaColumns: PersonalTasksSchemaColumns;
  }): Promise<PersonalTasksMcpTaskRow[]> {
    const queryTool = await this.resolveToolName("queryDataSources");
    const queryPayload = {
      mode: "sql",
      data_source_urls: [input.dataSourceUrl],
      query: buildTaskSelectSql(input.dataSourceUrl, input.schemaColumns),
    };

    const result = await this.callTool(queryTool, {
      data: JSON.stringify(queryPayload),
    });
    const payload = extractJsonBlobFromToolResult(result);
    const rows = Array.isArray(payload.results) ? payload.results : [];

    return rows
      .map((row) => {
        const record = asRecord(row);
        if (!record) {
          return null;
        }
        const pageUrl = asString(record.pageUrl ?? record.url);
        if (!pageUrl) {
          return null;
        }
        return {
          pageUrl,
          title: asNullableString(record.title),
          status: asNullableString(record.status),
          createdAt: asNullableString(record.createdAt),
          dueDate: asNullableString(record.dueDate),
          lastEditedAt: asNullableString(record.lastEditedAt),
        } satisfies PersonalTasksMcpTaskRow;
      })
      .filter((row): row is PersonalTasksMcpTaskRow => row !== null);
  }

  async fetchPageBody(pageId: string): Promise<PersonalTasksMcpPageBody> {
    const fetchTool = await this.resolveToolName("fetch");
    const result = await this.callTool(fetchTool, { id: pageId });
    const payload = extractJsonBlobFromToolResult(result);
    const embeddedText = asString(payload.text) ?? "";

    const properties = extractPropertiesObject(embeddedText);
    const body = extractTagContent(embeddedText, "content")?.trim() ?? "";
    const lastEditedAt = pickLastEditedAt(properties);

    return {
      pageId,
      body,
      lastEditedAt,
    };
  }

  private async getClient(): Promise<Client> {
    if (this.client) {
      return this.client;
    }
    const accessToken = await this.resolveAccessToken();

    this.client = new Client(
      { name: "ai-pm-notion-runtime-client", version: "0.1.0" },
      { capabilities: {} }
    );

    this.transport = new StreamableHTTPClientTransport(
      new URL(this.config.serverUrl),
      {
        requestInit: buildRequestInit(accessToken),
      }
    );

    try {
      await withTimeout(
        this.client.connect(this.transport),
        this.timeoutMs,
        "Timed out while connecting to Notion MCP server."
      );
    } catch (error) {
      throw convertToAuthErrorIfNeeded(error);
    }

    return this.client;
  }

  private async resolveToolName(kind: keyof ResolvedToolNames): Promise<string> {
    if (this.toolNames) {
      return this.toolNames[kind];
    }

    const client = await this.getClient();
    let toolsResult: Awaited<ReturnType<Client["listTools"]>>;
    try {
      toolsResult = await withTimeout(
        client.listTools(),
        this.timeoutMs,
        "Timed out while listing Notion MCP tools."
      );
    } catch (error) {
      throw convertToAuthErrorIfNeeded(error);
    }
    const tools = toolsResult.tools ?? [];

    const fetch = findToolName(tools, ["notion-fetch", "notion.fetch"]);
    const queryDataSources = findToolName(tools, [
      "notion-query-data-sources",
      "notion.query-data-sources",
    ]);

    if (!fetch || !queryDataSources) {
      throw new Error(
        "Required Notion MCP tools are not available (fetch/query-data-sources)."
      );
    }

    this.toolNames = { fetch, queryDataSources };
    return this.toolNames[kind];
  }

  private async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const client = await this.getClient();
    let result: Awaited<ReturnType<Client["callTool"]>>;
    try {
      result = await withTimeout(
        client.callTool({
          name: toolName,
          arguments: args,
        }),
        this.timeoutMs,
        `Timed out while calling MCP tool: ${toolName}`
      );
    } catch (error) {
      throw convertToAuthErrorIfNeeded(error);
    }

    if (result.isError) {
      throw new Error(`MCP tool error from ${toolName}.`);
    }
    return result;
  }

  private async resolveAccessToken(): Promise<string> {
    if (this.config.accessToken) {
      return this.config.accessToken;
    }
    if (!this.authSessionManager) {
      throw new NotionMcpOAuthLoginRequiredError(
        "OAuth login required: Notion MCP auth session manager is not configured."
      );
    }

    const session = await this.authSessionManager.getValidSession();
    const token = session.accessToken?.trim();
    if (!token) {
      throw new NotionMcpOAuthLoginRequiredError(
        "OAuth login required: session exists but access token is empty."
      );
    }
    return token;
  }
}

function buildRequestInit(
  accessToken: string
): { headers: Record<string, string> } {
  return {
    headers: {
      Authorization: `Bearer ${accessToken.trim()}`,
    },
  };
}

function buildTaskSelectSql(
  dataSourceUrl: string,
  columns: PersonalTasksSchemaColumns
): string {
  const table = quoteIdentifier(dataSourceUrl);
  const title = quoteIdentifier(columns.title);
  const status = quoteIdentifier(columns.status);
  const created = quoteIdentifier(columns.created);
  const dueStart = quoteIdentifier(`date:${columns.due}:start`);
  const lastEdited = quoteIdentifier(columns.lastEdited);

  return [
    "SELECT",
    `  url AS pageUrl,`,
    `  ${title} AS title,`,
    `  ${status} AS status,`,
    `  ${created} AS createdAt,`,
    `  ${dueStart} AS dueDate,`,
    `  ${lastEdited} AS lastEditedAt`,
    `FROM ${table}`,
    `ORDER BY CASE WHEN ${created} IS NULL THEN 1 ELSE 0 END, ${created} DESC`,
  ].join("\n");
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function resolveSchemaColumns(
  schema: Record<string, unknown>
): PersonalTasksSchemaColumns {
  let title: string | null = null;
  let status: string | null = null;
  let created: string | null = null;
  let due: string | null = null;
  let lastEdited: string | null = null;

  for (const [columnName, rawSpec] of Object.entries(schema)) {
    const spec = asRecord(rawSpec);
    const type = asString(spec?.type)?.toLowerCase();
    if (!type) {
      continue;
    }

    if (!title && type === "title") {
      title = columnName;
      continue;
    }
    if (!status && (type === "select" || type === "status")) {
      status = columnName;
      continue;
    }
    if (!created && type === "created_time") {
      created = columnName;
      continue;
    }
    if (!due && type === "date") {
      due = columnName;
      continue;
    }
    if (!lastEdited && type === "last_edited_time") {
      lastEdited = columnName;
      continue;
    }
  }

  if (!title || !status || !created || !due || !lastEdited) {
    throw new Error(
      "Personal Tasks schema does not include required columns (title/status/created/due/lastEdited)."
    );
  }

  return { title, status, created, due, lastEdited };
}

function extractJsonBlobFromToolResult(result: unknown): Record<string, unknown> {
  const record = asRecord(result);
  const content = Array.isArray(record?.content) ? record.content : [];

  const textChunk = content
    .map((chunk) => {
      const item = asRecord(chunk);
      if (!item) {
        return null;
      }
      if (item.type === "text") {
        return asString(item.text);
      }
      return null;
    })
    .find((text): text is string => typeof text === "string");

  if (!textChunk) {
    throw new Error("No text payload found in MCP tool result.");
  }

  try {
    const parsed = JSON.parse(textChunk);
    if (!asRecord(parsed)) {
      throw new Error("Parsed JSON is not an object.");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse MCP tool text payload as JSON: ${(error as Error).message}`);
  }
}

function extractDataSourceStateObject(
  sourceText: string
): Record<string, unknown> | null {
  const raw = extractTagContent(sourceText, "data-source-state");
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function extractPropertiesObject(
  sourceText: string
): Record<string, unknown> | null {
  const raw = extractTagContent(sourceText, "properties");
  if (!raw) {
    return null;
  }

  try {
    return asRecord(JSON.parse(raw.trim()));
  } catch {
    return null;
  }
}

function extractTagContent(sourceText: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*<\\/${tagName}>`, "i");
  const matched = sourceText.match(regex);
  return matched?.[1] ?? null;
}

function extractFirstDataSourceUrl(sourceText: string): string | null {
  const match = sourceText.match(
    /<data-source\s+url="(collection:\/\/[a-f0-9-]+)"/i
  );
  return match?.[1] ?? null;
}

function pickLastEditedAt(properties: Record<string, unknown> | null): string | null {
  if (!properties) {
    return null;
  }

  const directCandidates = ["last_edited_time", "lastEditedAt", "Last edited time"];
  for (const key of directCandidates) {
    const value = asNullableString(properties[key]);
    if (value) {
      return value;
    }
  }

  for (const [key, value] of Object.entries(properties)) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey.includes("last") && normalizedKey.includes("edit")) {
      const converted = asNullableString(value);
      if (converted) {
        return converted;
      }
    }
  }

  return null;
}

function findToolName(
  tools: Array<{ name: string }>,
  preferredCandidates: string[]
): string | null {
  for (const candidate of preferredCandidates) {
    const found = tools.find((tool) => tool.name === candidate);
    if (found) {
      return found.name;
    }
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function convertToAuthErrorIfNeeded(error: unknown): Error {
  if (error instanceof NotionMcpOAuthLoginRequiredError) {
    return error;
  }

  const message = (error as Error)?.message ?? String(error);
  const normalized = message.toLowerCase();
  const isAuthFailure =
    normalized.includes("401") ||
    normalized.includes("unauthorized") ||
    normalized.includes("invalid_token") ||
    normalized.includes("invalid token") ||
    normalized.includes("authentication");

  if (isAuthFailure) {
    return new NotionMcpOAuthLoginRequiredError(
      `OAuth login required or session expired: ${message}`
    );
  }

  return error instanceof Error ? error : new Error(message);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

