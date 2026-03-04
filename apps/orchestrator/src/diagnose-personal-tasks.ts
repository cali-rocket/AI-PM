/**
 * Responsibility: Personal Tasks mapping diagnostics against real Notion DB.
 * Read-only inspection only. No DB/page write operations.
 */

import { NotionApiTasksReader } from "../../../packages/tool-connectors/src/notion-api-tasks-reader.ts";
import { loadOrchestratorRuntimeConfig } from "./config.ts";

async function run(): Promise<void> {
  const config = loadOrchestratorRuntimeConfig();
  const warnings: string[] = [];

  if (!config.personalTasksDatabaseId) {
    throw new Error("PERSONAL_TASKS_DATABASE_ID is required.");
  }
  if (!config.notionInternalIntegrationSecret) {
    throw new Error("NOTION_INTERNAL_INTEGRATION_SECRET is required.");
  }

  const reader = new NotionApiTasksReader(
    {
      personalTasksDatabaseId: config.personalTasksDatabaseId,
      notionInternalIntegrationSecret: config.notionInternalIntegrationSecret,
      notionApiBaseUrl: config.notionApiBaseUrl,
      notionApiVersion: config.notionApiVersion,
    },
    {
      onWarning(message) {
        warnings.push(message);
      },
    }
  );

  console.log("=== Personal Tasks Diagnose ===");
  console.log("[diagnose] checking database access and schema mapping...");
  const diagnosis = await reader.diagnoseMapping();
  console.log(`[diagnose] databaseAccess=true databaseIdConfigured=${Boolean(diagnosis.databaseId)}`);
  console.log(`[diagnose] databaseTitle=${diagnosis.databaseTitle ?? "(untitled)"}`);
  console.log(
    `[diagnose] resolvedProperties title="${diagnosis.resolvedProperties.title}" status="${diagnosis.resolvedProperties.status}" createdAt="${diagnosis.resolvedProperties.createdAt}" dueDate="${diagnosis.resolvedProperties.dueDate}" lastEditedAt="${diagnosis.resolvedProperties.lastEditedAt}"`
  );
  console.log(
    `[diagnose] statusPropertyType=${diagnosis.resolvedPropertyTypes.status}`
  );
  for (const item of diagnosis.statusOptionMapping) {
    console.log(
      `[diagnose] statusOption raw="${item.raw}" normalized="${item.normalized}" mapped="${item.mapped ?? "unmapped"}"`
    );
  }

  console.log("[diagnose] reading sample rows...");
  const sampleRows = await reader.listTasks({ limit: 2 });
  console.log(`[diagnose] sampleRowCount=${sampleRows.length}`);
  for (const row of sampleRows) {
    console.log(
      `[diagnose] row pageId=${row.notionPageId} title="${row.title}" status=${row.status} createdAt=${row.createdAt} dueDate=${row.dueDate ?? "null"} lastEditedAt=${row.lastEditedAt}`
    );
  }

  if (sampleRows.length > 0) {
    const firstPageId = sampleRows[0].notionPageId;
    console.log(`[diagnose] checking page body for pageId=${firstPageId}...`);
    const body = await reader.getTaskPageBody(firstPageId);
    if (!body) {
      console.log("[diagnose] pageBodyResult=null");
    } else if (!body.body) {
      console.log(
        "[diagnose] pageBodyResult=empty (body is empty or unsupported block types)"
      );
    } else {
      console.log(
        `[diagnose] pageBodyPreview="${truncate(body.body.replace(/\s+/g, " ").trim(), 200)}"`
      );
    }
  } else {
    console.log("[diagnose] skipped page body check because sample rows are empty");
  }

  const mergedWarnings = mergeWarnings(diagnosis.warnings, warnings);
  if (mergedWarnings.length === 0) {
    console.log("[diagnose] warnings=none");
  } else {
    console.log(`[diagnose] warnings=${mergedWarnings.length}`);
    for (const warning of mergedWarnings) {
      console.log(`[diagnose][warn] ${warning}`);
    }
  }
}

function mergeWarnings(a: string[], b: string[]): string[] {
  const merged = new Set<string>();
  for (const message of a) {
    merged.add(message);
  }
  for (const message of b) {
    merged.add(message);
  }
  return Array.from(merged);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

run().catch((error: unknown) => {
  console.error("[diagnose:personal-tasks] failed:", (error as Error).message);
  process.exitCode = 1;
});
