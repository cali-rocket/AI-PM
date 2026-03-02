/**
 * Responsibility: seed data for in-memory shared working-memory store.
 * Personal task items are Notion-derived summary refs, not canonical task records.
 */

import type {
  Idea,
  MemoryNote,
  PersonalTaskSummaryRef,
  ProjectSummary,
  Service,
} from "./types";

export const SEED_SERVICES: Service[] = [
  {
    id: "svc-growth-dashboard",
    name: "Growth Dashboard",
    description: "PM용 성장 지표 확인 및 리포팅 서비스",
    tags: ["analytics", "pm"],
    status: "active",
    relatedIdeaIds: ["idea-onboarding-template"],
    sourceOfTruthRefs: [
      {
        system: "shared_memory",
        observedAt: "2026-03-02T08:00:00.000Z",
      },
    ],
    confidence: "likely",
    updatedAt: "2026-03-02T08:00:00.000Z",
  },
];

export const SEED_IDEAS: Idea[] = [
  {
    id: "idea-onboarding-template",
    serviceId: "svc-growth-dashboard",
    title: "온보딩 첫 화면에 산업군별 템플릿 추천",
    hypothesis: "초기 설정 시간을 줄이면 1주차 활성률이 오른다",
    expectedImpact: "온보딩 완료율 상승",
    constraints: ["2주 내 착수 가능성 검토 필요"],
    status: "exploring",
    relatedProjectIds: ["prj-growth-q1"],
    evidence: [],
    confidence: "tentative",
    createdAt: "2026-03-01T10:00:00.000Z",
    updatedAt: "2026-03-02T09:10:00.000Z",
  },
];

export const SEED_PROJECT_SUMMARIES: ProjectSummary[] = [
  {
    id: "prj-growth-q1",
    projectKey: "GROWTH-Q1",
    name: "Growth Q1 initiatives",
    status: "at_risk",
    upcomingDeadline: "2026-03-07T09:00:00.000Z",
    overdueTaskCount: 2,
    blockerSummary: ["QA 리소스 부족으로 검증 지연"],
    riskNotes: ["주간 목표 대비 구현 범위 과다"],
    sourceOfTruthRefs: [
      {
        system: "asana",
        externalId: "asana-prj-growth-q1",
        observedAt: "2026-03-02T07:45:00.000Z",
      },
    ],
    confidence: "likely",
    updatedAt: "2026-03-02T07:45:00.000Z",
  },
];

export const SEED_MEMORY_NOTES: MemoryNote[] = [
  {
    id: "note-2026-03-02-risk-brief",
    category: "important_context_note",
    title: "주간 리스크 브리핑 근거",
    body: "GROWTH-Q1의 QA 병목이 이번 주 핵심 리스크로 관찰됨.",
    relatedEntityIds: ["prj-growth-q1"],
    sourceOfTruthRefs: [
      {
        system: "asana",
        externalId: "asana-prj-growth-q1",
        observedAt: "2026-03-02T07:45:00.000Z",
      },
    ],
    confidence: "likely",
    createdAt: "2026-03-02T08:10:00.000Z",
    updatedAt: "2026-03-02T08:10:00.000Z",
  },
];

export const SEED_PERSONAL_TASK_SUMMARY_REFS: PersonalTaskSummaryRef[] = [
  {
    notionPageId: "page-task-001",
    title: "온보딩 개편 회의 준비",
    status: "in progress",
    dueDate: "2026-03-03T09:00:00.000Z",
    lastSyncedAt: "2026-03-02T09:20:00.000Z",
    bodyPreview: "회의 아젠다 3개 정리: KPI 영향, 리스크, 다음 액션.",
  },
  {
    notionPageId: "page-task-002",
    title: "주간 운영 리스크 요약 확인",
    status: "not started",
    dueDate: null,
    lastSyncedAt: "2026-03-02T09:20:00.000Z",
    bodyPreview: "Asana blocker 2건 근거 확인 후 오전 브리핑에 반영.",
  },
];
