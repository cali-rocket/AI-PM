/**
 * Responsibility: minimal local demo runner for orchestrator -> Personal Assistant flow.
 * Supports mock and Notion REST API reader selection while keeping one-final-speaker flow unchanged.
 */

import { MockPersonalAssistantAgent } from "../../../packages/agents/src/personal-assistant-agent.ts";
import { InMemorySharedMemoryStore } from "../../../packages/shared-memory/src/in-memory-store.ts";
import { loadOrchestratorRuntimeConfig } from "./config.ts";
import { MockOrchestrator } from "./orchestrator.ts";
import { createPersonalTasksReaderFromConfig } from "./personal-tasks-reader-factory.ts";
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
  const readerSelection = await createPersonalTasksReaderFromConfig(runtimeConfig);
  const notionTasksReader = readerSelection.reader;
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
    `[config] requestedReaderMode=${runtimeConfig.personalTasksReaderMode} selectedReaderMode=${readerSelection.selectedMode} personalTasksDatabaseConfigured=${Boolean(
      runtimeConfig.personalTasksDatabaseId
    )}`
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
