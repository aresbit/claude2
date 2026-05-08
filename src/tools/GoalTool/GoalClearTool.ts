import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { GOAL_CLEAR_TOOL_NAME } from './constants.js'
import { deleteGoal, getGoal } from './utils.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    confirmation: z
      .boolean()
      .optional()
      .describe('Set to true to confirm clearing the goal.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    error: z.string().optional(),
    summary: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const GoalClearTool = buildTool({
  name: GOAL_CLEAR_TOOL_NAME,
  searchHint: 'clear delete the current goal',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Clear (delete) the current goal for this thread. Use only when the goal is complete or the user explicitly requests clearing.'
  },
  async prompt() {
    return 'Use clear_goal to delete the current goal when it is complete or the user asks to clear it. Only clear a goal when explicitly requested or after the goal has been marked complete.'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'GoalClear'
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  renderToolUseMessage() {
    return null
  },
  async call({ confirmation }, _context) {
    const goal = await getGoal()
    if (!goal) {
      return {
        data: {
          success: false,
          error: 'No goal exists for this thread.',
          summary: 'No goal exists for this thread.',
        },
      }
    }
    if (!confirmation) {
      return {
        data: {
          success: false,
          error: 'Confirmation required to clear goal.',
          summary: `Goal "${goal.objective}" exists. Set confirmation: true to clear it.`,
        },
      }
    }
    const cleared = await deleteGoal()
    return {
      data: {
        success: cleared,
        summary: cleared
          ? `Goal "${goal.objective}" has been cleared.`
          : 'Failed to clear goal.',
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { success, error, summary } = content as Output
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: success ? summary : `Failed: ${error}`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
