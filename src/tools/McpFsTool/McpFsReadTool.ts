import { z } from 'zod/v4'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { discoverTools, getMcpFsBaseDir } from '../../utils/mcpFilesystem.js'
import { join } from 'path'

const MCP_FS_READ_TOOL_NAME = 'mcpfs_read'

const inputSchema = lazySchema(() =>
  z.strictObject({
    tool: z.string().describe('Tool name to inspect: server/toolName (e.g., "github/issueCreate")'),
  }),
)

const outputSchema = lazySchema(() =>
  z.object({
    found: z.boolean(),
    tool: z.string(),
    server: z.string(),
    source: z.string(),
    description: z.string(),
    readOnly: z.boolean(),
  }),
)

export const McpFsReadTool = buildTool({
  name: MCP_FS_READ_TOOL_NAME,
  searchHint: 'read inspect tool definition typescript interface',
  maxResultSizeChars: 50_000,
  async description() {
    return 'Read and display a tool\'s TypeScript interface definition. This allows on-demand tool loading — only load the tools you need, when you need them (KV-cache friendly, Manus §3).'
  },
  async prompt() {
    return 'Use mcpfs_read to inspect a specific tool\'s TypeScript interface before using it. Read the .ts file to understand parameter types, return types, and JSDoc documentation. Then write code that imports and calls the tool via mcpfs_exec.'
  },
  get inputSchema() { return inputSchema() },
  get outputSchema() { return outputSchema() },
  userFacingName() { return 'McpFsRead' },
  isConcurrencySafe() { return true },
  isReadOnly() { return true },
  renderToolUseMessage() { return null },
  async call({ tool }, _context) {
    const entries = await discoverTools()
    const entry = entries.find(e => `${e.server}/${e.toolName}` === tool || e.toolName === tool)

    if (!entry || !existsSync(entry.tsFilePath)) {
      return {
        data: { found: false, tool, server: '', source: '', description: '', readOnly: false },
      }
    }

    let source: string
    try {
      source = await readFile(entry.tsFilePath, 'utf-8')
    } catch {
      return {
        data: { found: false, tool, server: entry.server, source: `[Cannot read ${entry.tsFilePath}]`, description: entry.description, readOnly: entry.readOnly },
      }
    }

    return {
      data: {
        found: true,
        tool: `${entry.server}/${entry.toolName}`,
        server: entry.server,
        source,
        description: entry.description,
        readOnly: entry.readOnly,
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const out = content as { found: boolean; tool: string; server: string; source: string; description: string; readOnly: boolean }
    if (!out.found) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: `Tool "${out.tool}" not found. Use mcpfs_discover to list available tools.` }
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `## ${out.tool}${out.readOnly ? ' [readonly]' : ''}\n\n${out.description}\n\n\`\`\`typescript\n${out.source}\n\`\`\`\n\nImport this tool in mcpfs_exec:\n\`\`\`typescript\nimport { ${out.tool.split('/')[1]} } from './servers/${out.server}/${out.tool.split('/')[1]}.js';\n\`\`\``,
    }
  },
} satisfies ToolDef<typeof inputSchema, { found: boolean; tool: string; server: string; source: string; description: string; readOnly: boolean }>)
