/**
 * Responsibility: minimal local demo runner for orchestrator -> Personal Assistant flow.
 * Supports mock and real MCP reader selection while keeping one-final-speaker flow unchanged.
 */

import { MockPersonalAssistantAgent } from "../../../packages/agents/src/personal-assistant-agent.ts";
import { InMemorySharedMemoryStore } from "../../../packages/shared-memory/src/in-memory-store.ts";
import { GptMcpNotionTasksReader } from "../../../packages/tool-connectors/src/gpt-mcp-notion-tasks-reader.ts";
import { McpNotionTasksReader } from "../../../packages/tool-connectors/src/mcp-notion-tasks-reader.ts";
import { MockNotionTasksReader } from "../../../packages/tool-connectors/src/mock-notion-tasks-reader.ts";
import { OpenAiMcpPersonalTasksClient } from "../../../packages/tool-connectors/src/openai-mcp-personal-tasks-client.ts";
import type { NotionTasksReader } from "../../../packages/tool-connectors/src/notion-tasks-reader.ts";
import { loadOrchestratorRuntimeConfig } from "./config.ts";
import { MockOrchestrator } from "./orchestrator.ts";
import type { AuditLogger, OrchestrationContext, UserRequest } from "./types";

const runtimeConfig = loadOrchestratorRuntimeConfig();

const demoRequests: UserRequest[] = [
  {
    id: "req-demo-001",
    userId: "demo-user",
    conversationId: "conv-demo-001",
    text: "Show me in-progress personal tasks.",
    requestedAt: new Date().toISOString(),
    targetAgent: "personal_assistant",
  },
  {
    id: "req-demo-002",
    userId: "demo-user",
    conversationId: "conv-demo-001",
    text: "What should I do today?",
    requestedAt: new Date().toISOString(),
    target: "desk",
  },
  {
    id: "req-demo-003",
    userId: "demo-user",
    conversationId: "conv-demo-001",
    text: "Show task detail.",
    requestedAt: new Date().toISOString(),
    targetAgent: "personal_assistant",
    context: {
      notionPageId: "page-task-001",
    },
  },
];

const auditLogger: AuditLogger = {
  logOrchestration(event) {
    console.log(
      `[audit] request=${event.requestId} primary=${event.selectedPrimaryAgent} sources=${event.usedSources.join(
        ","
      )} confidence=${event.confidence}`
    );
  },
};

async function runDemo(): Promise<void> {
  const notionTasksReader = await createPersonalTasksReader();
  const sharedMemoryStore = new InMemorySharedMemoryStore({ seed: true });
  const personalAssistantAgent = new MockPersonalAssistantAgent();
  const orchestrator = new MockOrchestrator();

  const now = new Date().toISOString();
  const context: OrchestrationContext = {
    now,
    availableAgents: [
      "service_planning_ideation",
      "product_operations",
      "personal_assistant",
    ],
    defaultAgent: "personal_assistant",
    mode: "read_first",
    personalAssistantAgent,
    personalAssistantRuntimeContext: {
      notionTasksReader,
      personalTasksDatabaseId: runtimeConfig.personalTasksDatabaseId,
      sharedMemoryStore,
      now,
    },
    personalTasksDatabaseId: runtimeConfig.personalTasksDatabaseId,
    auditLogger,
  };

  console.log("=== PM Desk AI Demo Runner (Minimal E2E) ===");
  console.log(
    `[config] personalTasksReaderMode=${runtimeConfig.personalTasksReaderMode} databaseId=${runtimeConfig.personalTasksDatabaseId}`
  );
  for (const request of demoRequests) {
    const response = await orchestrator.handleUserRequest(request, context);
    const referenced = response.trace?.referencedNotionPageIds ?? [];

    console.log("\n---");
    console.log(`request: ${request.text}`);
    console.log(`primaryAgent: ${response.primaryAgent}`);
    console.log(`summary: ${response.summary}`);
    console.log(`confidence: ${response.confidence}`);
    console.log(`usedSources: ${response.usedSources.join(", ")}`);
    if (referenced.length > 0) {
      console.log(`referencedNotionPageIds: ${referenced.join(", ")}`);
    } else {
      console.log("referencedNotionPageIds: (none)");
    }
  }
  console.log("\n=== Demo Completed ===");
}

runDemo().catch((error: unknown) => {
  console.error("[demo-runner] failed:", error);
  process.exitCode = 1;
});

async function createPersonalTasksReader(): Promise<NotionTasksReader> {
  if (runtimeConfig.personalTasksReaderMode === "gpt_mcp") {
    try {
      const llmClient = new OpenAiMcpPersonalTasksClient({
        apiKey: runtimeConfig.openAiApiKey ?? "",
        model: runtimeConfig.openAiModel ?? "",
        baseUrl: runtimeConfig.openAiBaseUrl,
        notionMcpServerUrl: runtimeConfig.notionMcpUrl,
        notionMcpAccessToken: runtimeConfig.notionMcpAccessToken,
      });
      const gptReader = new GptMcpNotionTasksReader(
        {
          personalTasksDatabaseId: runtimeConfig.personalTasksDatabaseId,
        },
        {
          llmMcpClient: llmClient,
        }
      );

      await gptReader.listTasks({ limit: 1 });
      console.log("[config] using gpt-mcp-notion-tasks-reader");
      return gptReader;
    } catch (error) {
      console.warn(
        `[config] GPT MCP reader initialization failed, falling back to mock reader: ${
          (error as Error).message
        }`
      );
    }
  }

  if (runtimeConfig.personalTasksReaderMode === "mcp") {
    try {
      const mcpReader = new McpNotionTasksReader(
        {
          personalTasksDatabaseId: runtimeConfig.personalTasksDatabaseId,
        },
        {
          mcpClientConfig: {
            serverUrl: runtimeConfig.notionMcpUrl,
            accessToken: runtimeConfig.notionMcpAccessToken ?? "",
          },
        }
      );

      // Smoke-check MCP availability. If it fails, fallback to mock path.
      await mcpReader.listTasks({ limit: 1 });
      console.log("[config] using mcp-notion-tasks-reader");
      return mcpReader;
    } catch (error) {
      console.warn(
        `[config] MCP reader initialization failed, falling back to mock reader: ${
          (error as Error).message
        }`
      );
    }
  }

  console.log("[config] using mock-notion-tasks-reader");
  return new MockNotionTasksReader({
    personalTasksDatabaseId: runtimeConfig.personalTasksDatabaseId,
  });
}
