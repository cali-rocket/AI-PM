# Personal Task Follow-Up Resolution

## Why this rule layer is needed

Personal Task Assistant receives context-dependent follow-up turns such as:

- "그 업무"
- "그거"
- "이 업무"
- "여기서"
- "이 중에서"
- "방금 본 것 중에"

These turns are hard to process safely without explicit reference resolution.
A lightweight resolver improves continuity while keeping behavior auditable.

## Follow-up cues

Current rule-based cues include:

- `single_task_deictic`: `그 업무`, `그거`, `이 업무`, `that task`, `this task`
- `subset_deictic`: `여기서`, `이 중에서`, `방금 본 것 중에`, `among these`, `from those`
- `last_result_deictic`: `직전 결과`, `방금 본 것`, `last result`, `previous result`
- `detail_request`: `상세`, `자세히`, `본문`, `detail`, `show detail`, `page body`

## Reference types

`FollowUpReferenceType`

- `last_task`: one recent task is clearly referenced
- `task_list_subset`: latest list snapshot is referenced as a group/subset
- `last_result`: the previous assistant result is referenced
- `ambiguous`: multiple candidates exist and target is unclear
- `none`: no stable follow-up mapping is available

## Resolution behavior

- If reference is clear and answer can be derived from conversation state:
  - process as reasoning-only
- If reference is clear but detail body is requested:
  - build a `get_task_detail` action intent for the resolved page id
  - send through Policy Gate (`execute_now` read path)
- If reference is ambiguous:
  - convert to clarification response
- If no context is available:
  - return `none` and continue normal intent parsing

## Clarification switch conditions

Clarification is triggered when:

- deictic single-task cue exists, but multiple recent tasks exist
- subset cue exists with multiple candidates and detail target is not uniquely resolvable
- user asks for detail but follow-up target cannot be pinned to exactly one task

## Example flow

1. "진행 중인 업무 보여줘" -> list action executes and list snapshot is stored.
2. "이 중에서 오늘 퇴근 전에 빨리 끝낼만한 게 뭐야?" -> `task_list_subset` resolves and reasoning-only response uses conversation state.
3. "그 업무 상세 보여줘" -> resolver maps to one recent task (`last_task`) and agent calls `get_task_detail`.
4. "그거 자세히" with several recent candidates -> resolver marks `ambiguous` and agent asks clarification.

## Scope boundary

- This resolver is heuristic-only (not full NLP)
- It is applied only inside Personal Task Assistant
- Notion Personal Tasks remains source-of-truth
- Conversation state remains a working reference layer
- In real `notion_api` mode, resolved references should map to actual Notion page ids from the latest action result
