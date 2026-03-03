# Notion MCP Read-Only Smoke Test Plan

## 1) 배경과 목적

이 단계의 목표는 **Service Planning Agent 작업으로 확장하기 전에**, 개인 비서 축의 source-of-truth인 Notion 개인 업무 DB 계약이 실제 데이터와 일치하는지 먼저 검증하는 것입니다.

현재 코드베이스는 `NotionTasksReader` 인터페이스와 `MockNotionTasksReader`를 통해 read-first 구조를 이미 분리해 두었고, 실제 Notion MCP 응답을 이 계약으로 매핑할 수 있으면 비즈니스 로직 변경 없이 교체 가능합니다.

왜 실제 Notion MCP를 먼저 검증하는가:

- 개인 업무의 사실 기준은 Notion DB이며(shared memory는 캐시/요약), 이 축의 계약이 흔들리면 이후 에이전트 응답 신뢰도가 낮아집니다.
- 현재 mock 데이터는 단순 문자열 기반이며, 실제 Notion 응답(속성 타입, rich text, date shape, block body)과 차이가 날 가능성이 높습니다.
- MVP 가드레일상 write 없이 read-only 검증만으로도 위험 구간(타입/매핑/필터)을 조기에 식별할 수 있습니다.

## 2) Read-Only Smoke Test 범위

목적:

- 실제 Notion MCP에서 개인 업무 DB를 읽어, 현재 `NotionTaskRecord` / `NotionTaskPageBody` 계약으로 안전하게 정규화 가능한지 확인
- 상태 필터 및 페이지 본문 조회가 최소 시나리오에서 재현되는지 확인
- 아직 외부 write는 구현/허용하지 않음

비포함:

- Notion 쓰기(create/update)
- 자동 동기화, 백필, 대량 마이그레이션
- Service Planning Agent 쪽 기능 확장

## 3) 테스트 전 준비물

필수 준비:

- 테스트용 Notion 개인 업무 DB 1개
- 샘플 row 2~3개 (권장 상태 분포: `not started`, `in progress`, `done`)
- 각 row에 페이지 본문(최소 1~2 문장) 포함
- MCP에서 DB 접근 권한이 있는 integration/token/connection 설정

권장 샘플 속성(현재 계약 기준):

- 제목 (title)
- 상태 (`not started`, `in progress`, `done`)
- 생성일
- 마감일(nullable)
- 마지막 수정일
- 페이지 본문

## 4) 1차 검증 시나리오

### 시나리오 A: DB 찾기

- 개인 업무 DB를 이름 또는 ID로 식별 가능해야 함
- 결과로 DB ID를 확보하고 이후 쿼리의 기준값으로 사용

검증 포인트:

- 단일 DB를 안정적으로 식별 가능한가
- DB ID가 페이지 조회/쿼리 응답에서 일관되게 재사용 가능한가

### 시나리오 B: DB 속성 읽기

- DB 스키마에서 title/status/date 계열 속성 타입 확인
- 상태 옵션이 `not started`/`in progress`/`done`으로 직접 매핑되는지 확인

검증 포인트:

- 상태가 status/select 중 어떤 타입인지
- 상태 라벨이 영문 소문자 고정인지(로컬라이즈/커스텀 라벨 여부)
- 마감일이 date(start/end/timezone) 구조인지

### 시나리오 C: 상태별 row 조회

- 상태별 row를 read-only로 조회 (`not started`, `in progress`, `done`)
- 현재 `NotionTaskQuery.statuses`, `includeDone`, `limit` 대응 가능성 확인

검증 포인트:

- 상태 필터 결과가 예상 row 수와 일치하는가
- `done` 제외 쿼리(`includeDone=false`)를 안정적으로 구성 가능한가
- 정렬/페이지네이션 부재 시 결과 순서 불안정 이슈가 있는가

### 시나리오 D: 특정 row 페이지 본문 읽기

- 특정 pageId의 본문(blocks)을 읽어 단일 문자열 `body`로 정규화

