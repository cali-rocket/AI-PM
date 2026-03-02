/**
 * Responsibility: minimal local demo runner for orchestrator -> Personal Assistant end-to-end flow.
 * No external API calls are used. Notion source-of-truth is mocked through in-memory reader data.
 */

import { MockPersonalAssistantAgent } from "../../../packages/agents/src/personal-assistant-agent.ts";
import { InMemorySharedMemoryStore } from "../../../packages/shared-memory/src/in-memory-store.ts";
import { MockNotionTasksReader } from "../../../packages/tool-connectors/src/mock-notion-tasks-reader.ts";
import { MockOrchestrator } from "./orchestrator.ts";
import type { AuditLogger, OrchestrationContext, UserRequest } from "./types";

const DEMO_NOTION_DATABASE_ID = "notion-db-personal-tasks";

const demoRequests: UserRequest[] = [
  {
    id: "req-demo-001",
    userId: "demo-user",
    conversationId: "conv-demo-001",
    text: "진행 중인 업무 보여줘",
    requestedAt: new Date().toISOString(),
    targetAgent: "personal_assistant",
  },
  {
    id: "req-demo-002",
    userId: "demo-user",
    conversationId: "conv-demo-001",
    text: "아직 시작하지 않은 업무 보여줘",
    requestedAt: new Date().toISOString(),
    target: "desk",
  },
  {
    id: "req-demo-003",
    userId: "demo-user",
    conversationId: "conv-demo-001",
    text: "특정 업무 상세 보여줘",
    requestedAt: new Date().toISOString(),
    targetAgent: "personal_assistant",
    context: {
      notionPageId: "page-task-001",
      notionDatabaseId: DEMO_NOTION_DATABASE_ID,
    },
  },
];

const auditLogger: AuditLogger = {
  logOrchestration(event) {
    // Minimal trace hook for local verification.
    console.log(
      `[audit] request=${event.requestId} primary=${event.selectedPrimaryAgent} sources=${event.usedSources.join(
        ","
      )} confidence=${event.confidence}`
    );
  },
};

async function runDemo(): Promise<void> {
  const notionTasksReader = new MockNotionTasksReader();
  const sharedMemoryStore = new InMemorySharedMemoryStore({ seed: true });
  const personalAssistantAgent = new MockPersonalAssistantAgent();
  const orchestrator = new MockOrchestrator();

  const context: OrchestrationContext = {
    now: new Date().toISOString(),
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
      sharedMemoryStore,
      now: new Date().toISOString(),
    },
    personalAssistantNotionDatabaseId: DEMO_NOTION_DATABASE_ID,
    auditLogger,
  };

  console.log("=== PM Desk AI Demo Runner (Minimal E2E) ===");
  for (const request of demoRequests) {
    const response = await orchestrator.handleUserRequest(request, context);
    const referenced = response.trace?.referencedNotionPageIds ?? [];

    console.log("\n---");
    console.log(`요청 요약: ${request.text}`);
    console.log(`선택된 primary agent: ${response.primaryAgent}`);
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
