/**
 * Responsibility: shared core domain types for PM Desk AI.
 * This file intentionally contains contracts only (no business logic).
 */

export type AgentType =
  | "service_planning_ideation"
  | "product_operations"
  | "personal_assistant";

export type AgentAvailability = "idle" | "working" | "waiting" | "muted" | "offline";

export interface AgentState {
  agent: AgentType;
  availability: AgentAvailability;
  muted: boolean;
  currentFocus?: string;
  cooldownUntil?: string;
  lastUpdatedAt: string;
}

export type MessageType =
  | "info_request"
  | "feasibility_check"
  | "schedule_check"
  | "priority_review"
  | "context_summary_request"
  | "risk_check"
  | "user_attention_check"
  | "escalation_to_user";

export type ConfidenceLevel = "confirmed" | "likely" | "tentative" | "needs_review";

export type NotificationLevel = "urgent" | "important" | "informational";

export type SourceSystem =
  | "asana"
  | "google_calendar"
  | "notion"
  | "slack"
  | "web_search"
  | "shared_memory"
  | "user_input";

export interface SourceRef {
  system: SourceSystem;
  externalId?: string;
  uri?: string;
  observedAt: string;
}

export interface EvidenceItem {
  summary: string;
  source: SourceRef;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  tags: string[];
  status: "active" | "paused" | "archived";
  relatedIdeaIds: string[];
  sourceOfTruthRefs: SourceRef[];
  confidence: ConfidenceLevel;
  updatedAt: string;
}

export interface Idea {
  id: string;
  serviceId?: string;
  title: string;
  hypothesis?: string;
  expectedImpact?: string;
  constraints?: string[];
  status: "captured" | "exploring" | "validated" | "deferred";
  relatedProjectIds: string[];
  evidence: EvidenceItem[];
  confidence: ConfidenceLevel;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  projectKey: string;
  name: string;
  status: "on_track" | "at_risk" | "blocked" | "delayed";
  upcomingDeadline?: string;
  overdueTaskCount: number;
  blockerSummary: string[];
  riskNotes: string[];
  sourceOfTruthRefs: SourceRef[];
  confidence: ConfidenceLevel;
  updatedAt: string;
}

export type NotionTaskStatus = "not started" | "in progress" | "done";

/**
 * A lightweight view of one Notion DB row/page for personal tasks.
 * Source of truth remains Notion DB; this type is used for read-models and cache snapshots.
 */
export interface NotionPersonalTaskPageRef {
  notionPageId: string;
  title: string;
  status: NotionTaskStatus;
  createdAt: string;
  dueDate: string | null;
  lastEditedAt: string;
  bodyPreview?: string;
  lastSyncedAt: string;
}

/**
 * Derived summary/reference cache of personal tasks.
 * This is NOT the canonical task store; Notion DB is the source of truth.
 */
export interface PersonalTaskSummary {
  id: string;
  ownerUserId: string;
  notionDatabaseId: string;
  taskPageRefs: NotionPersonalTaskPageRef[];
  summaryText?: string;
  cachePurpose: "summary" | "reference" | "cache";
  sourceOfTruthRefs: SourceRef[];
  confidence: ConfidenceLevel;
  lastSyncedAt: string;
  updatedAt: string;
}

export type MemoryCategory =
  | "service_memory"
  | "idea_memory"
  | "project_memory"
  // Notion 개인 업무 원본이 아니라 summary/reference cache 카테고리.
  | "personal_task_memory"
  | "important_context_note"
  | "conversation_summary";

export interface MemoryNote {
  id: string;
  category: MemoryCategory;
  title: string;
  body: string;
  relatedEntityIds: string[];
  sourceOfTruthRefs: SourceRef[];
  confidence: ConfidenceLevel;
  createdAt: string;
  updatedAt: string;
}

export interface UserRequest {
  id: string;
  userId: string;
  text: string;
  requestedAt: string;
  target: AgentType | "desk";
  conversationId: string;
  context?: Record<string, unknown>;
}

export interface UserResponse {
  id: string;
  requestId: string;
  finalSpeaker: AgentType;
  responseText: string;
  confidence: ConfidenceLevel;
  citedSources: SourceRef[];
  involvedAgents: AgentType[];
  generatedAt: string;
}

export interface AgentMessageRequest {
  id: string;
  correlationId: string;
  messageType: MessageType;
  from: AgentType;
  to: AgentType;
  requestText: string;
  payload?: Record<string, unknown>;
  requestedAt: string;
}

export interface AgentMessageResponse {
  id: string;
  requestId: string;
  from: AgentType;
  to: AgentType;
  responseText: string;
  confidence: ConfidenceLevel;
  supportingSources: SourceRef[];
  needsEscalationToUser: boolean;
  respondedAt: string;
}

export interface BriefingPayload {
  title: string;
  now?: string[];
  next?: string[];
  later?: string[];
  keyRisks?: string[];
  checkPoints?: string[];
  meetingPrep?: string[];
}

export interface ProactiveUpdate {
  id: string;
  from: AgentType;
  level: NotificationLevel;
  summary: string;
  briefing?: BriefingPayload;
  confidence: ConfidenceLevel;
  supportingSources: SourceRef[];
  createdAt: string;
}

export interface UserNotificationPolicy {
  mutedAgents: AgentType[];
  focusMode: boolean;
  allowInterruptLevel: NotificationLevel;
  cooldownSeconds: number;
}

export interface ArbitrationDecision {
  allowed: boolean;
  deliveryMode: "interrupt" | "badge" | "inbox" | "suppress";
  reason: string;
}

export interface UserResponseDraft {
  primaryAgent: AgentType;
  responseText: string;
  confidence: ConfidenceLevel;
  citedSources: SourceRef[];
  involvedAgents: AgentType[];
}
