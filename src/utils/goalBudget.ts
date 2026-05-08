import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import {
  getGoal,
  setGoalBudgetLimited,
  renderGoalBudgetLimitPrompt,
  type Goal,
} from '../tools/GoalTool/utils.js'

export interface BudgetCheckResult {
  goal: Goal | null
  /** Warning prompt when budget nearly exhausted (>= warnAtPct) */
  warningPrompt: string | null
  /** Steering blocks to inject when budget is fully exhausted */
  steeringBlocks: ContentBlockParam[] | null
  /** Whether auto-continuation should be blocked */
  blockContinuation: boolean
}

let budgetLimitReportedGoalId: string | null = null

export function resetBudgetState(): void {
  budgetLimitReportedGoalId = null
}

/**
 * Check the goal's token budget and return steering actions.
 * Call after accounting goal usage. The accounting functions already
 * transition the goal to budget_limited when budget is exceeded;
 * this produces the model-visible steering prompts.
 */
export async function checkGoalBudget(
  warnAtPct: number = 0.85,
): Promise<BudgetCheckResult> {
  const goal = await getGoal()

  if (!goal) {
    return { goal: null, warningPrompt: null, steeringBlocks: null, blockContinuation: false }
  }

  // Already budget_limited — inject steering prompt once
  if (goal.status === 'budget_limited') {
    if (goal.goalId === budgetLimitReportedGoalId) {
      return { goal, warningPrompt: null, steeringBlocks: null, blockContinuation: true }
    }
    budgetLimitReportedGoalId = goal.goalId
    const prompt = renderGoalBudgetLimitPrompt(goal)
    return {
      goal,
      warningPrompt: null,
      steeringBlocks: [{ type: 'text' as const, text: prompt }],
      blockContinuation: true,
    }
  }

  budgetLimitReportedGoalId = null

  // Active goal with token budget: check thresholds
  if (goal.status === 'active' && goal.tokenBudget !== null && goal.tokenBudget > 0) {
    const pctUsed = goal.tokensUsed / goal.tokenBudget

    if (pctUsed >= 1.0) {
      await setGoalBudgetLimited()
      const updated = await getGoal()
      if (updated) {
        budgetLimitReportedGoalId = updated.goalId
      }
      return {
        goal: updated,
        warningPrompt: null,
        steeringBlocks: updated
          ? [{ type: 'text' as const, text: renderGoalBudgetLimitPrompt(updated) }]
          : null,
        blockContinuation: true,
      }
    }

    if (pctUsed >= warnAtPct) {
      const remaining = goal.tokenBudget - goal.tokensUsed
      const warning = `Note: Goal token budget is ${Math.round(pctUsed * 100)}% consumed (${remaining.toLocaleString()} tokens remaining). Consider prioritizing remaining work.`
      return { goal, warningPrompt: warning, steeringBlocks: null, blockContinuation: false }
    }
  }

  return { goal, warningPrompt: null, steeringBlocks: null, blockContinuation: false }
}

/**
 * Format a budget status summary for display (e.g., status line).
 */
export function formatBudgetStatus(goal: Goal | null): string {
  if (!goal) return 'No goal set'
  if (goal.tokenBudget === null) {
    return `Goal: ${goal.objective.substring(0, 50)} | Tokens: ${goal.tokensUsed.toLocaleString()} | Time: ${formatShortTime(goal.timeUsedSeconds)}`
  }
  const pct = Math.round((goal.tokensUsed / goal.tokenBudget) * 100)
  const remaining = Math.max(0, goal.tokenBudget - goal.tokensUsed)
  return `Goal: ${goal.objective.substring(0, 50)} | ${goal.tokensUsed.toLocaleString()} / ${goal.tokenBudget.toLocaleString()} (${pct}%) | ${remaining.toLocaleString()} remaining`
}

function formatShortTime(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rm = minutes % 60
  if (rm === 0) return `${hours}h`
  return `${hours}h ${rm}m`
}
