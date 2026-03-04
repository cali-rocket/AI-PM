# Personal Task Action Schema

## Why this schema exists

Natural language should not be executed directly against source-of-truth systems.
For Personal Tasks, we first convert user input into a structured action intent,
then pass it through policy before execution.

This keeps behavior:

* auditable
* controllable
* compatible with Notion as source of truth

## Action types

`PersonalTaskActionType`

* `list_tasks`
* `get_task_detail`
* `create_task`
* `update_task`
* `unknown`
* `needs_clarification`

Slots (`PersonalTaskActionSlots`)

* `pageId?`
* `title?`
* `status?` (`not started` | `in progress` | `done`)
* `dueDate?`

## Policy split

`execute_now` (read):

* `list_tasks`
* `get_task_detail`

`approval_required` (write intent only in MVP):

* `create_task`
* `update_task`

`clarification_required`:

* `needs_clarification`

`blocked`:

* `unknown`

## `unknown` vs `needs_clarification`

`unknown`:

* intent cannot be mapped to supported personal-task actions

`needs_clarification`:

* intent class is known, but required fields are missing
* example: detail request without a target page id

## Hybrid conversation model

The assistant is not a command-only bot.
It uses a hybrid model:

1. Action layer
   * standard channel for data access/update intent
   * read calls hit Notion reader
   * write intents stay pending approval in MVP
2. Reasoning layer
   * handles follow-up natural conversation
   * can answer from recent action context without new tool calls
   * can decide to call action only when needed

## Why not force every message into an action

Many user turns are follow-up reasoning:

* "From that list, what can I finish quickly before I leave?"
* "Then what should I do next?"

These are better answered from recent task context.
Forcing a fresh action on every turn adds noise, cost, and latency.

## Conversation state and last action context

The assistant stores lightweight turn state:

* recent task rows referenced by latest action
* recent referenced Notion page ids
* last action intent/policy/result snapshot
* last assistant summary and user text

This state allows:

* follow-up reasoning without immediate extra reads
* detail follow-up disambiguation (for example, when multiple tasks were listed)
* consistent context carry-over across turns in the same conversation

## Current MVP write policy

Write execution is intentionally disabled.
`create_task` and `update_task` are recognized and tracked,
but execution mode is always `approval_required`.

This preserves the read-first safety model until explicit approval flow is implemented.

## Code location

* Action contracts: `packages/agents/src/personal-task-actions.ts`
* Policy gate contracts and rules: `packages/agents/src/personal-task-policy-gate.ts`
* Conversation state reducer/manager: `packages/agents/src/personal-task-conversation-state.ts`
* Hybrid assistant behavior: `packages/agents/src/personal-assistant-agent.ts`
