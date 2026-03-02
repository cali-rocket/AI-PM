# TypeScript Interface Draft

이 문서는 `docs/product-concept.md`, `docs/system-architecture.md`, `docs/agent-spec.md`, `docs/mvp-scope.md`를 기준으로 정리한 인터페이스 초안입니다.

목적은 실제 구현 전에 도메인 경계와 계약을 고정하는 것입니다.

적용 원칙:
- read-first
- one final speaker
- structured agent collaboration (request/response)
- source-of-truth 우선, shared memory는 작업 기억 계층

## 1) Domain Types

`AgentType` 역할 설명: 시스템의 가시적 에이전트 3종을 고정합니다.

```ts
export type AgentType =
  | "service_planning_ideation"
  | "product_operations"
  | "personal_assistant";
```

`AgentState` 역할 설명: 에이전트 가용성, focus/mute/cooldown 등 런타임 상태를 표현합니다.

```ts
export type AgentAvailability = "idle" | "working" | "waiting" | "muted" | "offline";

export interface AgentState {
  agent: AgentType;
  availability: AgentAvailability;
  currentFocus?: string;
  muted: boolean;
  cooldownUntil?: string; // ISO-8601
  lastUpdatedAt: string; // ISO-8601
}
```

`MessageType` 역할 설명: 에이전트 간 구조화 협업의 메시지 타입을 제한합니다.

```ts
export type MessageType =
  | "info_request"
  | "feasibility_check"
  | "schedule_check"
  | "priority_review"
  | "context_summary_request"
  | "risk_check"
  | "user_attention_check"
  | "escalation_to_user";
```

`ConfidenceLevel` 역할 설명: 응답/메모/판단의 확실성 라벨을 표준화합니다.

```ts
export type ConfidenceLevel = "confirmed" | "likely" | "tentative" | "needs_review";
```

`NotificationLevel` 역할 설명: 선제 발화 노출 우선순위를 규정합니다.

```ts
export type NotificationLevel = "urgent" | "important" | "informational";
```

`Service` 역할 설명: 사용자 서비스 단위의 핵심 컨텍스트와 전략 메타데이터를 저장합니다.

```ts
export interface Service {
  id: string;
  name: string;
  description: string;
  tags: string[];
  status: "active" | "paused" | "archived";
  relatedIdeaIds: string[];
  sourceOfTruthRefs: SourceRef[];
  confidence: ConfidenceLevel;
  updatedAt: string; // ISO-8601
}
```

`Idea` 역할 설명: 아이디어 저장/확장/검토 상태를 추적합니다.

```ts
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
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}
```

`ProjectSummary` 역할 설명: 운영 관점의 프로젝트 리스크/상태 스냅샷을 표현합니다.

```ts
export interface ProjectSummary {
  id: string;
  projectKey: string;
  name: string;
  status: "on_track" | "at_risk" | "blocked" | "delayed";
  upcomingDeadline?: string; // ISO-8601
  overdueTaskCount: number;
  blockerSummary: string[];
  riskNotes: string[];
  sourceOfTruthRefs: SourceRef[]; // Asana 우선
  confidence: ConfidenceLevel;
  updatedAt: string; // ISO-8601
}
```

`PersonalTaskSummary` 역할 설명: 개인 실행 보조를 위한 지금/다음/나중 우선순위를 저장합니다.

```ts
export interface PersonalTaskSummary {
  id: string;
  ownerUserId: string;
  now: string[];
  next: string[];
  later: string[];
  pendingMentions: string[];
  upcomingMeetings: string[];
  sourceOfTruthRefs: SourceRef[]; // Calendar, Notion 우선
  confidence: ConfidenceLevel;
  updatedAt: string; // ISO-8601
}
```

`MemoryNote` 역할 설명: 중요한 문맥/판단 근거를 감사 가능하게 축적합니다.

```ts
export type MemoryCategory =
  | "service_memory"
  | "idea_memory"
  | "project_memory"
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
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}
```

보조 타입 역할 설명: source/evidence 추적을 통일합니다.

```ts
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
  observedAt: string; // ISO-8601
}

export interface EvidenceItem {
  summary: string;
  source: SourceRef;
}
```

## 2) Interface Contracts

`Agent` 역할 설명: 역할별 추론 단위이며, 사용자 요청 처리/내부 메시지 응답/선제 업데이트 후보 생성 책임을 가집니다.

