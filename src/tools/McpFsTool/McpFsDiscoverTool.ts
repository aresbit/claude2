import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { discoverTools, scaffoldExampleServer, type McpFsRegistryEntry } from '../../utils/mcpFilesystem.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { join } from 'path'

const MCP_FS_DISCOVER_TOOL_NAME = 'mcpfs_discover'

const inputSchema = lazySchema(() =>
  z.strictObject({
    scaffold: z.boolean().optional().default(false).describe('Set to true to scaffold an example MCP filesystem server'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    tools: z.array(z.object({
      name: z.string(),
      server: z.string(),
      description: z.string(),
      command: z.string(),
      readOnly: z.boolean(),
    })),
    count: z.number(),
    baseDir: z.string(),
    scaffolded: z.boolean().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const McpFsDiscoverTool = buildTool({
  name: MCP_FS_DISCOVER_TOOL_NAME,
  searchHint: 'discover tools from filesystem mcp-fs manifests',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Scan the filesystem for MCP tool manifests. Discovers tools defined in manifest.json files under ~/.claude/mcp-fs/servers/. Use scaffold=true to create example tools.'
  },
  async prompt() {
    return 'Use mcpfs_discover to scan for available filesystem MCP tools. If no tools are found, call with scaffold=true to create example tools.'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'McpFsDiscover'
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
  async call({ scaffold }, _context) {
    let scaffolded: string | undefined

    if (scaffold) {
      scaffolded = await scaffoldExampleServer()
    }

    const tools = await discoverTools()
    const baseDir = join(getClaudeConfigHomeDir(), 'mcp-fs')

    return {
      data: {
        tools: tools.map(t => ({
          name: `${t.server}/${t.toolName}`,
          server: t.server,
          description: t.description,
          command: t.command,
          readOnly: t.readOnly,
        })),
        count: tools.length,
        baseDir,
        ...(scaffolded ? { scaffolded } : {}),
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const out = content as Output
    if (out.count === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `No filesystem MCP tools discovered in ${out.baseDir}/servers/. Use scaffold=true to create example tools, or place manifest.json files in ${out.baseDir}/servers/<server-name>/.${out.scaffolded ? `\n\nExample server scaffolded at: ${out.scaffolded}` : ''}`,
      }
    }

    const lines = [
      `Discovered ${out.count} filesystem MCP tools in ${out.baseDir}/servers/:`,
      '',
      ...out.tools.map(t => `- **${t.name}**${t.readOnly ? ' [readonly]' : ''}: ${t.description}\n  Command: \`${t.command}\``),
      '',
      `Use mcpfs tool with tool="${out.tools[0]?.name}" args={...} to execute.`,
    ]

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: lines.join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
