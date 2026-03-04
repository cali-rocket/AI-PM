/**
 * Responsibility: local terminal chat interface for orchestrator smoke testing.
 * Keeps one-final-speaker flow while allowing interactive requests in shell.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { randomUUID } from "node:crypto";

import { MockPersonalAssistantAgent } from "../../../packages/agents/src/personal-assistant-agent.ts";
import { InMemorySharedMemoryStore } from "../../../packages/shared-memory/src/in-memory-store.ts";
import { loadOrchestratorRuntimeConfig } from "./config.ts";
import { MockOrchestrator } from "./orchestrator.ts";
import { createPersonalTasksReaderFromConfig } from "./personal-tasks-reader-factory.ts";
import type { AuditLogger, OrchestrationContext, UserRequest, UserResponse } from "./types";

const runtimeConfig = loadOrchestratorRuntimeConfig();

async function runChat(): Promise<void> {
  const readerSelection = await createPersonalTasksReaderFromConfig(runtimeConfig);
  const notionTasksReader = readerSelection.reader;
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
      personalTasksDatabaseId: runtimeConfig.personalTasksDatabaseId,
      sharedMemoryStore,
      now: new Date().toISOString(),
    },
    personalTasksDatabaseId: runtimeConfig.personalTasksDatabaseId,
    auditLogger: createAuditLogger(),
  };

  const conversationId = `conv-${randomUUID()}`;
  const rl = createInterface({ input: stdin, output: stdout });

  console.log("=== PM Desk AI Chat Runner ===");
  console.log(
    `[config] requestedReaderMode=${runtimeConfig.personalTasksReaderMode} selectedReaderMode=${readerSelection.selectedMode} personalTasksDatabaseConfigured=${Boolean(
      runtimeConfig.personalTasksDatabaseId
    )}`
  );
  console.log("Type your message and press Enter.");
  console.log("Commands: /help, /exit, /detail <page_id>");

  try {
    let requestSeq = 1;
    while (true) {
      let input: string;
      try {
        input = (await rl.question("you> ")).trim();
      } catch (error) {
        if (isReadlineClosedError(error)) {
          break;
        }
        throw error;
      }
      if (!input) {
        continue;
      }

      if (input === "/exit" || input === "/quit") {
        break;
      }
      if (input === "/help") {
        console.log("Commands: /help, /exit, /detail <page_id>");
        continue;
      }

      const request = buildRequest({
        input,
        conversationId,
        requestSeq,
      });
      requestSeq += 1;

      context.now = new Date().toISOString();
      if (context.personalAssistantRuntimeContext) {
        context.personalAssistantRuntimeContext.now = context.now;
      }

      const response = await orchestrator.handleUserRequest(request, context);
      printResponse(response);
    }
  } finally {
    rl.close();
  }

  console.log("=== Chat Runner Closed ===");
}

function buildRequest(input: {
  input: string;
  conversationId: string;
  requestSeq: number;
}): UserRequest {
  const { input: rawInput, conversationId, requestSeq } = input;
  const detailPrefix = "/detail ";
  const requestedAt = new Date().toISOString();

  if (rawInput.startsWith(detailPrefix)) {
    const pageId = rawInput.slice(detailPrefix.length).trim();
    if (pageId) {
      return {
        id: `req-${requestSeq}`,
        userId: "local-user",
        conversationId,
        text: "Show task detail",
        requestedAt,
        target: "desk",
        context: {
          notionPageId: pageId,
        },
      };
    }
  }

  return {
    id: `req-${requestSeq}`,
    userId: "local-user",
    conversationId,
    text: rawInput,
    requestedAt,
    target: "desk",
  };
}

function createAuditLogger(): AuditLogger {
  return {
    logOrchestration(event) {
      console.log(
        `[audit] request=${event.requestId} primary=${event.selectedPrimaryAgent} confidence=${event.confidence} sources=${event.usedSources.join(
          ","
        )}`
      );
    },
  };
}

function printResponse(response: UserResponse): void {
  console.log("assistant>");
  console.log(`primaryAgent: ${response.primaryAgent}`);
  console.log(`summary: ${response.summary}`);
  console.log(`confidence: ${response.confidence}`);
  console.log(`usedSources: ${response.usedSources.join(", ")}`);

  const pageIds = response.trace?.referencedNotionPageIds ?? [];
  if (pageIds.length > 0) {
    console.log(`referencedNotionPageIds: ${pageIds.join(", ")}`);
  }
  const notes = response.trace?.notes ?? [];
  if (notes.length > 0) {
    console.log(`trace: ${notes.join(" | ")}`);
  }
  console.log("");
}

function isReadlineClosedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("readline was closed") ||
      (error as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE")
  );
}

runChat().catch((error: unknown) => {
  console.error("[chat-runner] failed:", error);
  process.exitCode = 1;
});
