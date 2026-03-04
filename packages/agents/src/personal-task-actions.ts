/**
 * Responsibility: type-first action contracts for Personal Task Assistant domain only.
 *
 * Flow target:
 * Intent Parser -> Policy Gate -> Action Executor -> Response Composer.
 *
 * Guardrails:
 * - Personal tasks source of truth is Notion Personal Tasks database.
 * - MVP is read-first.
 * - Write actions are represented but not executed yet (approval-required only).
 */

import type { ConfidenceLevel } from "../../core-types/src";
import type { NotionTaskStatus } from "../../tool-connectors/src";

export type PersonalTaskActionType =
  | "list_tasks"
  | "get_task_detail"
  | "create_task"
  | "update_task"
  | "unknown"
  | "needs_clarification";

export interface PersonalTaskActionSlots {
  pageId?: string;
  title?: string;
  status?: NotionTaskStatus;
  dueDate?: string | null;
}

export interface PersonalTaskActionIntent {
  action: PersonalTaskActionType;
  slots: PersonalTaskActionSlots;
  confidence: ConfidenceLevel;
  rawUserText: string;
  // Optional short internal note for operator/debug visibility.
  reasoningNote?: string;
  missingRequiredSlots?: Array<keyof PersonalTaskActionSlots>;
  requiresApproval: boolean;
  canExecuteImmediately: boolean;
}

export type PersonalTaskApprovalStatus =
  | "not_needed"
  | "pending"
  | "approved"
  | "rejected";

export type PersonalTaskUsedSource = "notion" | "shared_memory" | "unknown";

export interface PersonalTaskExecutionResult {
  action: PersonalTaskActionType;
  success: boolean;
  summary: string;
  usedSources: PersonalTaskUsedSource[];
  confidence: ConfidenceLevel;
  referencedNotionPageIds: string[];
  approvalStatus?: PersonalTaskApprovalStatus;
}

export function isReadAction(action: PersonalTaskActionType): boolean {
  return action === "list_tasks" || action === "get_task_detail";
}

export function isWriteAction(action: PersonalTaskActionType): boolean {
  return action === "create_task" || action === "update_task";
}
