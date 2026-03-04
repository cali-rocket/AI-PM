/**
 * Responsibility: runtime reader selection for Personal Tasks (`mock` / `notion_api`).
 * Keeps fallback behavior explicit and centralized for orchestrator entrypoints.
 */

import { MockNotionTasksReader } from "../../../packages/tool-connectors/src/mock-notion-tasks-reader.ts";
import { NotionApiTasksReader } from "../../../packages/tool-connectors/src/notion-api-tasks-reader.ts";
import type { NotionTasksReader } from "../../../packages/tool-connectors/src/notion-tasks-reader.ts";
import type { OrchestratorRuntimeConfig, PersonalTasksReaderMode } from "./config.ts";

export interface PersonalTasksReaderSelection {
  reader: NotionTasksReader;
  requestedMode: PersonalTasksReaderMode;
  selectedMode: "mock" | "notion_api";
}

export async function createPersonalTasksReaderFromConfig(
  runtimeConfig: OrchestratorRuntimeConfig
): Promise<PersonalTasksReaderSelection> {
  if (runtimeConfig.personalTasksReaderMode === "mock") {
    console.log("[notion-reader] mode=mock, using mock reader");
    return {
      reader: createMockReader(runtimeConfig.personalTasksDatabaseId),
      requestedMode: runtimeConfig.personalTasksReaderMode,
      selectedMode: "mock",
    };
  }

  console.log("[notion-reader] mode=notion_api, attempting real Notion API reader");

  const missingFields: string[] = [];
  if (!runtimeConfig.personalTasksDatabaseId?.trim()) {
    missingFields.push("PERSONAL_TASKS_DATABASE_ID");
  }
  if (!runtimeConfig.notionInternalIntegrationSecret?.trim()) {
    missingFields.push("NOTION_INTERNAL_INTEGRATION_SECRET");
  }

  if (missingFields.length > 0) {
    console.log(
      `[notion-reader] Notion API init failed, falling back to mock: missing required config (${missingFields.join(
        ", "
      )})`
    );
    console.log("[notion-reader] mode=mock, using mock reader");
    return {
      reader: createMockReader(runtimeConfig.personalTasksDatabaseId),
      requestedMode: runtimeConfig.personalTasksReaderMode,
      selectedMode: "mock",
    };
  }

  try {
    const notionApiReader = new NotionApiTasksReader({
      personalTasksDatabaseId: runtimeConfig.personalTasksDatabaseId,
      notionInternalIntegrationSecret: runtimeConfig.notionInternalIntegrationSecret!,
      notionApiBaseUrl: runtimeConfig.notionApiBaseUrl,
      notionApiVersion: runtimeConfig.notionApiVersion,
    });

    // Smoke-check API availability once during reader creation.
    await notionApiReader.listTasks({ limit: 1 });
    return {
      reader: notionApiReader,
      requestedMode: runtimeConfig.personalTasksReaderMode,
      selectedMode: "notion_api",
    };
  } catch (error) {
    console.log(
      `[notion-reader] Notion API init failed, falling back to mock: ${
        (error as Error).message
      }`
    );
    console.log("[notion-reader] mode=mock, using mock reader");
    return {
      reader: createMockReader(runtimeConfig.personalTasksDatabaseId),
      requestedMode: runtimeConfig.personalTasksReaderMode,
      selectedMode: "mock",
    };
  }
}

function createMockReader(personalTasksDatabaseId: string): NotionTasksReader {
  return new MockNotionTasksReader({
    personalTasksDatabaseId,
  });
}
