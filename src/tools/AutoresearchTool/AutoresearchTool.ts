import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { runAgent } from '../AgentTool/runAgent.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import type { ToolCallProgress } from '../../Tool.js'
import { GENERAL_PURPOSE_AGENT } from '../AgentTool/built-in/generalPurposeAgent.js'
import { createUserMessage } from '../../utils/messages.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    goal: z.string().describe('The goal to achieve (e.g., increase test coverage)'),
    scope: z.string().optional().describe('File glob pattern defining which files can be modified'),
    metric: z.string().optional().describe('Mechanical metric to measure improvement (e.g., coverage percentage)'),
    verify: z.string().optional().describe('Command that produces the metric value'),
    iterations: z.number().optional().describe('Number of iterations to run (default: unlimited)'),
    guard: z.string().optional().describe('Guard command that must always pass'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean().describe('Whether the autoresearch was successfully started'),
    message: z.string().describe('Status message'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const AutoresearchTool = buildTool({
  name: 'autoresearch',
  searchHint: 'autonomous research optimization loop',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Launch an autonomous research optimization loop that iteratively improves code based on a measurable metric.'
  },
  async prompt() {
    return 'Autoresearch tool: launches an autonomous research optimization loop that iteratively improves code based on a measurable metric. Use this tool to automate code improvements, refactoring, or optimization with measurable outcomes.'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.message,
      is_error: !output.success,
    }
  },
  async call(input, context, canUseTool, parentMessage, onProgress) {
    const {
      goal,
      scope,
      metric,
      verify,
      iterations = 10,
      guard,
    } = input

    // Build prompt for the autoresearch agent
    let prompt = `Please conduct an autonomous research optimization loop with the following parameters:\n`
    prompt += `Goal: ${goal}\n`
    if (scope) prompt += `Scope: ${scope}\n`
    if (metric) prompt += `Metric to optimize: ${metric}\n`
    if (verify) prompt += `Verification command: ${verify}\n`
    if (guard) prompt += `Guard command that must always pass: ${guard}\n`
    prompt += `Iterations: ${iterations}\n\n`
    prompt += `You should iteratively improve the codebase to achieve the goal, measuring progress using the metric and verification command. `
    prompt += `Each iteration should make incremental changes, then verify the metric improves (or at least doesn't regress). `
    prompt += `If a guard command is provided, ensure it passes after each change. `
    prompt += `After completing all iterations or reaching optimal performance, provide a summary of changes made and final metric value.`

    // Create user message for the agent
    const userMessage = createUserMessage(prompt)

    // Use general-purpose agent
    const agentDefinition = GENERAL_PURPOSE_AGENT

    // Collect messages from the agent
    const agentMessages: Message[] = []

    try {
      // Run the agent
      for await (const message of runAgent({
        agentDefinition,
        promptMessages: [userMessage],
        toolUseContext: context,
        canUseTool,
        isAsync: false,
        querySource: 'agent:custom',
        model: undefined,
        availableTools: context.options.tools,
        override: { agentId: `autoresearch-${Date.now()}` },
      })) {
        agentMessages.push(message)

        // Report progress if needed
        if (onProgress && (message.type === 'assistant' || message.type === 'user')) {
          // Simplified progress reporting
          onProgress({
            toolUseID: `autoresearch_${parentMessage?.message.id || 'unknown'}`,
            data: {
              message,
              type: 'autoresearch_progress',
              iteration: agentMessages.length,
            },
          })
        }
      }

      // Extract result text from agent messages
      let resultText = ''
      for (const msg of agentMessages) {
        if (msg.type === 'assistant' && msg.message.content) {
          const content = msg.message.content
          if (typeof content === 'string') {
            resultText += content
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text') {
                resultText += block.text
              }
            }
          }
        }
      }

      if (!resultText.trim()) {
        resultText = 'Autoresearch completed but no summary was provided by the agent.'
      }

      return {
        success: true,
        message: `Autoresearch loop completed. Results:\n${resultText}`,
      }
    } catch (error) {
      return {
        success: false,
        message: `Autoresearch failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
})
