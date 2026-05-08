import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { executeCode, discoverTools } from '../../utils/mcpFilesystem.js'

const MCP_FS_EXEC_TOOL_NAME = 'mcpfs_exec'

const inputSchema = lazySchema(() =>
  z.strictObject({
    code: z.string().describe('TypeScript code to execute. Import tools from ./servers/<server>/<tool>.js. Use console.log() to output results. Only console.log output reaches the model — intermediate values stay in the sandbox.'),
    timeoutMs: z.number().optional().default(300_000).describe('Execution timeout in ms (default 5 minutes)'),
  }),
)

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
  }),
)

export const McpFsExecTool = buildTool({
  name: MCP_FS_EXEC_TOOL_NAME,
  searchHint: 'execute typescript code sandbox import tools call mcp',
  maxResultSizeChars: 500_000,
  async description() {
    const entries = await discoverTools()
    const servers = [...new Set(entries.map(e => e.server))]
    const imports = servers.map(s => `import * as ${toCamelCase(s)} from './servers/${s}/index.js';`).join('\n')

    if (entries.length === 0) {
      return `Execute agent-written TypeScript code in an isolated Bun sandbox. Only console.log() output reaches the model — intermediate results stay in the execution environment (98.7% token reduction per Anthropic). Use mcpfs_discover to find available tools first.`
    }

    return `Execute TypeScript code that imports and calls MCP tools from the filesystem.\n\nAvailable servers: ${servers.join(', ')} (${entries.length} tools)\n\nImport pattern:\n\`\`\`typescript\n${imports}\n\`\`\`\n\nOnly console.log() output reaches the model. Use mcpfs_read to inspect individual tool interfaces.`
  },
  async prompt() {
    const entries = await discoverTools()
    const servers = [...new Set(entries.map(e => e.server))]
    return `Execute agent-written TypeScript code in a sandbox. Servers: ${servers.join(', ')}. Import tools from ./servers/<server>/<tool>.js. The sandbox runs your code and returns ONLY console.log() output — all intermediate tool results stay in the sandbox and save tokens.`
  },
  get inputSchema() { return inputSchema() },
  get outputSchema() { return outputSchema() },
  userFacingName() { return 'McpFsExec' },
  isConcurrencySafe() { return false },
  isReadOnly() { return false },
  renderToolUseMessage() { return null },
  async call({ code, timeoutMs }, context) {
    const result = await executeCode(code, {
      timeoutMs,
      signal: context.abortController.signal,
    })

    return {
      data: {
        success: result.success,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const out = content as { success: boolean; stdout: string; stderr: string; exitCode: number }
    const parts: string[] = []
    if (out.stdout) parts.push(out.stdout)
    if (!out.success && out.stderr) {
      parts.push(`\n<!-- Execution errors (not in context unless logged): -->\nStderr (exit ${out.exitCode}):\n${out.stderr}`)
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: parts.join('\n') || `Code executed with exit code ${out.exitCode}`,
    }
  },
} satisfies ToolDef<typeof inputSchema, { success: boolean; stdout: string; stderr: string; exitCode: number }>)

function toCamelCase(s: string): string {
  return s.replace(/[-_]([a-z])/g, (_, c) => (c as string).toUpperCase())
}
