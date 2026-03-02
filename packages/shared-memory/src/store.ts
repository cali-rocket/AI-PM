/**
 * Responsibility: shared working-memory store contracts.
 * This store is a working-memory layer for services/ideas/projects/notes.
 * Personal task entries here are Notion-derived summary refs only and do not replace Notion source-of-truth.
 */

import type {
  Idea,
  MemoryNote,
  MemoryQuery,
  MemoryQueryResult,
  MemoryWriteResult,
  PersonalTaskSummaryRef,
  ProjectSummary,
  Service,
} from "./types";

export interface SharedMemoryStore {
  getServiceById(serviceId: string): Promise<Service | null>;
  listServices(): Promise<Service[]>;
  saveService(service: Service): Promise<MemoryWriteResult>;

  saveIdea(idea: Idea): Promise<MemoryWriteResult>;
  findIdeasByService(serviceId: string): Promise<Idea[]>;

  saveProjectSummary(summary: ProjectSummary): Promise<MemoryWriteResult>;
  listProjectSummaries(): Promise<ProjectSummary[]>;

  saveMemoryNote(note: MemoryNote): Promise<MemoryWriteResult>;

  /**
   * Stores a derived summary/reference row for a Notion task page.
   * Must not be treated as an owned task record.
   */
  savePersonalTaskSummaryRef(ref: PersonalTaskSummaryRef): Promise<MemoryWriteResult>;
  /**
   * Lists cached personal task refs for read-time assistance only.
   * Notion remains the source-of-truth.
   */
  listPersonalTaskSummaryRefs(): Promise<PersonalTaskSummaryRef[]>;

  queryMemory(query: MemoryQuery): Promise<MemoryQueryResult>;
}
