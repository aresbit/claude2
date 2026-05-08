import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  discoverTools,
  executeTool,
  getRegistry,
  type McpFsRegistryEntry,
} from '../../utils/mcpFilesystem.js'

const MCP_FS_TOOL_NAME = 'mcpfs'

const inputSchema = lazySchema(() =>
  z.strictObject({
    tool: z.string().describe('Fully qualified tool name: server/toolName (e.g., "github/issue-create")'),
    args: z.record(z.string(), z.unknown()).optional().default({}).describe('Tool arguments as key-value pairs'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    tool: z.string(),
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
    cached: z.boolean(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const McpFsTool = buildTool({
  name: MCP_FS_TOOL_NAME,
  searchHint: 'execute tools discovered from filesystem manifests',
  maxResultSizeChars: 500_000,
  async description() {
    const tools = await getRegistry()
    if (tools.length === 0) {
      return 'Execute tools discovered from filesystem manifests. No tools currently registered — place manifest.json files in ~/.claude/mcp-fs/servers/<server>/ to add tools.'
    }
    const toolList = tools.map(t => `- ${t.server}/${t.toolName}: ${t.description}`).join('\n')
    return `Execute tools discovered from filesystem manifests. Available tools (${tools.length}):\n${toolList}`
  },
  async prompt() {
    const tools = await getRegistry()
    if (tools.length === 0) {
      return 'No filesystem MCP tools available. Use mcpfs_discover to scan for tools, or place tool manifests in the filesystem.'
    }
    return `Filesystem MCP tools available: ${tools.map(t => `${t.server}/${t.toolName}`).join(', ')}. Use mcpfs with the tool name and args to execute.`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'McpFs'
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
  async call({ tool, args }, context) {
    const result = await executeTool(tool, args || {}, {
      signal: context.abortController.signal,
    })

    return {
      data: {
        success: result.success,
        tool,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        cached: result.cached,
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const out = content as Output
    const lines: string[] = []

    if (out.cached) {
      lines.push(`[cached] ${out.tool}`)
    }

    if (out.success) {
      lines.push(out.stdout || `Tool ${out.tool} completed successfully (exit 0)`)
    } else {
      lines.push(`Tool ${out.tool} failed (exit ${out.exitCode})`)
      if (out.stderr) lines.push(`\nStderr:\n${out.stderr}`)
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: lines.join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
