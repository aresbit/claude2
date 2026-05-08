import { readFile, readdir, mkdir, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { spawn } from 'child_process'

/**
 * Filesystem-Based MCP Engine
 * ============================
 * Replaces RPC-based MCP (tools/list + tools/call over JSON-RPC) with
 * pure filesystem operations: discovery by scanning manifest files,
 * execution by spawning subprocesses.
 *
 * Philosophy (from Manus §4: Filesystem as Context):
 *   "The filesystem is the ultimate context: unbounded in size, naturally
 *   persistent, and directly operable by the agent."
 *
 * Architecture:
 *   ~/.claude/mcp-tools/
 *   ├── registry.json          ← Index of discovered tools
 *   ├── servers/
 *   │   ├── <server-name>/
 *   │   │   ├── manifest.json  ← Tool definitions (name, schema, command)
 *   │   │   ├── <tool>.sh      ← Executable script (optional)
 *   │   │   └── ...
 *   └── cache/                 ← Execution result cache
 */

// ── Types ────────────────────────────────────────────────────────

export interface McpFsToolDef {
  name: string
  description: string
  inputSchema?: Record<string, unknown>
  /** Shell command to execute. Args passed via env vars ($ARGNAME). */
  command: string
  /** Environment variable names to pass as tool args */
  env?: string[]
  /** Alternative: script path relative to server directory */
  script?: string
  /** Annotations */
  readOnly?: boolean
  destructive?: boolean
}

export interface McpFsManifest {
  server: string
  version: string
  description?: string
  tools: McpFsToolDef[]
}

export interface McpFsRegistryEntry {
  server: string
  toolName: string
  description: string
  manifestPath: string
  command: string
  inputSchema?: Record<string, unknown>
  readOnly: boolean
  destructive: boolean
}

// ── Paths ────────────────────────────────────────────────────────

function getMcpFsBaseDir(): string {
  return join(getClaudeConfigHomeDir(), 'mcp-fs')
}

function getServersDir(): string {
  return join(getMcpFsBaseDir(), 'servers')
}

function getCacheDir(): string {
  return join(getMcpFsBaseDir(), 'cache')
}

function getRegistryPath(): string {
  return join(getMcpFsBaseDir(), 'registry.json')
}

// ── Discovery: Filesystem Scan ───────────────────────────────────

/**
 * Scan the servers directory for manifest.json files and build
 * a registry of all available tools. This replaces `tools/list` RPC.
 *
 * From Manus §3 (Masking, Not Removing):
 * Tool definitions should be stable (not dynamically added/removed mid-turn)
 * to preserve KV-cache integrity. Filesystem manifests achieve this by
 * being static files that change only on explicit user action.
 */
export async function discoverTools(): Promise<McpFsRegistryEntry[]> {
  const serversDir = getServersDir()
  if (!existsSync(serversDir)) {
    return []
  }

  const entries: McpFsRegistryEntry[] = []
  let serverDirs: string[]
  try {
    serverDirs = await readdir(serversDir)
  } catch {
    return []
  }

  for (const serverName of serverDirs) {
    const serverDir = join(serversDir, serverName)
    const manifestPath = join(serverDir, 'manifest.json')
    if (!existsSync(manifestPath)) continue

    try {
      const manifestContent = await readFile(manifestPath, 'utf-8')
      const manifest = jsonParse(manifestContent) as McpFsManifest

      for (const tool of manifest.tools) {
        entries.push({
          server: manifest.server || serverName,
          toolName: tool.name,
          description: tool.description,
          manifestPath,
          command: tool.command,
          inputSchema: tool.inputSchema,
          readOnly: tool.readOnly ?? false,
          destructive: tool.destructive ?? false,
        })
      }
    } catch (err) {
      // Skip broken manifests — preserve what we can discover
      console.error(`[mcp-fs] Failed to parse manifest: ${manifestPath}`, err)
    }
  }

  // Write registry for inspection
  await mkdir(getMcpFsBaseDir(), { recursive: true })
  await writeFile(getRegistryPath(), jsonStringify(entries, 2))

  return entries
}

/**
 * Get a single tool definition by fully qualified name: server/toolName
 */
export async function getTool(name: string): Promise<McpFsRegistryEntry | null> {
  const tools = await discoverTools()
  return tools.find(t => `${t.server}/${t.toolName}` === name || t.toolName === name) || null
}

/**
 * Read the cached registry (fast path, no filesystem scan).
 */
export async function getRegistry(): Promise<McpFsRegistryEntry[]> {
  const registryPath = getRegistryPath()
  if (!existsSync(registryPath)) {
    return discoverTools()
  }
  try {
    const content = await readFile(registryPath, 'utf-8')
    return jsonParse(content) as McpFsRegistryEntry[]
  } catch {
    return []
  }
}

// ── Execution: Code Execution (Subprocess Spawn) ──────────────────

export interface McpFsExecutionResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number
  cached: boolean
  cacheKey?: string
}

