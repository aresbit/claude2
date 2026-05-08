import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { executeToolSimple, discoverTools } from '../../utils/mcpFilesystem.js'

const MCP_FS_TOOL_NAME = 'mcpfs'

const inputSchema = lazySchema(() =>
  z.strictObject({
    tool: z.string().describe('Tool name: server/toolName (e.g., "github/issueCreate")'),
    args: z.record(z.string(), z.unknown()).optional().default({}).describe('Tool arguments as key-value pairs'),
  }),
)

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    tool: z.string(),
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
  }),
)

export const McpFsTool = buildTool({
  name: MCP_FS_TOOL_NAME,
  searchHint: 'execute single mcp tool direct subprocess',
  maxResultSizeChars: 500_000,
  async description() {
    const entries = await discoverTools()
    const list = entries.length > 0
      ? entries.map(e => `${e.server}/${e.toolName}`).join(', ')
      : 'none'
    return `Execute a single MCP filesystem tool directly via subprocess. Available tools: ${list}. Prefer mcpfs_exec for complex workflows — it keeps intermediate results out of context.`
  },
  async prompt() {
    return 'Use mcpfs for single tool calls. For multi-step workflows with loops, conditionals, or data filtering, prefer mcpfs_exec which executes agent-written code in a sandbox and only returns console.log output.'
  },
  get inputSchema() { return inputSchema() },
  get outputSchema() { return outputSchema() },
  userFacingName() { return 'McpFs' },
  isConcurrencySafe() { return false },
  isReadOnly() { return false },
  renderToolUseMessage() { return null },
  async call({ tool, args }, context) {
    const result = await executeToolSimple(tool, args || {}, {
      signal: context.abortController.signal,
    })
    return {
      data: {
        success: result.success,
        tool,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const out = content as { success: boolean; tool: string; stdout: string; stderr: string; exitCode: number }
    if (out.success) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: out.stdout || `${out.tool} completed (exit 0)` }
    }
    return { tool_use_id: toolUseID, type: 'tool_result', content: `${out.tool} failed (exit ${out.exitCode})\n${out.stderr}` }
  },
} satisfies ToolDef<typeof inputSchema, { success: boolean; tool: string; stdout: string; stderr: string; exitCode: number }>)
