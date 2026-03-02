# shared-memory

공유 메모리 모델과 저장소 인터페이스를 정의합니다.

외부 source-of-truth를 대체하지 않고, 작업 기억 계층으로 동작하도록 설계합니다.
특히 개인 업무는 Notion DB가 원본이며, shared memory의 개인 업무 데이터는 요약/참조/캐시 용도입니다.
