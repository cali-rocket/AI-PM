/**
 * Responsibility: in-memory implementation of SharedMemoryStore for local/mock runtime.
 * This is a working-memory store only; personal task refs never replace Notion source-of-truth.
 */

import type { SharedMemoryStore } from "./store";
import type {
  Idea,
  MemoryEntityType,
  MemoryNote,
  MemoryQuery,
  MemoryQueryResult,
  MemoryWriteResult,
  PersonalTaskSummaryRef,
  ProjectSummary,
  Service,
} from "./types";
import {
  SEED_IDEAS,
  SEED_MEMORY_NOTES,
  SEED_PERSONAL_TASK_SUMMARY_REFS,
  SEED_PROJECT_SUMMARIES,
  SEED_SERVICES,
} from "./seed.ts";

export interface InMemorySharedMemoryStoreOptions {
  seed?: boolean;
}

export class InMemorySharedMemoryStore implements SharedMemoryStore {
  private readonly services = new Map<string, Service>();
  private readonly ideas = new Map<string, Idea>();
  private readonly projectSummaries = new Map<string, ProjectSummary>();
  private readonly memoryNotes = new Map<string, MemoryNote>();
  private readonly personalTaskSummaryRefs = new Map<string, PersonalTaskSummaryRef>();

  constructor(options?: InMemorySharedMemoryStoreOptions) {
    if (options?.seed !== false) {
      this.seedDefaults();
    }
  }

  async getServiceById(serviceId: string): Promise<Service | null> {
    return this.services.get(serviceId) ?? null;
  }

  async listServices(): Promise<Service[]> {
    return Array.from(this.services.values());
  }

  async saveService(service: Service): Promise<MemoryWriteResult> {
    return this.writeToMap("service", service.id, service, this.services);
  }

  async saveIdea(idea: Idea): Promise<MemoryWriteResult> {
    return this.writeToMap("idea", idea.id, idea, this.ideas);
  }

  async findIdeasByService(serviceId: string): Promise<Idea[]> {
    return Array.from(this.ideas.values()).filter((idea) => idea.serviceId === serviceId);
  }

  async saveProjectSummary(summary: ProjectSummary): Promise<MemoryWriteResult> {
    return this.writeToMap("project_summary", summary.id, summary, this.projectSummaries);
  }

  async listProjectSummaries(): Promise<ProjectSummary[]> {
    return Array.from(this.projectSummaries.values());
  }

  async saveMemoryNote(note: MemoryNote): Promise<MemoryWriteResult> {
    return this.writeToMap("memory_note", note.id, note, this.memoryNotes);
  }

  async savePersonalTaskSummaryRef(ref: PersonalTaskSummaryRef): Promise<MemoryWriteResult> {
    // Notion source-of-truth is not replaced; this stores derived summary/reference only.
    return this.writeToMap(
      "personal_task_summary_ref",
      ref.notionPageId,
      ref,
      this.personalTaskSummaryRefs
    );
  }

  async listPersonalTaskSummaryRefs(): Promise<PersonalTaskSummaryRef[]> {
    return Array.from(this.personalTaskSummaryRefs.values());
  }

  async queryMemory(query: MemoryQuery): Promise<MemoryQueryResult> {
    const limit = query.limit && query.limit > 0 ? query.limit : undefined;
    const matchText = query.text?.toLowerCase().trim();
    const selected = new Set<MemoryEntityType>(
      query.entityTypes ?? [
        "service",
        "idea",
        "project_summary",
        "memory_note",
        "personal_task_summary_ref",
      ]
    );

    const services = selected.has("service")
      ? this.applyLimit(
          Array.from(this.services.values()).filter((entity) =>
            this.includesText([entity.name, entity.description], matchText)
          ),
          limit
        )
      : [];

    const ideas = selected.has("idea")
      ? this.applyLimit(
          Array.from(this.ideas.values()).filter((entity) => {
            if (query.serviceId && entity.serviceId !== query.serviceId) {
              return false;
            }
            return this.includesText([entity.title, entity.hypothesis, entity.expectedImpact], matchText);
          }),
          limit
        )
      : [];

    const projectSummaries = selected.has("project_summary")
      ? this.applyLimit(
          Array.from(this.projectSummaries.values()).filter((entity) =>
            this.includesText([entity.projectKey, entity.name, ...entity.riskNotes], matchText)
          ),
          limit
        )
      : [];

    const memoryNotes = selected.has("memory_note")
      ? this.applyLimit(
          Array.from(this.memoryNotes.values()).filter((entity) =>
            this.includesText([entity.title, entity.body], matchText)
          ),
          limit
        )
      : [];

    const personalTaskSummaryRefs = selected.has("personal_task_summary_ref")
      ? this.applyLimit(
          Array.from(this.personalTaskSummaryRefs.values()).filter((entity) =>
            this.includesText([entity.title, entity.bodyPreview], matchText)
          ),
          limit
        )
      : [];

    // TODO: Add dedupe, ranking, and recency weighting strategy.
    return {
      services,
      ideas,
      projectSummaries,
      memoryNotes,
      personalTaskSummaryRefs,
    };
  }

  private seedDefaults(): void {
    for (const service of SEED_SERVICES) {
      this.services.set(service.id, service);
    }
    for (const idea of SEED_IDEAS) {
      this.ideas.set(idea.id, idea);
    }
    for (const summary of SEED_PROJECT_SUMMARIES) {
      this.projectSummaries.set(summary.id, summary);
    }
    for (const note of SEED_MEMORY_NOTES) {
      this.memoryNotes.set(note.id, note);
    }
    for (const ref of SEED_PERSONAL_TASK_SUMMARY_REFS) {
      this.personalTaskSummaryRefs.set(ref.notionPageId, ref);
    }
  }

  private writeToMap<T>(
    entityType: MemoryEntityType,
    id: string,
    value: T,
    target: Map<string, T>
  ): MemoryWriteResult {
    const operation: MemoryWriteResult["operation"] = target.has(id) ? "updated" : "created";
    target.set(id, value);
    return {
      entityType,
      entityId: id,
      operation,
      writtenAt: new Date().toISOString(),
    };
  }

  private applyLimit<T>(items: T[], limit?: number): T[] {
    if (!limit) {
      return items;
    }
    return items.slice(0, limit);
  }

  private includesText(candidates: Array<string | undefined | null>, needle?: string): boolean {
    if (!needle) {
      return true;
    }
    return candidates.some((candidate) => candidate?.toLowerCase().includes(needle));
  }
}
