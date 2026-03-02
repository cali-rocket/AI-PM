/**
 * Responsibility: shared working-memory domain types.
 * This layer stores derived working memory only and does not replace external source-of-truth systems.
 * Personal tasks are represented as Notion-derived summary/reference cache entries only.
 */

import type {
  Idea as CoreIdea,
  MemoryNote as CoreMemoryNote,
  ProjectSummary as CoreProjectSummary,
  Service as CoreService,
} from "../../core-types/src";

export type Service = CoreService;
export type Idea = CoreIdea;
export type ProjectSummary = CoreProjectSummary;
export type MemoryNote = CoreMemoryNote;

export type PersonalTaskSummaryRefStatus = "not started" | "in progress" | "done";

/**
 * Lightweight personal task reference derived from Notion source-of-truth.
 * This is NOT an owned task record and must not be treated as canonical data.
 */
export interface PersonalTaskSummaryRef {
  notionPageId: string;
  title: string;
  status: PersonalTaskSummaryRefStatus;
  dueDate: string | null;
  lastSyncedAt: string;
  bodyPreview?: string;
}

export type MemoryEntityType =
  | "service"
  | "idea"
  | "project_summary"
  | "memory_note"
  | "personal_task_summary_ref";

export interface MemoryQuery {
  entityTypes?: MemoryEntityType[];
  text?: string;
  serviceId?: string;
  limit?: number;
}

export interface MemoryQueryResult {
  services: Service[];
  ideas: Idea[];
  projectSummaries: ProjectSummary[];
  memoryNotes: MemoryNote[];
  personalTaskSummaryRefs: PersonalTaskSummaryRef[];
}

export interface MemoryWriteResult {
  entityType: MemoryEntityType;
  entityId: string;
  operation: "created" | "updated";
  writtenAt: string;
}
