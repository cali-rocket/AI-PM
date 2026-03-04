/**
 * Responsibility: Personal Tasks dedicated Notion API reader (read-only).
 *
 * Guardrails:
 * - Personal Tasks only: restricted to configured `personalTasksDatabaseId`.
 * - internal integration secret based auth only.
 * - Read-only endpoints only (no write/update).
 * - No generic workspace exploration/search.
 */

import { Client } from "@notionhq/client";
import type { NotionTasksReader } from "./notion-tasks-reader";
import type {
  NotionTaskPageBody,
  NotionTaskQuery,
  NotionTaskRecord,
  NotionTaskStatus,
  PersonalTasksReaderConfig,
} from "./types";

const DEFAULT_NOTION_API_VERSION = "2022-06-28";
const DEFAULT_PAGE_SIZE = 100;
const EXPECTED_STATUS_VALUES: NotionTaskStatus[] = [
  "not started",
  "in progress",
  "done",
];

type NotionRecord = Record<string, unknown>;

export interface NotionApiTasksReaderConfig extends PersonalTasksReaderConfig {
  notionInternalIntegrationSecret: string;
  notionApiBaseUrl?: string;
  notionApiVersion?: string;
}

export interface NotionApiTasksReaderOptions {
  onWarning?: (message: string) => void;
}

export interface NotionApiTasksMappingDiagnosis {
  databaseId: string;
  databaseTitle: string | null;
  resolvedProperties: {
    title: string;
    status: string;
    createdAt: string;
    dueDate: string;
    lastEditedAt: string;
  };
  resolvedPropertyTypes: {
    status: "status" | "select";
  };
  statusOptionMapping: Array<{
    raw: string;
    normalized: string;
    mapped: NotionTaskStatus | null;
  }>;
  warnings: string[];
}

interface PersonalTasksSchemaBinding {
  titlePropertyName: string;
  statusPropertyName: string;
  statusPropertyType: "status" | "select";
  statusOptions: string[];
  createdAtPropertyName: string;
  dueDatePropertyName: string;
  lastEditedAtPropertyName: string;
}

export class NotionApiTasksReader implements NotionTasksReader {
  readonly personalTasksDatabaseId: string;

  private readonly notion: Client;
  private readonly warningMessages = new Set<string>();
  private readonly onWarning?: (message: string) => void;
  private schemaBindingPromise?: Promise<PersonalTasksSchemaBinding>;

  constructor(config: NotionApiTasksReaderConfig, options?: NotionApiTasksReaderOptions) {
    const databaseId = config.personalTasksDatabaseId?.trim();
    const secret = config.notionInternalIntegrationSecret?.trim();
    if (!databaseId) {
      throw new Error("personalTasksDatabaseId is required for NotionApiTasksReader.");
    }
    if (!secret) {
      throw new Error("notionInternalIntegrationSecret is required for NotionApiTasksReader.");
    }

    this.personalTasksDatabaseId = databaseId;
    this.onWarning = options?.onWarning;

    const clientOptions: Record<string, unknown> = {
      auth: secret,
      notionVersion: config.notionApiVersion?.trim() || DEFAULT_NOTION_API_VERSION,
    };
    if (config.notionApiBaseUrl?.trim()) {
      // Optional override for proxy/test environment.
      clientOptions.baseUrl = config.notionApiBaseUrl.trim();
    }
    this.notion = new Client(clientOptions as ConstructorParameters<typeof Client>[0]);
  }

