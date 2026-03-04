/**
 * Responsibility: policy gate between intent parsing and action execution
 * for Personal Task Assistant.
 *
 * Flow target:
 * Intent Parser -> Policy Gate -> Action Executor.
 *
 * Guardrails:
 * - Read actions can execute immediately.
 * - Write actions require approval in MVP.
 * - Unknown / blocked / clarification-needed intents do not execute.
 */

import type { ConfidenceLevel } from "../../core-types/src";
import {
  isReadAction,
  isWriteAction,
  type PersonalTaskActionIntent,
} from "./personal-task-actions";
import type { ConversationState } from "./personal-task-conversation-state";
import type { PersonalTaskIntentParseResult } from "./personal-task-intent-parser";

export type PolicyExecutionMode =
  | "execute_now"
  | "approval_required"
  | "blocked"
  | "clarification_required";

export interface PersonalTaskPolicyGateInput {
  parseResult: PersonalTaskIntentParseResult;
  conversationState?: ConversationState;
  requestedAt: string;
  userContext?: {
    userId?: string;
    requestId?: string;
    conversationId?: string;
  };
}

export interface PersonalTaskPolicyGateResult {
  mode: PolicyExecutionMode;
  isExecutable: boolean;
  requiresApproval: boolean;
  blockedReason?: string;
  clarificationQuestion?: string;
  resolvedActionIntent?: PersonalTaskActionIntent;
  confidence: ConfidenceLevel;
  policySummary: string;
  // False means this turn should not go through action execution.
  actionExecutionRequired: boolean;
}

export interface PersonalTaskPolicyGate {
  evaluate(input: PersonalTaskPolicyGateInput): PersonalTaskPolicyGateResult;
  canExecuteNow(result: PersonalTaskPolicyGateResult): boolean;
  requiresApproval(result: PersonalTaskPolicyGateResult): boolean;
  shouldBlock(result: PersonalTaskPolicyGateResult): boolean;
}

export class MockPersonalTaskPolicyGate implements PersonalTaskPolicyGate {
  evaluate(input: PersonalTaskPolicyGateInput): PersonalTaskPolicyGateResult {
    const { parseResult } = input;

    if (parseResult.mode === "reasoning_only") {
      return {
        mode: "blocked",
        isExecutable: false,
        requiresApproval: false,
        confidence: parseResult.confidence,
        policySummary:
          "No action execution required. Keep this turn in reasoning-only flow.",
        actionExecutionRequired: false,
      };
    }

    if (parseResult.mode === "needs_clarification") {
      return {
        mode: "clarification_required",
        isExecutable: false,
        requiresApproval: false,
        clarificationQuestion: parseResult.clarificationQuestion,
        confidence: parseResult.confidence,
        policySummary:
          "Intent parsing requires more user input before any action can run.",
        actionExecutionRequired: true,
      };
    }

    if (parseResult.mode === "blocked") {
      return {
        mode: "blocked",
        isExecutable: false,
        requiresApproval: false,
        blockedReason: parseResult.reasoningSummary,
        confidence: parseResult.confidence,
        policySummary: "Request is blocked by parser/policy constraints.",
        actionExecutionRequired: true,
      };
    }

    const actionIntent = parseResult.actionIntent;
    if (!actionIntent) {
      return {
        mode: "clarification_required",
        isExecutable: false,
        requiresApproval: false,
        clarificationQuestion:
          "I need one actionable intent first. Please clarify whether you want to list tasks or view details.",
        confidence: "needs_review",
        policySummary:
          "Parser returned action_required without an action intent payload.",
        actionExecutionRequired: true,
      };
    }

    if (actionIntent.action === "needs_clarification") {
      return {
        mode: "clarification_required",
        isExecutable: false,
        requiresApproval: false,
        resolvedActionIntent: {
          ...actionIntent,
          requiresApproval: false,
          canExecuteImmediately: false,
        },
        clarificationQuestion:
          parseResult.clarificationQuestion ??
          "I need one more detail before I can proceed.",
        confidence: parseResult.confidence,
        policySummary: "Action intent still requires clarification before execution.",
        actionExecutionRequired: true,
      };
    }

    if (actionIntent.action === "unknown") {
      return {
        mode: "blocked",
        isExecutable: false,
        requiresApproval: false,
        resolvedActionIntent: {
          ...actionIntent,
          requiresApproval: false,
          canExecuteImmediately: false,
        },
        blockedReason: "Intent could not be mapped to a supported Personal Task action.",
        confidence: parseResult.confidence,
        policySummary: "Unknown action intents are blocked and never executed.",
        actionExecutionRequired: true,
      };
    }

    if (isReadAction(actionIntent.action)) {
      return {
        mode: "execute_now",
        isExecutable: true,
        requiresApproval: false,
        resolvedActionIntent: {
          ...actionIntent,
          requiresApproval: false,
          canExecuteImmediately: true,
        },
        confidence: parseResult.confidence,
        policySummary: "Read action allowed for immediate execution in read-first MVP.",
        actionExecutionRequired: true,
      };
    }

    if (isWriteAction(actionIntent.action)) {
      return {
        mode: "approval_required",
        isExecutable: false,
        requiresApproval: true,
        resolvedActionIntent: {
          ...actionIntent,
          requiresApproval: true,
          canExecuteImmediately: false,
        },
        confidence: parseResult.confidence,
        policySummary:
          "Write action detected. MVP policy keeps write execution approval-pending.",
        actionExecutionRequired: true,
      };
    }

    return {
      mode: "blocked",
      isExecutable: false,
      requiresApproval: false,
      resolvedActionIntent: {
        ...actionIntent,
        requiresApproval: false,
        canExecuteImmediately: false,
      },
      blockedReason: "Unsupported action type for current Personal Task policy.",
      confidence: parseResult.confidence,
      policySummary: "Fallback block for unsupported action intents.",
      actionExecutionRequired: true,
    };
  }

  canExecuteNow(result: PersonalTaskPolicyGateResult): boolean {
    return result.actionExecutionRequired && result.mode === "execute_now" && result.isExecutable;
  }

  requiresApproval(result: PersonalTaskPolicyGateResult): boolean {
    return (
      result.actionExecutionRequired &&
      result.mode === "approval_required" &&
      result.requiresApproval
    );
  }

  shouldBlock(result: PersonalTaskPolicyGateResult): boolean {
    return result.actionExecutionRequired && result.mode === "blocked";
  }
}