/**
 * Execute a tool by spawning its command as a subprocess.
 * Tool arguments are passed as environment variables.
 *
 * This replaces `tools/call` RPC with direct shell execution.
 * Results are cached in the filesystem for recovery.
 *
 * From Manus §6 (Preserving Error Context):
 * "Keep failed attempts in context. When the model sees a failed action
 * and its resulting observation or stack trace, it implicitly updates
 * its internal beliefs."
 *
 * Both stdout and stderr are preserved in the result — errors are
 * evidence, not exceptions.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  options?: {
    cwd?: string
    timeoutMs?: number
    env?: Record<string, string>
    signal?: AbortSignal
  },
): Promise<McpFsExecutionResult> {
  const tool = await getTool(toolName)
  if (!tool) {
    return {
      success: false,
      stdout: '',
      stderr: `Tool not found: ${toolName}. Discovered tools: ${(await getRegistry()).map(t => `${t.server}/${t.toolName}`).join(', ')}`,
      exitCode: 127,
      cached: false,
    }
  }

  const cacheKey = `${tool.server}_${tool.toolName}_${jsonStringify(args)}`
  const cachePath = join(getCacheDir(), `${Buffer.from(cacheKey).toString('base64').replace(/[/+=]/g, '_').substring(0, 64)}.json`)

  // Check cache
  if (existsSync(cachePath)) {
    try {
      const cached = jsonParse(await readFile(cachePath, 'utf-8')) as McpFsExecutionResult
      return { ...cached, cached: true }
    } catch {
      // Cache corrupted, re-execute
    }
  }

  // Build environment
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...options?.env,
    MCP_TOOL_NAME: toolName,
    MCP_TOOL_SERVER: tool.server,
    MCP_TOOL_DIR: resolve(getServersDir(), tool.server),
  }

  // Pass args as MCP_ARG_* env vars
  for (const [key, value] of Object.entries(args)) {
    const envKey = `MCP_ARG_${key.toUpperCase()}`
    env[envKey] = typeof value === 'string' ? value : jsonStringify(value)
  }

  if (tool.env) {
    for (const envName of tool.env) {
      const value = args[envName] ?? args[envName.toLowerCase()]
      if (value !== undefined) {
        env[envName] = typeof value === 'string' ? value : jsonStringify(value)
      }
    }
  }

  // Execute
  const serverDir = resolve(getServersDir(), tool.server)
  const cwd = options?.cwd || serverDir
  const timeoutMs = options?.timeoutMs || 300_000 // 5 min default

  try {
    const result = await spawnWithTimeout(tool.command, env, cwd, timeoutMs, options?.signal)

    // Cache the result
    await mkdir(getCacheDir(), { recursive: true })
    await writeFile(cachePath, jsonStringify(result))

    return { ...result, cached: false }
  } catch (err) {
    const errorResult: McpFsExecutionResult = {
      success: false,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
      exitCode: -1,
      cached: false,
    }
    return errorResult
  }
}

/**
 * Spawn a shell command with timeout and abort signal support.
 */
function spawnWithTimeout(
  command: string,
  env: Record<string, string>,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<McpFsExecutionResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', command], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 5000)
        resolve({
          success: false,
          stdout,
          stderr: stderr + '\n[TIMEOUT] Tool execution exceeded ' + timeoutMs + 'ms',
          exitCode: -1,
          cached: false,
        })
      }
    }, timeoutMs)

    if (signal) {
      signal.addEventListener('abort', () => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          child.kill('SIGTERM')
          resolve({
            success: false,
            stdout,
            stderr: stderr + '\n[ABORTED] Tool execution was aborted',
            exitCode: -1,
            cached: false,
          })
        }
      })
    }

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    child.on('error', (err) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(err)
      }
    })

    child.on('close', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({
          success: code === 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code ?? -1,
          cached: false,
        })
      }
    })
  })
}

// ── Scaffolding: Create Example Server ───────────────────────────

/**
 * Scaffold an example MCP filesystem server to demonstrate the pattern.
 */
export async function scaffoldExampleServer(): Promise<string> {
  const serversDir = getServersDir()
  const exampleDir = join(serversDir, 'example-tools')
  await mkdir(exampleDir, { recursive: true })

  const manifest: McpFsManifest = {
    server: 'example-tools',
    version: '1.0.0',
    description: 'Example MCP filesystem tools — demonstrates the pattern',
    tools: [
      {
        name: 'echo',
        description: 'Echo back the input message',
        command: 'echo "{\\"message\\": \\"$MCP_ARG_MESSAGE\\"}"',
        readOnly: true,
      },
      {
        name: 'list-files',
        description: 'List files in a directory',
        command: 'ls -la "${MCP_ARG_DIR:-.}"',
        readOnly: true,
      },
      {
        name: 'write-note',
        description: 'Write a note to a file in the workspace',
        command: 'mkdir -p ./notes && echo "$MCP_ARG_CONTENT" > "./notes/$MCP_ARG_FILENAME" && echo "{\\"written\\": \\"./notes/$MCP_ARG_FILENAME\\"}"',
        destructive: true,
      },
    ],
  }

  const manifestPath = join(exampleDir, 'manifest.json')
  await writeFile(manifestPath, jsonStringify(manifest, 2))

  return exampleDir
}
