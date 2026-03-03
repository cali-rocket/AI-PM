/**
 * Responsibility: orchestrator runtime config loading from environment variables.
 * Sensitive values are expected from `.env` and never hardcoded.
 */

import { loadDotEnvFile, requireEnv } from "./env.ts";

export type PersonalTasksReaderMode = "mock" | "mcp" | "gpt_mcp";

export interface OrchestratorRuntimeConfig {
  personalTasksDatabaseId: string;
  personalTasksReaderMode: PersonalTasksReaderMode;
  notionMcpUrl: string;
  notionMcpAccessToken?: string;
  openAiApiKey?: string;
  openAiModel?: string;
  openAiBaseUrl?: string;
}

export function loadOrchestratorRuntimeConfig(): OrchestratorRuntimeConfig {
  loadDotEnvFile();

  const personalTasksDatabaseId = requireEnv("PERSONAL_TASKS_DATABASE_ID");
  const personalTasksReaderMode = resolveReaderMode(
    process.env.PERSONAL_TASKS_READER_MODE
  );
  const notionMcpUrl = process.env.NOTION_MCP_URL?.trim() || "https://mcp.notion.com/mcp";
  const notionMcpAccessToken = process.env.NOTION_MCP_ACCESS_TOKEN?.trim();
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  const openAiModel = process.env.OPENAI_MODEL?.trim();
  const openAiBaseUrl = process.env.OPENAI_BASE_URL?.trim();

  return {
    personalTasksDatabaseId,
    personalTasksReaderMode,
    notionMcpUrl,
    notionMcpAccessToken,
    openAiApiKey,
    openAiModel,
    openAiBaseUrl,
  };
}

function resolveReaderMode(rawValue: string | undefined): PersonalTasksReaderMode {
  if (!rawValue) {
    return "mock";
  }

  const normalized = rawValue.trim().toLowerCase();
  if (normalized === "mock" || normalized === "mcp" || normalized === "gpt_mcp") {
    return normalized;
  }

  throw new Error(
    `Invalid PERSONAL_TASKS_READER_MODE="${rawValue}". Use "mock", "mcp", or "gpt_mcp".`
  );
}
