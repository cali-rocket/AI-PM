# Personal Task Conversation State

## Why this state exists

Personal Task Assistant supports follow-up conversation, not only one-shot queries.

Conversation State stores recent interaction context so the assistant can interpret
expressions like:

* "that task"
* "among these"
* "from here"

without forcing a full re-fetch every turn.

## What is stored

`ConversationState` stores minimal in-session working context:

* `lastUserMessage`
* `lastAgentSummary`
* `lastActionType`
* `lastActionMode`
* `lastReferencedTaskIds`
* `lastReferencedNotionPageIds`
* `lastTaskListSnapshot`
* `lastReasoningTopic`
* `lastActionContext` (compact summary of last action outcome)
* `updatedAt`

`LastActionContext` keeps only:

* action type
* used sources
* confidence
* referenced page ids
* summary

## What is not stored

* No new DB or persistent store
* No source-of-truth replacement data model
* No write-side state or approval tokens
* No expanded schema (priority/tag/etc.)

This is intentionally an in-memory, single-session working state.

## Source-of-truth boundary

Notion Personal Tasks remains source-of-truth.

Conversation State is only a helper cache for dialogue continuity.
It can assist interpretation, but it must not override Notion facts.

## Reducer and manager

`packages/agents/src/personal-task-conversation-state.ts` provides:

* `createInitialConversationState(...)`
* `reduceConversationState(...)`
* `mergeReferencedTasks(...)`
* `clearStaleActionContext(...)`
* `InMemoryPersonalTaskConversationStateManager`

Current stale-clear behavior is intentionally minimal (`TODO`) and can be tightened later.

## Update rules in MVP

* After `list_tasks`:
  * store `lastActionType = list_tasks`
  * update recent task/page references
  * refresh `lastTaskListSnapshot` when task rows are available
* After `get_task_detail`:
  * move target `pageId` to the front of recent references
  * keep follow-up context for "that task" style turns
* After reasoning-only response:
  * update `lastReasoningTopic`
  * update `lastAgentSummary`
* After clarification/blocked:
  * keep minimal continuity context
  * avoid introducing new misleading action state

## Runtime usage

Personal Assistant flow keeps this order:

1. Parse intent
2. Evaluate policy
3. Produce response (execute / approval pending / clarification / blocked / reasoning-only)
4. Reduce conversation state from turn inputs and response

This ensures every turn can feed the next turn's interpretation while preserving
read-first safety boundaries.
