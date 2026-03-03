# 시스템 아키텍처

## 개요

이 시스템은 데스크형 사용자 경험을 중심으로 구성된 멀티 에이전트 런타임입니다.

아키텍처는 아래 요소들을 분리합니다.

* 사용자에게 보이는 에이전트
* 오케스트레이션 및 조정
* 공유 메모리
* 외부 도구 연동
* 에이전트 간 메시지 라우팅
* 선제 발화 제어
* 로그 및 감사 계층

이 분리는 시스템을 이해 가능하고, 감사 가능하며, 확장 가능하게 유지하기 위해 필수적입니다.

## 상위 구성요소

1. Desk UI Layer
2. Agent Runtime Layer
3. Orchestrator
4. Shared Memory Layer
5. Tool Connector Layer
6. Agent Message Bus
7. Speaker Arbitration Layer
8. Logging / Audit Layer

---

## 1. Desk UI Layer

사용자가 직접 상호작용하는 인터페이스 계층입니다.

### 책임

* 보이는 에이전트 표시
* 사용자가 특정 에이전트를 선택해 대화할 수 있도록 지원
* 에이전트별 상태 표시
* 에이전트 inbox / 선제 업데이트 표시
* badge, urgency, unread 상태 표현
* 사용자 제어 기능 제공 (mute / focus / 라우팅 선호도)

### 핵심 원칙

UI는 여러 전문가를 보여주되, 전체 경험은 하나의 일관된 작업 공간처럼 느껴져야 합니다.

---

## 2. Agent Runtime Layer

각 에이전트의 역할별 추론 로직이 포함된 계층입니다.

### 에이전트 인스턴스

* 서비스 기획 및 아이디에이션 Agent
* 제품 운영 Agent
* 개인 비서 Agent

### 책임

* 사용자 요청을 역할 컨텍스트 안에서 해석
* 공유 메모리 조회
* 필요 시 외부 도구 조회
* 필요 시 Agent Message Bus를 통해 다른 에이전트에게 요청
* 최종 화자로 지정된 경우 사용자 응답 생성

### 중요 제약

MVP에서는 에이전트가 제3자 시스템을 직접 변경하지 않습니다.

---

## 3. Orchestrator

사용자 요청 처리의 중심 조정 계층입니다.

### 책임

* 주 응답 에이전트 결정
* 사용자가 “전체 데스크”에 말한 경우 적절한 에이전트로 라우팅
* 다중 에이전트 협업 필요 여부 판단
* 내부 협업 결과를 하나의 응답으로 정리
* 필요 시 불확실성을 사용자에게 에스컬레이션

### 설계 원칙

오케스트레이터는 조정자이며, 모든 도메인 로직을 집어삼켜서는 안 됩니다.

---

## 4. Shared Memory Layer

모든 에이전트가 참조하는 구조화된 내부 지식 저장소입니다.

### 책임

* 유용한 작업 기억 저장
* 엔티티 단위 조회 지원 (service, idea, project, personal task summary cache)
* 엔티티 간 연결 지원
* confidence 및 source 메타데이터 저장
* 업데이트 시점 및 최신성 추적

### 메모리 카테고리

* service memory
* idea memory
* project memory
* personal task summary/reference cache
* summarized conversation memory

### 설계 원칙

메모리는 작업 기억 계층이지, 유일한 진실의 원천이 아닙니다.
특히 개인 업무는 Notion DB가 원본이며, shared memory의 개인 업무 정보는 요약/참조/캐시로만 취급합니다.

---

## 5. Tool Connector Layer

외부 시스템 접근을 담당하는 계층입니다.

### 연동 대상

* Slack connector
* Asana connector
* Google Calendar connector
* Notion connector
* Web search connector

### 책임

* 외부 도구 접근을 공통 인터페이스 뒤로 감추기
* 벤더별 API 차이 격리
* mock 가능한 구현 제공
* 내부에서 사용하기 좋은 정규화된 데이터 구조 반환

### Source-of-Truth 정책

* Asana: 프로젝트/업무 상태의 기준
* Google Calendar: 일정 사실의 기준
* Notion: 개인 업무의 단일 원본 저장소(single source of truth)
* Slack: signal 중심 소스, 해석 필요
* Web Search: 외부 맥락 정보

### Notion 개인 업무 데이터 가정 (MVP)

개인 비서 Agent가 조회하는 개인 업무 DB는 Notion DB로 가정합니다.

Notion DB 속성은 아래만 사용합니다.

* 제목 (string)
* 상태 (`not started`, `in progress`, `done`)
* 생성일
* 마감일 (nullable)
* 마지막 수정일

추가 가정:

* Notion DB row는 하나의 page로 취급
* 업무 상세 내용은 해당 page body에 존재
* 우선순위/태그/추가 속성/본문 템플릿은 MVP에서 도입하지 않음

