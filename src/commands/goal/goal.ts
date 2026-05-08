import type { LocalCommandCall } from '../../types/command.js'
import {
  createGoal,
  getGoal,
  saveGoal,
  pauseGoal,
  resumeGoal,
  clearGoal,
  goalResponseText,
  validateGoalObjective,
} from '../../tools/GoalTool/utils.js'

export const call: LocalCommandCall = async (args, _context) => {
  const trimmedArgs = args.trim()

  // /goal (no args) — show current goal status
  if (!trimmedArgs) {
    const goal = await getGoal()
    const status = goalResponseText(goal)
    return { type: 'text', value: status + '\n' }
  }

  // /goal pause
  if (trimmedArgs === 'pause') {
    const goal = await getGoal()
    if (!goal) {
      return { type: 'text', value: 'No goal is currently set. Use /goal <objective> to create one.\n' }
    }
    if (goal.status === 'paused') {
      return { type: 'text', value: `Goal is already paused: "${goal.objective}"\n` }
    }
    const updated = await pauseGoal()
    if (updated) {
      return { type: 'text', value: `Goal paused: "${updated.objective}"\nUse /goal resume to continue.\n` }
    }
    return { type: 'text', value: 'Failed to pause goal.\n' }
  }

  // /goal resume
  if (trimmedArgs === 'resume') {
    const goal = await getGoal()
    if (!goal) {
      return { type: 'text', value: 'No goal is currently set. Use /goal <objective> to create one.\n' }
    }
    if (goal.status === 'active') {
      return { type: 'text', value: `Goal is already active: "${goal.objective}"\n` }
    }
    const updated = await resumeGoal()
    if (updated) {
      return { type: 'text', value: `Goal resumed: "${updated.objective}"\n` }
    }
    return { type: 'text', value: 'Failed to resume goal.\n' }
  }

  // /goal clear
  if (trimmedArgs === 'clear') {
    const goal = await getGoal()
    if (!goal) {
      return { type: 'text', value: 'No goal is currently set.\n' }
    }
    const cleared = await clearGoal()
    if (cleared) {
      return { type: 'text', value: `Goal cleared: "${goal.objective}"\n` }
    }
    return { type: 'text', value: 'Failed to clear goal.\n' }
  }

  // /goal <objective> — create a new goal
  const validationError = validateGoalObjective(trimmedArgs)
  if (validationError) {
    return { type: 'text', value: `Failed to create goal: ${validationError}\n` }
  }

  const existing = await getGoal()
  if (existing) {
    return {
      type: 'text',
      value: `A goal already exists: "${existing.objective}" (${existing.status})\nUse /goal clear first, or /goal pause to pause it.\n`,
    }
  }

  const goal = createGoal(trimmedArgs)
  await saveGoal(goal)

  return {
    type: 'text',
    value: `Goal created and active: "${goal.objective}"\nToken budget: ${goal.tokenBudget !== null ? goal.tokenBudget.toLocaleString() : 'none'}\n\nCommands: /goal pause | /goal resume | /goal clear | /goal\n`,
  }
}
