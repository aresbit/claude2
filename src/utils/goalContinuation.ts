import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { getGoal, renderGoalContinuationPrompt, shouldIgnoreGoalForMode } from '../tools/GoalTool/utils.js'

/**
 * Check if auto-continuation should happen.
 * Returns the continuation prompt content blocks if:
 * - A goal exists and is 'active'
 * - No user input is pending (caller must check this)
 * - The goal hasn't already been continued this cycle
 * - Not in plan mode
 */
export interface ContinuationCandidate {
  goalId: string
  objective: string
  promptBlocks: ContentBlockParam[]
}

let lastContinuationGoalId: string | null = null
let continuationBlockedUntil: number = 0

export function resetContinuationState(): void {
  lastContinuationGoalId = null
  continuationBlockedUntil = 0
}

/**
 * Block auto-continuation for a specified duration (in ms).
 * Call when user provides input or a new task is started.
 */
export function blockContinuation(durationMs: number = 5000): void {
  continuationBlockedUntil = Date.now() + durationMs
}

/**
 * Returns a continuation candidate if the agent should auto-continue
 * pursuing the active goal. Returns null otherwise.
 *
 * Call this after a turn completes and before the next user input.
 */
export async function getContinuationCandidate(
  collaborationMode?: string,
): Promise<ContinuationCandidate | null> {
  // Don't continue if recently blocked
  if (Date.now() < continuationBlockedUntil) {
    return null
  }

  // Don't continue in plan mode
  if (shouldIgnoreGoalForMode(collaborationMode)) {
    return null
  }

  const goal = await getGoal()
  if (!goal) return null
  if (goal.status !== 'active') {
    lastContinuationGoalId = null
    return null
  }

  // Don't continue the same goal twice without user/tool activity
  if (goal.goalId === lastContinuationGoalId) {
    return null
  }

  const prompt = renderGoalContinuationPrompt(goal)

  lastContinuationGoalId = goal.goalId

  return {
    goalId: goal.goalId,
    objective: goal.objective,
    promptBlocks: [
      {
        type: 'text' as const,
        text: prompt,
      },
    ],
  }
}

/**
 * Call when user sends input or a non-goal tool modifies state.
 * Resets the "same goal" guard so continuation can fire again.
 */
export function onUserOrToolActivity(): void {
  lastContinuationGoalId = null
}