검증 포인트:

- 본문이 비어 있거나 여러 block인 경우 처리 기준
- mention/inline formatting 포함 시 문자열 정규화 정책
- `NotionTaskPageBody.lastEditedAt`와 row의 `lastEditedAt` 불일치 가능성

## 5) Mock Reader vs 실제 MCP 응답 체크리스트

현재 mock 계약:

- `NotionTaskRecord`
  - `notionDatabaseId: string`
  - `notionPageId: string`
  - `title: string`
  - `status: "not started" | "in progress" | "done"`
  - `createdAt: string`
  - `dueDate: string | null`
  - `lastEditedAt: string`
- `NotionTaskPageBody`
  - `notionPageId: string`
  - `body: string`
  - `lastEditedAt: string`

실응답 대조 체크:

- 제목
  - Notion title은 rich_text 배열일 수 있음 -> plain text 결합 규칙 필요
  - 빈 제목/이모지/멘션 포함 시 fallback 규칙 필요
- 상태
  - Notion status/select 라벨이 계약 enum과 다를 수 있음 -> 명시적 매핑 테이블 필요
  - 대소문자/로케일(예: 한국어 상태명) 대응 필요
- 생성일
  - page-level `created_time` 사용 여부를 고정해야 함
  - ISO 문자열 변환 시 timezone 정책 필요
- 마감일(nullable)
  - date property는 null/미설정/`start`만 존재 등 케이스 분기 필요
  - all-day date(시간 없음)와 datetime(시간 있음)을 동일 타입 string으로 수용할지 확인
- 마지막 수정일
  - page-level `last_edited_time` vs property update 시점 차이 정의 필요
- 페이지 본문
  - block list를 단일 `body: string`으로 flatten하는 정책 필요
  - 본문 길이 제한/줄바꿈 유지/unsupported block 처리 정책 필요

추가 체크:

- `listTasks` 결과 정렬 기준(예: dueDate asc, lastEditedAt desc) 명시 필요
- cursor pagination 도입 여부(현재 mock은 미지원)
- DB 범위 검증: `getTaskByPageId`가 요청 DB 소속 row인지 보장할지 결정 필요

## 6) 실제 연동 시 수정 가능성이 높은 파일

우선순위 기준: 계약 안정성 -> 어댑터 구현 -> 소비자 영향 최소화

1. `packages/tool-connectors/src/types.ts`
- 실제 MCP 응답을 정규화할 때 필요한 필드/주석 보강
- 필요 시 날짜/본문 정규화 규칙 주석 추가

2. `packages/tool-connectors/src/notion-tasks-reader.ts`
- 현재 read 계약 유지 여부 확인
- DB 검색/속성 조회를 런타임에 포함할지(또는 별도 smoke 유틸로 분리할지) 결정

3. `packages/tool-connectors/src/notion-mcp-tasks-reader.ts` (신규 예정)
- `NotionTasksReader` 구현체로 MCP 호출 + 응답 매핑
- write 없이 read 메서드만 구현

4. `packages/tool-connectors/src/index.ts`
- 신규 MCP reader export 추가

5. `apps/orchestrator/src/demo-runner.ts`
- `MockNotionTasksReader`를 MCP reader로 교체 가능한 주입 포인트 정리
- 로컬 smoke 실행 시 DB ID/페이지 ID를 외부 입력으로 받도록 최소 조정 가능

6. `packages/agents/src/personal-assistant-agent.ts`
- 가급적 비즈니스 로직 무변경 유지
- 실응답 날짜/본문 형식 차이로 예외가 발생하면 방어 로직만 최소 보강

## 7) 승인/안전 원칙 재확인

- Notion은 개인 업무 source-of-truth이며, shared memory는 요약/참조/캐시 용도만 유지
- 이번 단계는 MCP read 검증 준비 단계로 한정
- write 기능은 추가하지 않음
- 동작은 제어 가능하고 감사 가능해야 하며, 매핑 규칙은 문서화 가능해야 함
