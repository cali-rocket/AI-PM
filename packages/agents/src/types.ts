/**
 * Responsibility: minimal runtime contracts for agent execution.
 * Personal task source-of-truth is Notion; shared memory is a summary/reference cache layer.
 */

import type { ConfidenceLevel } from "../../core-types/src";
import type {
  NotionTaskPageBody,
  NotionTaskRecord,
  NotionTaskStatus,
  NotionTasksReader,
} from "../../tool-connectors/src";
import type { PersonalTaskSummaryRef, SharedMemoryStore } from "../../shared-memory/src";

export interface AgentRuntimeContext {
  notionTasksReader: NotionTasksReader;
  personalTasksDatabaseId: string;
  sharedMemoryStore: SharedMemoryStore;
  now: string;
}

export type PersonalAssistantIntent =
  | "list_in_progress"
  | "list_not_started"
  | "list_with_due_date"
  | "get_task_detail"
  | "build_daily_summary";

export interface AgentExecutionInput {
  requestId: string;
  userId: string;
  intent: PersonalAssistantIntent;
  notionPageId?: string;
  daysAhead?: number;
  userText?: string;
}

export interface PersonalAssistantQueryResult {
  tasks: NotionTaskRecord[];
  taskBody?: NotionTaskPageBody | null;
  personalTaskSummaryRefs: PersonalTaskSummaryRef[];
}

export interface AgentExecutionResult {
  // one final speaker principle: this payload is produced by a single agent.
  speaker: "personal_assistant";
  summary: string;
  usedSources: Array<"notion" | "shared_memory">;
  confidence: ConfidenceLevel;
  referencedNotionPageIds: string[];
  queryResult: PersonalAssistantQueryResult;
  intent: PersonalAssistantIntent;
}

export type TaskStatusFilter = NotionTaskStatus;
