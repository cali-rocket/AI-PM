/**
 * Responsibility: orchestrator runtime config loading from environment variables.
 * Sensitive values are expected from `.env` and never hardcoded.
 */

import { loadDotEnvFile, requireEnv } from "./env.ts";

export type PersonalTasksReaderMode = "mock" | "notion_api";

export interface OrchestratorRuntimeConfig {
  personalTasksDatabaseId: string;
  personalTasksReaderMode: PersonalTasksReaderMode;
  notionInternalIntegrationSecret?: string;
  notionApiBaseUrl: string;
  notionApiVersion: string;
}

export function loadOrchestratorRuntimeConfig(): OrchestratorRuntimeConfig {
  loadDotEnvFile();

  const personalTasksDatabaseId = requireEnv("PERSONAL_TASKS_DATABASE_ID");
  const personalTasksReaderMode = resolveReaderMode(
    process.env.PERSONAL_TASKS_READER_MODE
  );
  const notionInternalIntegrationSecret =
    process.env.NOTION_INTERNAL_INTEGRATION_SECRET?.trim();
  const notionApiBaseUrl =
    process.env.NOTION_API_BASE_URL?.trim() || "https://api.notion.com";
  const notionApiVersion =
    process.env.NOTION_API_VERSION?.trim() || "2022-06-28";

  return {
    personalTasksDatabaseId,
    personalTasksReaderMode,
    notionInternalIntegrationSecret,
    notionApiBaseUrl,
    notionApiVersion,
  };
}

function resolveReaderMode(rawValue: string | undefined): PersonalTasksReaderMode {
  if (!rawValue) {
    return "mock";
  }

  const normalized = rawValue.trim().toLowerCase();
  if (normalized === "mock" || normalized === "notion_api") {
    return normalized;
  }
  if (normalized === "mcp") {
    // Deprecated alias kept for migration safety.
    return "notion_api";
  }

  throw new Error(
    `Invalid PERSONAL_TASKS_READER_MODE="${rawValue}". Use "mock" or "notion_api" (legacy "mcp" is mapped to "notion_api").`
  );
}