```ts
export interface Agent {
  readonly type: AgentType;
  getState(): Promise<AgentState>;
  handleUserRequest(
    request: UserRequest,
    context: AgentRuntimeContext
  ): Promise<UserResponseDraft>;
  handleAgentMessage(
    request: AgentMessageRequest,
    context: AgentRuntimeContext
  ): Promise<AgentMessageResponse>;
  proposeProactiveUpdate(
    context: AgentRuntimeContext
  ): Promise<ProactiveUpdate | null>;
}
```

`Orchestrator` 역할 설명: 주 응답 에이전트 선택, 협업 조정, 단일 최종 응답 생성을 담당합니다.

```ts
export interface Orchestrator {
  handleUserRequest(request: UserRequest): Promise<UserResponse>;
  coordinateCollaboration(
    primaryAgent: AgentType,
    request: UserRequest
  ): Promise<CollaborationTrace>;
  resolveFinalSpeaker(request: UserRequest): Promise<AgentType>;
  processProactiveUpdate(update: ProactiveUpdate): Promise<ArbitrationDecision>;
}
```

`SharedMemoryStore` 역할 설명: 구조화된 메모리 조회/갱신 계약을 제공합니다.

```ts
export interface SharedMemoryStore {
  getService(id: string): Promise<Service | null>;
  upsertService(service: Service): Promise<void>;

  getIdea(id: string): Promise<Idea | null>;
  upsertIdea(idea: Idea): Promise<void>;

  getProjectSummary(id: string): Promise<ProjectSummary | null>;
  upsertProjectSummary(summary: ProjectSummary): Promise<void>;

  getPersonalTaskSummary(id: string): Promise<PersonalTaskSummary | null>;
  upsertPersonalTaskSummary(summary: PersonalTaskSummary): Promise<void>;

  listMemoryNotes(category?: MemoryCategory): Promise<MemoryNote[]>;
  appendMemoryNote(note: MemoryNote): Promise<void>;

  search(query: MemorySearchQuery): Promise<MemorySearchResult>;
}
```

`ToolConnector` 역할 설명: 외부 도구 접근을 read-only 계약으로 표준화합니다.

```ts
export type ToolName = "slack" | "asana" | "google_calendar" | "notion" | "web_search";

export interface ToolConnector {
  readonly tool: ToolName;
  readonly mode: "read_only";
  read(query: ToolReadQuery): Promise<ToolReadResult>;
  healthCheck(): Promise<ToolHealth>;
}
```

`AgentMessageBus` 역할 설명: 에이전트 간 구조화 request/response 전달과 추적을 담당합니다.

```ts
export interface AgentMessageBus {
  send(request: AgentMessageRequest): Promise<AgentMessageResponse>;
  sendBatch(requests: AgentMessageRequest[]): Promise<AgentMessageResponse[]>;
}
```

`SpeakerArbitrator` 역할 설명: 선제 발화 후보의 노출 수준/채널을 정책 기반으로 결정합니다.

```ts
export interface SpeakerArbitrator {
  evaluate(update: ProactiveUpdate, policy: UserNotificationPolicy): Promise<ArbitrationDecision>;
}
```

`AuditLogger` 역할 설명: 요청, 협업, 도구 조회, 메모리 접근, 최종 응답을 감사 로그로 남깁니다.

```ts
export interface AuditLogger {
  logUserRequest(event: UserRequestLog): Promise<void>;
  logAgentMessage(event: AgentMessageLog): Promise<void>;
  logToolRead(event: ToolReadLog): Promise<void>;
  logMemoryAccess(event: MemoryAccessLog): Promise<void>;
  logUserResponse(event: UserResponseLog): Promise<void>;
  logProactiveUpdate(event: ProactiveUpdateLog): Promise<void>;
}
```

## 3) Input / Output Types

`UserRequest` 역할 설명: 사용자 입력과 대상 에이전트(또는 desk-wide)를 명시합니다.

```ts
export interface UserRequest {
  id: string;
  userId: string;
  text: string;
  requestedAt: string; // ISO-8601
  target: AgentType | "desk";
  conversationId: string;
  context?: Record<string, unknown>;
}
```

`UserResponse` 역할 설명: 사용자에게 전달되는 단일 최종 화자 응답을 표현합니다.

```ts
export interface UserResponse {
  id: string;
  requestId: string;
  finalSpeaker: AgentType; // one final speaker 원칙
  responseText: string;
  confidence: ConfidenceLevel;
  citedSources: SourceRef[];
  involvedAgents: AgentType[];
  generatedAt: string; // ISO-8601
}
```

