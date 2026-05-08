import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  discoverAndGenerate,
  discoverTools,
  getMcpFsBaseDir,
} from '../../utils/mcpFilesystem.js'

const MCP_FS_DISCOVER_TOOL_NAME = 'mcpfs_discover'

const inputSchema = lazySchema(() =>
  z.strictObject({
    regenerate: z.boolean().optional().default(false).describe('Regenerate all .ts wrapper files from manifests'),
  }),
)

const outputSchema = lazySchema(() =>
  z.object({
    tools: z.array(z.object({
      name: z.string(),
      server: z.string(),
      description: z.string(),
      tsFile: z.string(),
      readOnly: z.boolean(),
    })),
    count: z.number(),
    baseDir: z.string(),
    filesGenerated: z.number().optional(),
  }),
)

export const McpFsDiscoverTool = buildTool({
  name: MCP_FS_DISCOVER_TOOL_NAME,
  searchHint: 'discover tools from filesystem mcp-fs servers directory',
  maxResultSizeChars: 100_000,
  async description() {
    const entries = await discoverTools()
    if (entries.length === 0) {
      return `Discover MCP tools from the filesystem. Scans ${getMcpFsBaseDir()}/servers/ for tool definitions (.ts files and manifest.json).`
    }
    return `Discover MCP tools from the filesystem. Currently ${entries.length} tools available across ${new Set(entries.map(e => e.server)).size} servers.`
  },
  async prompt() {
    return 'Use mcpfs_discover to list available filesystem MCP tools. Use mcpfs_read to inspect a tool\'s interface. Use mcpfs_exec to execute agent code that calls these tools.'
  },
  get inputSchema() { return inputSchema() },
  get outputSchema() { return outputSchema() },
  userFacingName() { return 'McpFsDiscover' },
  isConcurrencySafe() { return true },
  isReadOnly() { return true },
  renderToolUseMessage() { return null },
  async call({ regenerate }, _context) {
    let entries, filesWritten
    if (regenerate) {
      const result = await discoverAndGenerate()
      entries = result.entries
      filesWritten = result.filesWritten
    } else {
      entries = await discoverTools()
      const { filesWritten: fw } = await import('../../utils/mcpFilesystem.js').then(m => m.generateToolFiles(entries))
      filesWritten = fw
    }

    const baseDir = getMcpFsBaseDir()

    return {
      data: {
        tools: entries.map(t => ({
          name: `${t.server}/${t.toolName}`,
          server: t.server,
          description: t.description,
          tsFile: t.tsFilePath,
          readOnly: t.readOnly,
        })),
        count: entries.length,
        baseDir,
        filesGenerated: filesWritten.length,
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const out = content as { tools: Array<{ name: string; description: string; readOnly: boolean }>; count: number; baseDir: string; filesGenerated?: number }
    if (out.count === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `No tools discovered in ${out.baseDir}/servers/.\n\nUse scaffold=true to create example tools, or place manifest.json files in ${out.baseDir}/servers/<server-name>/.`,
      }
    }
    const lines = [
      `Discovered ${out.count} tools in ${out.baseDir}/servers/:`,
      '',
      ...out.tools.map(t => `- **${t.name}**${t.readOnly ? ' [ro]' : ''}: ${t.description}`),
      '',
      `Use **mcpfs_read** tool="${out.tools[0]?.name}" to inspect a tool's TypeScript interface.`,
      `Use **mcpfs_exec** to execute agent code that imports and calls these tools.`,
      out.filesGenerated ? `\n${out.filesGenerated} .ts wrapper files generated.` : '',
    ]
    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<typeof inputSchema, { tools: Array<{ name: string; server: string; description: string; tsFile: string; readOnly: boolean }>; count: number; baseDir: string; filesGenerated?: number }>)