런타임 연결 경로(개인 비서 축):

* `PersonalAssistantAgent -> NotionTasksReader -> Runtime Adapter -> Notion MCP`
* Runtime Adapter는 구현 교체 가능:
  * direct MCP client (Node 런타임이 직접 MCP 호출)
  * GPT + MCP tool client (앱은 GPT API만 호출하고, 모델이 MCP tool을 사용)
* 어떤 모드든 `Personal Tasks` 단일 databaseId 범위를 넘는 조회는 허용하지 않음

---

## 6. Agent Message Bus

에이전트 간 내부 통신을 담당하는 계층입니다.

### 책임

* 구조화된 요청 전달
* 구조화된 응답 반환
* 권한 및 접근 범위 검사
* 협업 체인 추적
* 중복 요청 및 무분별한 내부 대화 방지

### 메시지 원칙

에이전트 간 메시지는 자유 채팅이 아니라, **구조화된 request/response**여야 합니다.

### 예시 메시지 타입

* `info_request`
* `feasibility_check`
* `schedule_check`
* `priority_review`
* `context_summary_request`
* `risk_check`
* `escalation_to_user`

---

## 7. Speaker Arbitration Layer

에이전트가 사용자에게 언제, 어떻게 먼저 말할 수 있는지를 통제하는 계층입니다.

### 책임

* 업데이트를 긴급도 기준으로 분류
* 인터럽트 여부 결정
* 과도한 선제 발화 방지
* 사용자 focus / mute 상태 반영
* cooldown 및 묶음 처리 관리

### 알림 수준

* Urgent: 즉시 인터럽트 가능
* Important: 알림 / 배지
* Informational: inbox 누적

### 설계 원칙

선제 발화는 드물고, 의미 있고, 제어 가능해야 합니다.

---

## 8. Logging / Audit Layer

시스템의 주요 판단과 동작을 기록하는 계층입니다.

### 책임

* 어떤 에이전트가 요청을 처리했는지 기록
* 어떤 도구를 조회했는지 기록
* 어떤 에이전트들이 협업했는지 기록
* 어떤 memory를 읽거나 갱신했는지 기록
* confidence와 에스컬레이션 경로 기록
* 디버깅 및 신뢰 확보 지원

### 중요한 이유

멀티 에이전트 시스템은 추적 가능성이 없으면 신뢰하기 어렵습니다.

---

## 요청 처리 흐름

일반적인 요청 흐름:

1. 사용자가 특정 에이전트를 선택하거나 전체 데스크에 요청
2. Orchestrator가 주 응답 에이전트 결정
3. 해당 에이전트가 요청 해석
4. 공유 메모리 조회
5. 필요 시 외부 도구 조회
6. 필요 시 Agent Message Bus를 통해 다른 에이전트와 협업
7. 협업 결과 수신
8. 주 응답 에이전트가 최종 사용자 응답 생성
9. 필요한 memory 갱신
10. 전체 과정 로그 기록

---

## 선제 발화 흐름

일반적인 선제 발화 흐름:

1. 신호 감지 (마감 임박, 긴급 멘션, 회의 임박 등)
2. 관련 에이전트가 중요도 평가
3. Speaker Arbitration이 긴급도 결정
4. 시스템이 아래 중 하나를 선택:

   * 즉시 인터럽트
   * 알림/배지
   * inbox 누적
5. 사용자가 적절한 채널로 업데이트 확인
6. 해당 이벤트 로그 기록

---

## 주요 컴포넌트 시퀀스 (텍스트 기반 초안)

아래 다이어그램은 Mermaid 없이 plain text로 작성한 MVP 기준 시퀀스입니다. 모든 외부 연동은 read-only 조회만 수행합니다.

### Flow 1) 사용자가 서비스 기획 Agent에게 새 아이디어를 말하는 흐름

Participants:
`User | Desk UI | Orchestrator | Primary Agent(서비스 기획 Agent) | Secondary Agent(제품 운영 Agent, 개인 비서 Agent) | Shared Memory | Tool Connector | Agent Message Bus | Speaker Arbitration(bypass: user-initiated) | Logging / Audit Layer`

