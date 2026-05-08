import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { GOAL_UPDATE_TOOL_NAME } from './constants.js'
import { UPDATE_GOAL_DESCRIPTION, UPDATE_GOAL_PROMPT } from './prompt.js'
import {
  type Goal,
  type GoalStatus,
  getGoal,
  saveGoal,
  goalResponseText,
} from './utils.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    status: z
      .enum(['complete'])
      .describe(
        'Required. Set to complete only when the objective is achieved and no required work remains.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    goal: z
      .object({
        goalId: z.string(),
        objective: z.string(),
        status: z.string(),
        tokenBudget: z.number().nullable(),
        tokensUsed: z.number(),
        timeUsedSeconds: z.number(),
      })
      .optional(),
    error: z.string().optional(),
    summary: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const GoalUpdateTool = buildTool({
  name: GOAL_UPDATE_TOOL_NAME,
  searchHint: 'mark current goal complete when achieved',
  maxResultSizeChars: 100_000,
  async description() {
    return UPDATE_GOAL_DESCRIPTION
  },
  async prompt() {
    return UPDATE_GOAL_PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'GoalUpdate'
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
  async call({ status }, _context) {
    const goal = await getGoal()

    if (!goal) {
      return {
        data: {
          success: false,
          error: 'No goal exists for this thread. Use create_goal to set one first.',
          summary:
            'No goal exists for this thread. Use create_goal to set one first.',
        },
      }
    }

    // Model can only set status to 'complete'
    // pause, resume, budget_limited are user/system controlled
    if (status !== 'complete') {
      return {
        data: {
          success: false,
          error:
            'update_goal can only mark the existing goal complete; pause, resume, and budget-limited status changes are controlled by the user or system.',
          summary:
            'update_goal can only mark the existing goal complete. Pause, resume, and budget-limit are user/system controlled.',
        },
      }
    }

    goal.status = 'complete' as GoalStatus
    goal.updatedAt = Date.now()
    await saveGoal(goal)

    return {
      data: {
        success: true,
        goal: {
          goalId: goal.goalId,
          objective: goal.objective,
          status: goal.status,
          tokenBudget: goal.tokenBudget,
          tokensUsed: goal.tokensUsed,
          timeUsedSeconds: goal.timeUsedSeconds,
        },
        summary: goalResponseText(goal),
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
