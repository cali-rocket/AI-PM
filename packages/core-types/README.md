# core-types

모든 앱/패키지에서 공통으로 사용하는 도메인 타입과 계약을 정의합니다.

비즈니스 로직 없이 `type`/`interface` 중심으로 유지합니다.

개인 업무 도메인에서는 Notion DB를 source of truth로 두고, shared memory의 개인 업무 타입은 요약/참조/캐시 표현으로만 사용합니다.
