/**
 * Responsibility: minimal proactive-update arbitration rules.
 * This module classifies updates and decides interrupt/inbox behavior with cooldown hooks.
 */

import type { AgentType, NotificationLevel } from "../../../packages/core-types/src";
import type { ProactiveUpdate } from "./types";

export interface ArbitrationPolicy {
  mutedAgents: AgentType[];
  focusMode: boolean;
  cooldownSeconds: number;
}

export interface CooldownState {
  lastDeliveredAtByAgent: Partial<Record<AgentType, string>>;
}

export interface SpeakerArbitrator {
  classifyUpdate(update: ProactiveUpdate): NotificationLevel;
  shouldInterrupt(update: ProactiveUpdate, policy: ArbitrationPolicy): boolean;
  shouldSendToInbox(update: ProactiveUpdate, policy: ArbitrationPolicy): boolean;
  applyCooldown(
    update: ProactiveUpdate,
    policy: ArbitrationPolicy,
    state: CooldownState
  ): ProactiveUpdate | null;
}

export class MockSpeakerArbitrator implements SpeakerArbitrator {
  classifyUpdate(update: ProactiveUpdate): NotificationLevel {
    // TODO: Replace keyword checks with a policy/risk-based classifier.
    const summary = update.summary.toLowerCase();
    if (summary.includes("urgent") || summary.includes("긴급") || summary.includes("blocker")) {
      return "urgent";
    }
    if (summary.includes("important") || summary.includes("중요") || summary.includes("마감")) {
      return "important";
    }
    return update.level;
  }

  shouldInterrupt(update: ProactiveUpdate, policy: ArbitrationPolicy): boolean {
    const level = this.classifyUpdate(update);
    if (policy.mutedAgents.includes(update.from)) {
      return false;
    }
    if (policy.focusMode && level !== "urgent") {
      return false;
    }
    return level === "urgent";
  }

  shouldSendToInbox(update: ProactiveUpdate, policy: ArbitrationPolicy): boolean {
    if (policy.mutedAgents.includes(update.from)) {
      return false;
    }
    // TODO: Split badge vs inbox delivery as notification channels evolve.
    return !this.shouldInterrupt(update, policy);
  }

  applyCooldown(
    update: ProactiveUpdate,
    policy: ArbitrationPolicy,
    state: CooldownState
  ): ProactiveUpdate | null {
    const last = state.lastDeliveredAtByAgent[update.from];
    if (!last) {
      state.lastDeliveredAtByAgent[update.from] = update.createdAt;
      return update;
    }

    // TODO: Move time calculations to shared utility with timezone-safe handling.
    const diffSeconds =
      (new Date(update.createdAt).getTime() - new Date(last).getTime()) / 1000;
    if (diffSeconds < policy.cooldownSeconds) {
      return null;
    }

    state.lastDeliveredAtByAgent[update.from] = update.createdAt;
    return update;
  }
}
