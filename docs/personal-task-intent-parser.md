# Personal Task Intent Parser

## Why not parse every message into an action

Personal Task Assistant is a hybrid conversational agent, not a command-only bot.
Some turns need data access actions, but many follow-up turns can be answered from
recent context.

Forcing action on every turn causes:

- unnecessary tool calls
- higher latency/cost
- worse conversational flow

## Handling modes

`IntentHandlingMode`

- `action_required`
- `reasoning_only`
- `needs_clarification`
- `blocked`

### `action_required`

Use when a turn clearly needs data access.

Examples:

- "진행 중인 업무 보여줘"
- "그 업무 상세 보여줘" (target is resolvable via pageId or recent context)

### `reasoning_only`

Use when a turn is a contextual follow-up and can be answered from conversation state.

Examples:

- "여기서 오늘 퇴근 전에 빨리 끝낼만한 게 뭐야?"
- "이 중에서 먼저 보면 좋은 건 뭐야?"

### `needs_clarification`

Use when intent is partially clear but required fields are missing.

Example:

- "그거 자세히 보여줘" but there is no target task/pageId in context

### `blocked`

Use when current policy disallows direct handling.

Example:

- request to bypass write approval

## Coexistence of conversation and actions

1. Follow-up resolver checks deictic references first (`그 업무`, `이 중에서`, `여기서`).
2. Parser decides handling mode when follow-up resolver does not already resolve the turn.
3. If `action_required`, go to:
   - action schema
   - policy gate
   - action executor
4. If `reasoning_only`, answer from conversation state without new tool call.
5. If `needs_clarification` or `blocked`, return safe prompt/notice and do not execute.

Write actions are still approval-pending only in MVP.

## Conversation state role

Conversation state stores:

- recent task rows
- recent referenced page ids
- last action intent/policy/result
- last task body snapshot (if detail was fetched)

This allows natural follow-up reasoning while preserving action safety boundaries.

## Current implementation scope

Current parser is a rule-based mock behind an interface:

- `parseUserInput(...)`
- `shouldUseAction(...)`
- `shouldUseConversationState(...)`

Follow-up deictic resolution is handled by a separate module:

- `packages/agents/src/personal-task-follow-up-resolver.ts`

In real `notion_api` mode, parser output is unchanged, but action execution is resolved
against live Notion data (Personal Tasks DB) and not mock fixtures.
