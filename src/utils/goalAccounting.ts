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

/**
 * Creates a goal query tracker that extracts token usage from
 * query() stream events. Use around direct query() calls that
 * aren't wrapped by QueryEngine (e.g., REPL mode, background tasks).
 *
 * Usage:
 *   const tracker = createGoalQueryTracker()
 *   await markTurnStart(0).catch(() => {})
 *   for await (const event of query({...})) {
 *     tracker.processStreamEvent(event)
 *     yield event
 *   }
 *   await markTurnEnd(tracker.getTotalTokens()).catch(() => {})
 */
export function createGoalQueryTracker() {
  let inputTokens = 0
  let outputTokens = 0

  return {
    processStreamEvent(event: unknown): void {
      if (
        event &&
        typeof event === 'object' &&
        'type' in event &&
        (event as any).type === 'stream_event'
      ) {
        const ev = (event as any).event
        if (ev?.type === 'message_start' && ev.message?.usage) {
          inputTokens = ev.message.usage.input_tokens || 0
        }
        if (ev?.type === 'message_delta' && ev.usage) {
          outputTokens = ev.usage.output_tokens || 0
        }
      }
    },
    getTotalTokens(): number {
      return inputTokens + outputTokens
    },
    reset(): void {
      inputTokens = 0
      outputTokens = 0
    },
  }
}