  async listTasks(query: NotionTaskQuery): Promise<NotionTaskRecord[]> {
    const binding = await this.getSchemaBinding();
    const pages = await this.queryDatabasePages();

    let mapped = pages
      .map((page) => this.mapPageToTaskRecord(page, binding))
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
    const binding = await this.getSchemaBinding();
    try {
      const page = await this.notion.pages.retrieve({
        page_id: notionPageId,
      });
      return this.mapPageToTaskRecord(asRecord(page), binding);
    } catch (error) {
      if (isObjectNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async getTaskPageBody(notionPageId: string): Promise<NotionTaskPageBody | null> {
    const task = await this.getTaskByPageId(notionPageId);
    if (!task) {
      return null;
    }

    const blocks = await this.readAllBlockChildren(task.notionPageId);
    const lines: string[] = [];
    for (const block of blocks) {
      const line = extractBlockPlainText(block);
      if (line) {
        lines.push(line);
      }
    }

    if (lines.length === 0) {
      this.warn(
        `Page body parsing returned empty result for page=${task.notionPageId}. ` +
          "Body may be empty or contain unsupported block types."
      );
    }

    return {
      notionPageId: task.notionPageId,
      body: lines.join("\n").trim(),
      lastEditedAt: task.lastEditedAt,
    };
  }

  async diagnoseMapping(): Promise<NotionApiTasksMappingDiagnosis> {
    const binding = await this.getSchemaBinding();
    const database = await this.notion.databases.retrieve({
      database_id: this.personalTasksDatabaseId,
    });
    const databaseRecord = asRecord(database);

    const title = readRichTextArray(databaseRecord?.title);
    const statusOptionMapping = binding.statusOptions.map((raw) => {
      const normalized = raw.trim().toLowerCase();
      return {
        raw,
        normalized,
        mapped: normalizeStatus(raw),
      };
    });

    return {
      databaseId: this.personalTasksDatabaseId,
      databaseTitle: title || null,
      resolvedProperties: {
        title: binding.titlePropertyName,
        status: binding.statusPropertyName,
        createdAt: binding.createdAtPropertyName,
        dueDate: binding.dueDatePropertyName,
        lastEditedAt: binding.lastEditedAtPropertyName,
      },
      resolvedPropertyTypes: {
        status: binding.statusPropertyType,
      },
      statusOptionMapping,
      warnings: Array.from(this.warningMessages),
    };
  }

  private async queryDatabasePages(): Promise<NotionRecord[]> {
    const pages: NotionRecord[] = [];
    let cursor: string | undefined;

    do {
      const payload = (await this.notion.databases.query({
        database_id: this.personalTasksDatabaseId,
        page_size: DEFAULT_PAGE_SIZE,
        start_cursor: cursor,
      })) as NotionRecord;

      const results = Array.isArray(payload.results) ? payload.results : [];
      for (const rawPage of results) {
        const page = asRecord(rawPage);
        if (page) {
          pages.push(page);
        }
      }

      const hasMore = payload.has_more === true;
      const nextCursor = asString(payload.next_cursor);
      cursor = hasMore ? nextCursor : undefined;
    } while (cursor);

    return pages;
  }

  private async readAllBlockChildren(blockId: string): Promise<NotionRecord[]> {
    const allBlocks: NotionRecord[] = [];
    let cursor: string | undefined;

    do {
      const payload = (await this.notion.blocks.children.list({
        block_id: blockId,
        page_size: DEFAULT_PAGE_SIZE,
        start_cursor: cursor,
      })) as NotionRecord;
      const results = Array.isArray(payload.results) ? payload.results : [];

      for (const rawBlock of results) {
        const block = asRecord(rawBlock);
        if (block) {
          allBlocks.push(block);
        }
      }

      const hasMore = payload.has_more === true;
      const nextCursor = asString(payload.next_cursor);
      cursor = hasMore ? nextCursor : undefined;
    } while (cursor);

    return allBlocks;
  }

  private async getSchemaBinding(): Promise<PersonalTasksSchemaBinding> {
    if (!this.schemaBindingPromise) {
      this.schemaBindingPromise = this.loadSchemaBinding();
    }
    return this.schemaBindingPromise;
  }

  private async loadSchemaBinding(): Promise<PersonalTasksSchemaBinding> {
    const database = await this.notion.databases.retrieve({
      database_id: this.personalTasksDatabaseId,
    });
    const databaseRecord = asRecord(database);
    const properties = asRecord(databaseRecord?.properties);
    if (!properties) {
      throw new Error(
        "Personal Tasks DB schema could not be read from Notion API response."
      );
    }

    const titleCandidates = findPropertiesByType(properties, ["title"]);
    const statusCandidates = findPropertiesByType(properties, ["status"]);
    const selectCandidates = findPropertiesByType(properties, ["select"]);
    const createdCandidates = findPropertiesByType(properties, ["created_time"]);
    const dueCandidates = findPropertiesByType(properties, ["date"]);
    const lastEditedCandidates = findPropertiesByType(properties, ["last_edited_time"]);

    const titlePropertyName = pickSingleProperty(
      titleCandidates,
      "title",
      this.warn.bind(this)
    );
    const createdAtPropertyName = pickSingleProperty(
      createdCandidates,
      "created_time",
      this.warn.bind(this)
    );
    const dueDatePropertyName = pickDueDateProperty(
      dueCandidates,
      this.warn.bind(this)
    );
    const lastEditedAtPropertyName = pickSingleProperty(
      lastEditedCandidates,
      "last_edited_time",
      this.warn.bind(this)
    );

    let statusPropertyName: string;
    let statusPropertyType: "status" | "select";
    if (statusCandidates.length > 0) {
      statusPropertyName = pickSingleProperty(
        statusCandidates,
        "status",
        this.warn.bind(this)
      );
      statusPropertyType = "status";
      if (selectCandidates.length > 0) {
        this.warn(
          `Both status and select properties exist. Using status property "${statusPropertyName}".`
        );
      }
    } else if (selectCandidates.length > 0) {
      statusPropertyName = pickSingleProperty(
        selectCandidates,
        "select",
        this.warn.bind(this)
      );
      statusPropertyType = "select";
      this.warn(
        `Status property type is select ("${statusPropertyName}"), not status.`
      );
    } else {
      throw new Error(
        "Required status/select property is missing in Personal Tasks DB schema."
      );
    }

    const statusProperty = asRecord(properties[statusPropertyName]);
    const rawOptions =
      statusPropertyType === "status"
        ? asArray(asRecord(statusProperty?.status)?.options)
        : asArray(asRecord(statusProperty?.select)?.options);
    const statusOptions = rawOptions
      .map((option) => asString(asRecord(option)?.name))
      .filter((value): value is string => Boolean(value));
    validateStatusOptions(statusOptions, this.warn.bind(this));

    return {
      titlePropertyName,
      statusPropertyName,
      statusPropertyType,
      statusOptions,
      createdAtPropertyName,
      dueDatePropertyName,
      lastEditedAtPropertyName,
    };
  }

  private mapPageToTaskRecord(
    page: NotionRecord | null,
    binding: PersonalTasksSchemaBinding
  ): NotionTaskRecord | null {
    if (!page) {
      return null;
    }

    const pageId = asString(page.id);
    const normalizedPageId = normalizePageId(pageId);
    const parent = asRecord(page.parent);
    const parentDatabaseId = asString(parent?.database_id);
    if (
      !normalizedPageId ||
      !parentDatabaseId ||
      normalizeNotionId(parentDatabaseId) !== normalizeNotionId(this.personalTasksDatabaseId)
    ) {
      return null;
    }

    const properties = asRecord(page.properties);
    if (!properties) {
      this.warn(`Page ${normalizedPageId} has no properties object.`);
      return null;
    }

    const title = readRichTextArray(
      asRecord(properties[binding.titlePropertyName])?.title
    );
    const rawStatus =
      binding.statusPropertyType === "status"
        ? asString(asRecord(asRecord(properties[binding.statusPropertyName])?.status)?.name)
        : asString(asRecord(asRecord(properties[binding.statusPropertyName])?.select)?.name);
    const status = normalizeStatus(rawStatus);

    const createdAt = normalizeIsoLike(
      asString(asRecord(properties[binding.createdAtPropertyName])?.created_time)
    );
    const dueDate = normalizeIsoLike(
      asString(asRecord(asRecord(properties[binding.dueDatePropertyName])?.date)?.start)
    );
    const lastEditedAt = normalizeIsoLike(
      asString(asRecord(properties[binding.lastEditedAtPropertyName])?.last_edited_time)
    );

    if (!status) {
      this.warn(
        `Unexpected status value "${rawStatus ?? "(null)"}" on page=${normalizedPageId}.`
      );
      return null;
    }
    if (!createdAt || !lastEditedAt) {
      this.warn(
        `Required date field is missing on page=${normalizedPageId}. createdAt=${Boolean(
          createdAt
        )}, lastEditedAt=${Boolean(lastEditedAt)}`
      );
      return null;
    }

    return {
      notionDatabaseId: this.personalTasksDatabaseId,
      notionPageId: normalizedPageId,
      title,
      status,
      createdAt,
      dueDate,
      lastEditedAt,
    };
  }

  private warn(message: string): void {
    if (this.warningMessages.has(message)) {
      return;
    }
    this.warningMessages.add(message);
    if (this.onWarning) {
      this.onWarning(message);
      return;
    }
    console.log(`[notion-api-reader][warn] ${message}`);
  }
}

function validateStatusOptions(
  options: string[],
  warn: (message: string) => void
): void {
  const normalized = options.map((value) => value.trim().toLowerCase());
  const missingExpected = EXPECTED_STATUS_VALUES.filter(
    (expected) => !normalized.includes(expected)
  );
  const unknown = normalized.filter(
    (value) => !EXPECTED_STATUS_VALUES.includes(value as NotionTaskStatus)
  );

  if (missingExpected.length > 0) {
    warn(
      `Status options missing expected values: ${missingExpected.join(", ")}.`
    );
  }
  if (unknown.length > 0) {
    warn(`Status options include unexpected values: ${unknown.join(", ")}.`);
  }
}

function findPropertiesByType(
  properties: NotionRecord,
  allowedTypes: string[]
): string[] {
  const names: string[] = [];
  for (const [name, rawProperty] of Object.entries(properties)) {
    const property = asRecord(rawProperty);
    const type = asString(property?.type);
    if (type && allowedTypes.includes(type)) {
      names.push(name);
    }
  }
  return names;
}

function pickSingleProperty(
  candidates: string[],
  typeName: string,
  warn: (message: string) => void
): string {
  if (candidates.length === 0) {
    throw new Error(`Required ${typeName} property is missing in Personal Tasks DB.`);
  }
  if (candidates.length > 1) {
    warn(
      `Multiple ${typeName} properties found (${candidates.join(", ")}). Using "${candidates[0]}".`
    );
  }
  return candidates[0];
}

function pickDueDateProperty(
  candidates: string[],
  warn: (message: string) => void
): string {
  if (candidates.length === 0) {
    throw new Error("Required due date (date type) property is missing in Personal Tasks DB.");
  }
  if (candidates.length === 1) {
    return candidates[0];
  }

  const preferred = candidates.find((name) => {
    const normalized = name.trim().toLowerCase();
    return normalized.includes("due") || normalized.includes("\uB9C8\uAC10");
  });
  if (preferred) {
    warn(
      `Multiple date properties found (${candidates.join(", ")}). Using preferred due-date-like property "${preferred}".`
    );
    return preferred;
  }

  warn(
    `Multiple date properties found (${candidates.join(", ")}). Using first property "${candidates[0]}".`
  );
  return candidates[0];
}

function readRichTextArray(value: unknown): string {
  const chunks = asArray(value);
  const parts: string[] = [];
  for (const chunk of chunks) {
    const item = asRecord(chunk);
    const plainText = asString(item?.plain_text);
    if (plainText !== null) {
      parts.push(plainText);
    }
  }
  return parts.join("").trim();
}

function extractBlockPlainText(block: NotionRecord): string | null {
  const type = asString(block.type);
  if (!type) {
    return null;
  }
  const payload = asRecord(block[type]);
  if (!payload) {
    return null;
  }

  const richText = readRichTextArray(payload.rich_text);
  if (richText) {
    return richText;
  }
  const paragraph = asString(payload.text);
  return paragraph?.trim() || null;
}

function normalizeStatus(rawStatus: string | null): NotionTaskStatus | null {
  if (!rawStatus) {
    return null;
  }
  const normalized = rawStatus.trim().toLowerCase();
  if (normalized === "not started" || normalized === "todo") {
    return "not started";
  }
  if (normalized === "in progress" || normalized === "in-progress") {
    return "in progress";
  }
  if (normalized === "done" || normalized === "complete" || normalized === "completed") {
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

function normalizePageId(pageId: string | null): string | null {
  if (!pageId) {
    return null;
  }
  const compact = pageId.replace(/-/g, "");
  if (!/^[a-f0-9]{32}$/i.test(compact)) {
    return null;
  }
  return compact.toLowerCase();
}

function normalizeNotionId(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}

function asRecord(value: unknown): NotionRecord | null {
  return typeof value === "object" && value !== null
    ? (value as NotionRecord)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isObjectNotFoundError(error: unknown): boolean {
  const record = asRecord(error);
  const code = asString(record?.code);
  const status = record?.status;
  return code === "object_not_found" || status === 404;
}

