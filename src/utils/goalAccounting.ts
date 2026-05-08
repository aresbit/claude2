import { getGoal, accountGoalUsage, type Goal } from '../tools/GoalTool/utils.js'
import { getSessionId } from '../bootstrap/state.js'

/**
 * Tracks goal usage accounting across turns. Maintains a baseline
 * to compute deltas (tokens consumed since last accounting call).
 */
export interface GoalAccountingState {
  lastTokenCount: number
  lastAccountedAt: number // Date.now() ms
  activeGoalId: string | null
}

let accountingState: GoalAccountingState = {
  lastTokenCount: 0,
  lastAccountedAt: Date.now(),
  activeGoalId: null,
}

export function resetGoalAccounting(): void {
  accountingState = {
    lastTokenCount: 0,
    lastAccountedAt: Date.now(),
    activeGoalId: null,
  }
}

export function getGoalAccountingState(): Readonly<GoalAccountingState> {
  return accountingState
}

/**
 * Call at the start of each turn to capture the token baseline
 * and check if a goal is active.
 */
export async function markTurnStart(tokenCount: number): Promise<void> {
  accountingState.lastTokenCount = tokenCount
  accountingState.lastAccountedAt = Date.now()

  const goal = await getGoal()
  if (goal && goal.status === 'active') {
    accountingState.activeGoalId = goal.goalId
  } else {
    accountingState.activeGoalId = null
  }
}

/**
 * Call after each tool completes or at turn end to account
 * token and time usage against the active goal.
 * Returns the updated goal, or null if no active goal.
 */
export async function accountProgress(
  currentTokenCount: number,
): Promise<Goal | null> {
  const tokenDelta = currentTokenCount - accountingState.lastTokenCount
  const now = Date.now()
  const timeDeltaSeconds = Math.floor(
    (now - accountingState.lastAccountedAt) / 1000,
  )

  if (tokenDelta <= 0 && timeDeltaSeconds <= 0) {
    return null
  }

  if (!accountingState.activeGoalId) {
    accountingState.lastTokenCount = currentTokenCount
    accountingState.lastAccountedAt = now
    return null
  }

  const sessionId = getSessionId() as string
  const goal = await accountGoalUsage(sessionId, tokenDelta, timeDeltaSeconds)

  if (goal) {
    accountingState.lastTokenCount = currentTokenCount
    accountingState.lastAccountedAt = now

    if (goal.status !== 'active') {
      accountingState.activeGoalId = null
    }
  }

  return goal
}

/**
 * Call when a turn ends to do final accounting.
 */
export async function markTurnEnd(
  currentTokenCount: number,
): Promise<Goal | null> {
  return accountProgress(currentTokenCount)
}
