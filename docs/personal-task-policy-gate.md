# Personal Task Policy Gate

## Why split Policy Gate from Intent Parser

Intent parsing and execution permission are different responsibilities.

* Intent Parser explains what the user appears to want.
* Policy Gate decides whether that intent can run now, must wait for approval, needs clarification, or must be blocked.

By separating them, we get:

* clearer boundaries between understanding and enforcement
* easier policy changes without touching parser heuristics
* better auditability of read-first controls

## Execution modes

`PolicyExecutionMode`

* `execute_now`: action is safe and executable immediately
* `approval_required`: action is recognized but must wait for explicit approval
* `clarification_required`: action cannot run until missing user input is resolved
* `blocked`: action is disallowed by policy

## Read-first mapping in MVP

Current minimal policy rules:

* `action_required` + read action (`list_tasks`, `get_task_detail`) -> `execute_now`
* `action_required` + write action (`create_task`, `update_task`) -> `approval_required`
* `needs_clarification` -> `clarification_required`
* `blocked` -> `blocked`
* `unknown` action intent -> `blocked`

This keeps Notion Personal Tasks usage read-first and prevents write execution in MVP.

## Reasoning-only turns

`reasoning_only` parse outputs are intentionally not sent to the action executor.

Policy Gate marks these turns as `actionExecutionRequired: false`, so orchestration can:

1. skip action execution
2. return to agent reasoning flow
3. produce one final user-facing response from the designated agent

This preserves conversational follow-up behavior while keeping execution controls explicit.

## Runtime position

Pipeline:

1. Intent Parser
2. Policy Gate
3. Branch
4. Action Executor (only when allowed)
5. Single-agent final response

This keeps enforcement centralized and execution paths explicit.

## Code locations

* Intent parse contracts: `packages/agents/src/personal-task-intent-parser.ts`
* Policy gate contracts and mock rules: `packages/agents/src/personal-task-policy-gate.ts`
* Action contracts: `packages/agents/src/personal-task-actions.ts`
* Conversation state reducer/manager: `packages/agents/src/personal-task-conversation-state.ts`
* Agent orchestration flow: `packages/agents/src/personal-assistant-agent.ts`