`AgentMessageRequest` 역할 설명: 에이전트 간 협업 요청 단위를 정의합니다.

```ts
export interface AgentMessageRequest {
  id: string;
  correlationId: string;
  messageType: MessageType;
  from: AgentType;
  to: AgentType;
  requestText: string;
  payload?: Record<string, unknown>;
  requestedAt: string; // ISO-8601
}
```

`AgentMessageResponse` 역할 설명: 협업 요청에 대한 구조화 응답 단위를 정의합니다.

```ts
export interface AgentMessageResponse {
  id: string;
  requestId: string;
  from: AgentType;
  to: AgentType;
  responseText: string;
  confidence: ConfidenceLevel;
  supportingSources: SourceRef[];
  needsEscalationToUser: boolean;
  respondedAt: string; // ISO-8601
}
```

`ProactiveUpdate` 역할 설명: 에이전트가 선제적으로 제안하는 업데이트 후보를 정의합니다.

```ts
export interface ProactiveUpdate {
  id: string;
  from: AgentType;
  level: NotificationLevel;
  summary: string;
  briefing?: BriefingPayload;
  confidence: ConfidenceLevel;
  supportingSources: SourceRef[];
  createdAt: string; // ISO-8601
}
```

`BriefingPayload` 역할 설명: 일일 브리핑/정오 브리핑/회의 준비 브리핑의 공통 구조입니다.

```ts
export interface BriefingPayload {
  title: string;
  now?: string[];
  next?: string[];
  later?: string[];
  keyRisks?: string[];
  checkPoints?: string[];
  meetingPrep?: string[];
}
```

보조 I/O 타입 역할 설명: 인터페이스 메서드 인자로 쓰이는 최소 계약입니다.

```ts
export interface UserResponseDraft {
  primaryAgent: AgentType;
  responseText: string;
  confidence: ConfidenceLevel;
  citedSources: SourceRef[];
  involvedAgents: AgentType[];
}

export interface AgentRuntimeContext {
  memory: SharedMemoryStore;
  connectors: Record<ToolName, ToolConnector>;
  messageBus: AgentMessageBus;
  logger: AuditLogger;
  now: string; // ISO-8601
}

export interface ToolReadQuery {
  requestId: string;
  fromAgent: AgentType;
  query: string;
  filters?: Record<string, unknown>;
}

export interface ToolReadResult {
  items: Array<Record<string, unknown>>;
  sourceRefs: SourceRef[];
  fetchedAt: string; // ISO-8601
}

export interface ToolHealth {
  healthy: boolean;
  checkedAt: string; // ISO-8601
  message?: string;
}

export interface MemorySearchQuery {
  text?: string;
  category?: MemoryCategory;
  relatedEntityId?: string;
  limit?: number;
}

export interface MemorySearchResult {
  services: Service[];
  ideas: Idea[];
  projectSummaries: ProjectSummary[];
  personalTaskSummaries: PersonalTaskSummary[];
  notes: MemoryNote[];
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

export interface CollaborationTrace {
  correlationId: string;
  primaryAgent: AgentType;
  involvedAgents: AgentType[];
  messageCount: number;
  completedAt: string; // ISO-8601
}

export interface UserRequestLog {
  request: UserRequest;
  resolvedPrimaryAgent: AgentType;
  timestamp: string; // ISO-8601
}

export interface AgentMessageLog {
  request: AgentMessageRequest;
  response: AgentMessageResponse;
  timestamp: string; // ISO-8601
}

export interface ToolReadLog {
  requestId: string;
  agent: AgentType;
  tool: ToolName;
  query: string;
  timestamp: string; // ISO-8601
}

export interface MemoryAccessLog {
  requestId: string;
  agent: AgentType;
  action: "read" | "write";
  category: MemoryCategory;
  entityId?: string;
  timestamp: string; // ISO-8601
}

export interface UserResponseLog {
  response: UserResponse;
  timestamp: string; // ISO-8601
}

export interface ProactiveUpdateLog {
  update: ProactiveUpdate;
  decision: ArbitrationDecision;
  timestamp: string; // ISO-8601
}
```

## 4) 다음으로 생성하면 좋은 실제 코드 파일 5개

1. `packages/agent-protocol/src/types.ts`
2. `packages/agent-protocol/src/interfaces.ts`
3. `packages/shared-memory/src/memory-store.interface.ts`
4. `packages/tool-connectors/src/tool-connector.interface.ts`
5. `apps/orchestrator/src/orchestrator.interface.ts`
