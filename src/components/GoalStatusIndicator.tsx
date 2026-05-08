import React, { useEffect, useState } from 'react'
import { Box, Text } from '../ink.js'
import { getGoal, formatGoalStatus, formatTime, formatTokens, type Goal } from '../tools/GoalTool/utils.js'

interface Props {
  refreshIntervalMs?: number
}

export function GoalStatusIndicator({ refreshIntervalMs = 5000 }: Props) {
  const [goal, setGoal] = useState<Goal | null>(null)

  useEffect(() => {
    let mounted = true
    let timer: ReturnType<typeof setInterval> | null = null

    async function refresh() {
      try {
        const g = await getGoal()
        if (mounted) setGoal(g)
      } catch {
        // Goal storage may not be ready
      }
    }

    refresh()
    timer = setInterval(refresh, refreshIntervalMs)

    return () => {
      mounted = false
      if (timer) clearInterval(timer)
    }
  }, [refreshIntervalMs])

  if (!goal) return null

  const statusLabel = formatGoalStatus(goal.status)
  const statusColor = statusColors[goal.status] ?? 'white'

  let usageStr: string
  if (goal.tokenBudget !== null) {
    const pct = Math.round((goal.tokensUsed / goal.tokenBudget) * 100)
    usageStr = `${formatTokens(goal.tokensUsed)} / ${formatTokens(goal.tokenBudget)} (${pct}%)`
  } else {
    usageStr = `${formatTokens(goal.tokensUsed)} tokens · ${formatTime(goal.timeUsedSeconds)}`
  }

  return (
    <Box flexDirection="row">
      <Text dimColor>Goal: </Text>
      <Text>{truncate(goal.objective, 60)}</Text>
      <Text dimColor> · </Text>
      <Text color={statusColor}>{statusLabel}</Text>
      <Text dimColor> · </Text>
      <Text>{usageStr}</Text>
    </Box>
  )
}

const statusColors: Record<string, string> = {
  active: 'green',
  paused: 'yellow',
  budget_limited: 'red',
  complete: 'blue',
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.substring(0, maxLen - 3) + '...'
}

/** Returns a plain-text status line for use outside Ink (e.g., tmux) */
export async function getGoalStatusLine(): Promise<string | null> {
  try {
    const goal = await getGoal()
    if (!goal) return null

    const shortObj = goal.objective.length > 40
      ? goal.objective.substring(0, 37) + '...'
      : goal.objective

    const label = formatGoalStatus(goal.status)

    if (goal.tokenBudget !== null) {
      const pct = Math.round((goal.tokensUsed / goal.tokenBudget) * 100)
      return `[goal: ${label}] ${shortObj} ${formatTokens(goal.tokensUsed)}/${formatTokens(goal.tokenBudget)} (${pct}%)`
    }

    return `[goal: ${label}] ${shortObj} ${formatTokens(goal.tokensUsed)} tok · ${formatTime(goal.timeUsedSeconds)}`
  } catch {
    return null
  }
}