1. `User -> Desk UI`: 서비스 기획 Agent를 선택하고 새 아이디어를 입력한다.
2. `Desk UI -> Orchestrator`: 사용자 선택 에이전트와 요청 본문을 전달한다.
3. `Orchestrator -> Primary Agent`: 서비스 기획 Agent를 최종 화자로 고정하고 요청을 라우팅한다.
4. `Primary Agent -> Shared Memory`: 관련 idea/service/project memory를 조회한다.
5. `Primary Agent -> Tool Connector`: Slack/Notion/Web Search를 read-only로 조회해 아이디어 맥락을 보강한다.
6. `Primary Agent -> Agent Message Bus`: `feasibility_check`를 제품 운영 Agent에 요청한다.
7. `Agent Message Bus -> Secondary Agent(제품 운영 Agent)`: 요청 전달.
8. `Secondary Agent(제품 운영 Agent) -> Tool Connector`: Asana를 read-only 조회해 착수 가능성/리스크를 계산한다.
9. `Secondary Agent(제품 운영 Agent) -> Agent Message Bus`: 구조화된 response를 반환한다.
10. `Primary Agent -> Agent Message Bus`: `schedule_check`를 개인 비서 Agent에 요청한다.
11. `Agent Message Bus -> Secondary Agent(개인 비서 Agent)`: 요청 전달.
12. `Secondary Agent(개인 비서 Agent) -> Tool Connector`: Google Calendar를 read-only 조회해 사용자 검토 가능 시간창을 반환한다.
13. `Secondary Agent(개인 비서 Agent) -> Agent Message Bus`: 구조화된 response를 반환한다.
14. `Primary Agent -> Shared Memory`: 결과 요약과 근거 메모를 갱신한다.
15. `Primary Agent -> Orchestrator`: 단일 최종 응답 초안을 전달한다.
16. `Orchestrator -> Desk UI -> User`: 서비스 기획 Agent 명의로 최종 답변을 표시한다.
17. `Primary Agent/Orchestrator -> Logging / Audit Layer`: 조회 소스, 협업 체인, confidence, escalation 여부를 기록한다.
18. `Speaker Arbitration`: user-initiated 요청이므로 개입하지 않고 bypass 상태를 로그에 남긴다.

핵심 설계 포인트:
- 사용자가 지정한 Agent가 최종 화자를 유지하고, 협업은 내부 버스로만 수행한다.
- 외부 데이터는 read-only 조회 후 근거와 confidence를 분리해 반환한다.
- 사용자 요청 플로우에서도 감사 추적(협업 경로/소스/판단 근거)을 일관되게 남긴다.

### Flow 2) 사용자가 개인 비서 Agent에게 오늘 할 일을 묻는 흐름

Participants:
`User | Desk UI | Orchestrator | Primary Agent(개인 비서 Agent) | Secondary Agent(제품 운영 Agent, 서비스 기획 Agent) | Shared Memory | Tool Connector | Agent Message Bus | Speaker Arbitration(bypass: user-initiated) | Logging / Audit Layer`

1. `User -> Desk UI`: 개인 비서 Agent에게 "오늘 뭐부터 해야 해?"를 요청한다.
2. `Desk UI -> Orchestrator`: 요청과 현재 사용자 컨텍스트를 전달한다.
3. `Orchestrator -> Primary Agent`: 개인 비서 Agent를 주 응답자로 지정한다.
4. `Primary Agent -> Tool Connector`: Google Calendar를 read-only 조회해 오늘 일정/집중 가능 구간을 가져온다.
5. `Primary Agent -> Tool Connector`: Notion DB row/page와 Slack(멘션 신호)을 read-only 조회한다.
6. `Primary Agent -> Shared Memory`: 최근 personal task summary cache와 project summary memory를 조회한다.
7. `Primary Agent -> Agent Message Bus`: 제품 운영 Agent에 `risk_check`를 요청한다.
8. `Secondary Agent(제품 운영 Agent) -> Tool Connector`: Asana를 read-only 조회해 오늘 미루면 커지는 리스크를 계산한다.
9. `Secondary Agent(제품 운영 Agent) -> Agent Message Bus`: 리스크 응답을 반환한다.
10. `Primary Agent -> Agent Message Bus`: 서비스 기획 Agent에 `context_summary_request`를 보내 주요 회의 안건 맥락을 요청한다.
11. `Secondary Agent(서비스 기획 Agent) -> Shared Memory/Tool Connector`: 관련 아이디어/문서 맥락을 read-only 조회한다.
12. `Secondary Agent(서비스 기획 Agent) -> Agent Message Bus`: 전략 맥락 요약 응답을 반환한다.
13. `Primary Agent -> Shared Memory`: Notion 기반 개인 업무 요약/참조 캐시(personal task summary cache)를 갱신한다.
14. `Primary Agent -> Orchestrator`: 지금/다음/나중 형식의 최종 응답을 전달한다.
15. `Orchestrator -> Desk UI -> User`: 개인 비서 Agent 명의로 단일 응답을 노출한다.
16. `Primary Agent/Orchestrator -> Logging / Audit Layer`: 사용된 소스, 협업 결과, 불확실성 라벨을 기록한다.
17. `Speaker Arbitration`: user-initiated 요청이므로 개입 없이 bypass 처리한다.

