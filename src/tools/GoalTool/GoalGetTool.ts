import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { GOAL_GET_TOOL_NAME } from './constants.js'
import { GET_GOAL_DESCRIPTION, GET_GOAL_PROMPT } from './prompt.js'
import { getGoal, goalResponseText } from './utils.js'

const inputSchema = lazySchema(() => z.strictObject({}))
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    goal: z
      .object({
        goalId: z.string(),
        objective: z.string(),
        status: z.string(),
        tokenBudget: z.number().nullable(),
        tokensUsed: z.number(),
        timeUsedSeconds: z.number(),
      })
      .nullable(),
    summary: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const GoalGetTool = buildTool({
  name: GOAL_GET_TOOL_NAME,
  searchHint: 'get current goal status budget and token usage',
  maxResultSizeChars: 100_000,
  async description() {
    return GET_GOAL_DESCRIPTION
  },
  async prompt() {
    return GET_GOAL_PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'GoalGet'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  renderToolUseMessage() {
    return null
  },
  async call(_input, _context) {
    const goal = await getGoal()

    return {
      data: {
        goal: goal
          ? {
              goalId: goal.goalId,
              objective: goal.objective,
              status: goal.status,
              tokenBudget: goal.tokenBudget,
              tokensUsed: goal.tokensUsed,
              timeUsedSeconds: goal.timeUsedSeconds,
            }
          : null,
        summary: goalResponseText(goal),
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { summary } = content as Output
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: summary,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