핵심 설계 포인트:
- 개인 실행 우선순위는 일정 사실(Calendar)과 운영 리스크(Asana)를 합쳐 결정한다.
- 개인 업무 원본은 Notion DB를 우선 조회하고, shared memory는 요약/참조 캐시로만 사용한다.
- 다중 에이전트 협업 후에도 사용자에게는 하나의 응답만 제공한다.
- 불확실성은 `needs_review` 등으로 명시하고 무리한 자동 실행은 하지 않는다.

### Flow 3) 제품 운영 Agent가 정오 브리핑을 선제 발화하는 흐름

Participants:
`User | Desk UI | Orchestrator | Primary Agent(제품 운영 Agent) | Secondary Agent(개인 비서 Agent, 서비스 기획 Agent) | Shared Memory | Tool Connector | Agent Message Bus | Speaker Arbitration | Logging / Audit Layer`

1. `Primary Agent(제품 운영 Agent)`: 정오 트리거에서 브리핑 후보 생성을 시작한다.
2. `Primary Agent -> Tool Connector`: Asana/Slack를 read-only 조회해 overdue, blocker, 임박 마감 신호를 수집한다.
3. `Primary Agent -> Shared Memory`: 최근 project summary와 이전 브리핑 히스토리를 조회한다.
4. `Primary Agent -> Agent Message Bus`: 개인 비서 Agent에 `user_attention_check` 요청(사용자 가용 시간/주의 신호 확인).
5. `Secondary Agent(개인 비서 Agent) -> Tool Connector`: Google Calendar/Slack을 read-only 조회해 사용자 주의 가능 구간을 반환한다.
6. `Secondary Agent(개인 비서 Agent) -> Agent Message Bus`: 구조화된 응답 반환.
7. `Primary Agent -> Agent Message Bus`: 서비스 기획 Agent에 `priority_review` 요청(전략 중요도 보정).
8. `Secondary Agent(서비스 기획 Agent) -> Shared Memory/Tool Connector`: 관련 서비스/아이디어 맥락을 read-only 조회 후 응답 반환.
9. `Primary Agent -> Orchestrator`: 브리핑 초안(핵심 리스크, confidence, escalation 필요 여부) 전달.
10. `Orchestrator -> Speaker Arbitration`: 선제 발화 후보를 urgent/important/informational로 심사 요청한다.
11. `Speaker Arbitration -> Orchestrator`: 사용자 mute/focus/cooldown 정책을 반영한 노출 방식(즉시 인터럽트/배지/inbox)을 반환한다.
12. `Orchestrator -> Desk UI`: 선택된 노출 채널로 브리핑을 전달한다.
13. `Desk UI -> User`: 제품 운영 Agent의 정오 브리핑을 표시한다.
14. `Primary Agent -> Shared Memory`: 브리핑 요약 및 후속 확인 포인트를 memory에 갱신한다.
15. `Orchestrator/Primary Agent -> Logging / Audit Layer`: 트리거 근거, arbitration 결정, 전달 채널, 사용자 노출 결과를 기록한다.

핵심 설계 포인트:
- 선제 발화는 Agent 단독 결정이 아니라 Speaker Arbitration 정책 통과 후 노출한다.
- read-only 데이터 기반 브리핑으로 MVP 안전성(무쓰기)을 유지한다.
- 브리핑 생성 근거와 노출 결정 로그를 함께 남겨 신뢰성과 디버깅 가능성을 확보한다.

---

## 아키텍처 제약

### 1. 하나의 최종 화자

내부적으로 여러 에이전트가 협업하더라도, 사용자에게 보이는 최종 응답은 하나의 지정된 화자만 전달해야 합니다.

### 2. 구조화된 협업

에이전트 간 통신은 타입이 있고, 경계가 있으며, 감사 가능해야 합니다.

### 3. 안전한 기본값

시스템은 외부 행동보다 읽기/요약을 우선해야 합니다.

### 4. 모듈형 연동

툴 커넥터는 교체 가능하고 테스트 가능해야 합니다.

### 5. 메모리는 도움이 되는 계층일 뿐

메모리는 연속성을 높여주지만, 외부 source of truth를 몰래 덮어써선 안 됩니다.

---

## 장기 확장 포인트

향후 아래로 확장할 수 있습니다.

* 승인 기반 쓰기 기능
* task 업데이트 제안
* 메시지 초안 생성
* 고급 요약 파이프라인
* 더 똑똑한 memory retrieval/ranking
* 일정 제안 엔진

이 확장은 기존 구조를 우회하지 않고, 같은 아키텍처 위에서 이루어져야 합니다.

## 아키텍처 목표

표면적으로는 사회적이고 협업적인 시스템처럼 느껴지되, 내부적으로는 기술적으로 절제되고 관리 가능한 구조를 만드는 것이 목표입니다.
