#!/usr/bin/env bun
/**
 * ChatWise → MCP-FS Scanner
 * ==========================
 * Reads ChatWise SQLite DB, extracts MCP server configs and tool definitions,
 * generates MCP-FS manifest.json files in ~/.claude/mcp-fs/servers/<name>/.
 *
 * Also imports Alma MCP config (~/.config/alma/mcp.json).
 *
 * Usage:
 *   bun run scripts/chatwise-to-mcpfs.ts
 *
 * Environment:
 *   CHATWISE_DB_PATH — override ChatWise DB location (default: ~/Library/.../app.db)
 *   MCP_FS_DIR       — override MCP-FS base dir (default: ~/.claude/mcp-fs)
 *   DRY_RUN=true     — dry run, only report what would be done
 */

import { readFile, writeFile, mkdir, copyFile } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { homedir, hostname } from 'os';
import { spawnSync } from 'child_process';

// ── Config ──────────────────────────────────────────────────────────

const CHATWISE_DB = process.env.CHATWISE_DB_PATH ||
  join(homedir(), 'Library/Application Support/app.chatwise/app.db');

const MCP_FS_DIR = process.env.MCP_FS_DIR || join(homedir(), '.claude/mcp-fs');
const SERVERS_DIR = join(MCP_FS_DIR, 'servers');
const BRIDGE_SRC = join(dirname(import.meta.path), '..', 'src', 'utils', 'mcpBridge.mjs');
const BRIDGE_DST = join(MCP_FS_DIR, 'bridge.mjs');
const DRY_RUN = process.env.DRY_RUN === 'true';

// ── Config Source Name ──────────────────────────────────────────────

function srcName(s: string): string {
  return `[${s}]`;
}

// ── Helpers ─────────────────────────────────────────────────────────

function sanitizeServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
}

/** Parse ChatWise env string like "KEY1=val1\nKEY2=val2" → object */
function parseEnvString(envStr: string | undefined | null): Record<string, string> | undefined {
  if (!envStr || !envStr.trim()) return undefined;
  const result: Record<string, string> = {};
  for (const line of envStr.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      result[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Split "npx -y foo --bar" → { command: "npx", args: ["-y", "foo", "--bar"] } */
function splitCommand(cmd: string): { command: string; args: string[] } {
  // Handle Windows-style paths in commands
  const parts = cmd.match(/(?:[^\s"]+|"[^"]*")+/g) || [cmd];
  const cleaned = parts.map(p => p.replace(/^"(.*)"$/, '$1'));
  return { command: cleaned[0]!, args: cleaned.slice(1) };
}

/**
 * Escape a string for single-quoted shell usage.
 * Follows the same pattern as cacheToEntries() in mcpFilesystem.ts.
 */
function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
}

/**
 * Build a bridge command for a tool.
 * This creates a shell command that runs bridge.mjs with the server config and tool name.
 */
function buildBridgeCommand(
  serverConfig: Record<string, unknown>,
  toolName: string,
  bridgePath: string,
): string {
  const configJson = JSON.stringify(serverConfig);
  const escapedConfig = shellEscape(configJson);
  const escapedTool = shellEscape(toolName);
  return `BRIDGE_SERVER_CONFIG='${escapedConfig}' BRIDGE_TOOL='${escapedTool}' node "${bridgePath}"`;
}

// ── Database Query ──────────────────────────────────────────────────

function queryChatWise(): Array<{
  displayId: string;
  config: string;
  lastFetchedTools: string;
}> {
  if (!existsSync(CHATWISE_DB)) {
    console.error(`ChatWise DB not found at: ${CHATWISE_DB}`);
    return [];
  }

  const result = spawnSync('sqlite3', [
    '-separator', '|||',
    CHATWISE_DB,
    `SELECT displayId, config, IFNULL(lastFetchedTools, '')
     FROM tool
     WHERE enabled = 1
       AND lastFetchedTools IS NOT NULL
       AND lastFetchedTools != ''
       AND lastFetchedTools != '{}'
     ORDER BY displayId`,
  ], { encoding: 'utf-8', maxBuffer: 100 * 1024 * 1024 });

  if (result.error || result.status !== 0) {
    console.error(`Failed to query ChatWise DB: ${result.stderr?.trim() || result.error?.message}`);
    return [];
  }

  const rows: Array<{ displayId: string; config: string; lastFetchedTools: string }> = [];
  for (const line of result.stdout.trim().split('\n')) {
    if (!line.trim()) continue;
    const sepIdx = line.indexOf('|||');
    if (sepIdx === -1) continue;
    const rest = line.slice(sepIdx + 3);
    const sepIdx2 = rest.indexOf('|||');
    if (sepIdx2 === -1) continue;

    rows.push({
      displayId: line.slice(0, sepIdx),
      config: rest.slice(0, sepIdx2),
      lastFetchedTools: rest.slice(sepIdx2 + 3),
    });
  }

  return rows;
}

// ── Manifest Generation ─────────────────────────────────────────────

interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpFsManifest {
  server: string;
  version: string;
  description?: string;
  tools: Array<{
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    command?: string;
    mcpServer?: string;
    mcpToolName?: string;
    readOnly?: boolean;
    destructive?: boolean;
  }>;
}

function parseToolsFromChatWise(raw: string): ToolDef[] {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.tools && Array.isArray(parsed.tools)) {
      return parsed.tools.map((t: any) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || t.input_schema || undefined,
      }));
    }
    return [];
  } catch {
    return [];
  }
}

function generateManifest(params: {
  serverName: string;
  displayName: string;
  config: Record<string, unknown>;
  tools: ToolDef[];
  bridgePath: string;
}): McpFsManifest | null {
  const { serverName, displayName, config, tools, bridgePath } = params;
  if (tools.length === 0) return null;

  const manifestTools = tools.map(t => {
    const command = buildBridgeCommand(config, t.name, bridgePath);
    return {
      name: t.name,
      description: t.description || `MCP tool: ${displayName}/${t.name}`,
      inputSchema: t.inputSchema,
      command,
      readOnly: false as const,
      destructive: false as const,
    };
  });

  return {
    server: serverName,
    version: '1.0.0',
    description: `MCP server: ${displayName} (imported from ChatWise)`,
    tools: manifestTools,
  };
}

// ── Alma Config Import ──────────────────────────────────────────────

async function importAlmaConfig(serversDir: string, bridgePath: string): Promise<number> {
  const almaPaths = [
    join(homedir(), '.config/alma/mcp.json'),
    join(homedir(), '.config/alma/Alma/mcp.json'),
  ];

  let almaConfigPath = '';
  for (const p of almaPaths) {
    if (existsSync(p)) { almaConfigPath = p; break; }
  }
  if (!almaConfigPath) return 0;

  let imported = 0;
  try {
    const content = await readFile(almaConfigPath, 'utf-8');
    const parsed = JSON.parse(content);
    const servers = parsed.mcpServers || parsed.servers || {};
    if (typeof servers !== 'object') return 0;

    for (const [name, cfg] of Object.entries(servers)) {
      const serverConfig = cfg as Record<string, unknown>;
      // Prefix with alma- to avoid conflicts on case-insensitive filesystems
      // (e.g., ChatWise "fetch" vs Alma "Fetch")
      const safeName = `alma-${sanitizeServerName(name)}`;
      const serverDir = join(serversDir, safeName);

      // Determine the transport config for the bridge
      const bridgeConfig: Record<string, unknown> = {};
      if (serverConfig.url) {
        bridgeConfig.type = 'http';
        bridgeConfig.url = serverConfig.url;
        if (serverConfig.headers) bridgeConfig.headers = serverConfig.headers;
      } else {
        bridgeConfig.type = 'stdio';
        const cmd = serverConfig.command as string || '';
        const args = (serverConfig.args as string[]) || [];
        bridgeConfig.command = cmd;
        bridgeConfig.args = args;
        if (serverConfig.env) bridgeConfig.env = serverConfig.env;
      }

      // We need to probe this server for tools.
      // Use the bridge to do a tools/list call.
      const tools = await probeServer(bridgeConfig);
      if (tools.length === 0) {
        // Create a placeholder with a single "alma-import" tool
        const manifest: McpFsManifest = {
          server: safeName,
          version: '1.0.0',
          description: `MCP server: ${name} (imported from Alma)`,
          tools: [{
            name: `call_${safeName}`,
            description: `Call the ${name} MCP tool. Imported from Alma config.`,
            command: buildBridgeCommand(bridgeConfig, '', bridgePath),
            readOnly: false,
            destructive: false,
          }],
        };
        await writeManifest(serverDir, manifest);
        imported++;
        continue;
      }

      const manifest: McpFsManifest = {
        server: safeName,
        version: '1.0.0',
        description: `MCP server: ${name} (imported from Alma)`,
        tools: tools.map(t => ({
          name: t.name,
          description: t.description || `MCP tool: ${name}/${t.name}`,
          inputSchema: t.inputSchema,
          command: buildBridgeCommand(bridgeConfig, t.name, bridgePath),
          readOnly: false,
          destructive: false,
        })),
      };
      await writeManifest(serverDir, manifest);
      imported++;
    }
  } catch (err) {
    console.error(`  ${srcName('Alma')} Error: ${err}`);
  }

  return imported;
}

async function probeServer(config: Record<string, unknown>): Promise<ToolDef[]> {
  const bridgePath = BRIDGE_DST;
  if (!existsSync(bridgePath)) return [];

  const configJson = JSON.stringify(config);
  const result = spawnSync('node', [bridgePath], {
    env: {
      ...process.env as Record<string, string>,
      BRIDGE_SERVER_CONFIG: configJson,
      BRIDGE_TOOL: '',
    },
    encoding: 'utf-8',
    timeout: 30000,
  });

  if (result.error || result.status !== 0) return [];

  try {
    const parsed = JSON.parse(result.stdout.trim());
    if (parsed.tools && Array.isArray(parsed.tools)) {
      return parsed.tools.map((t: any) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || undefined,
      }));
    }
  } catch { /* ignore */ }

  return [];
}

// ── Write Manifest ──────────────────────────────────────────────────

async function writeManifest(serverDir: string, manifest: McpFsManifest): Promise<void> {
  if (DRY_RUN) return;
  await mkdir(serverDir, { recursive: true });
  await writeFile(
    join(serverDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
}

// ── Copy Bridge ─────────────────────────────────────────────────────

async function ensureBridge(): Promise<string> {
  if (!existsSync(BRIDGE_DST)) {
    if (!existsSync(BRIDGE_SRC)) {
      console.error(`Bridge source not found at: ${BRIDGE_SRC}`);
      console.error('Expected at: src/utils/mcpBridge.mjs relative to script');
      return BRIDGE_DST;
    }
    if (!DRY_RUN) {
      await mkdir(dirname(BRIDGE_DST), { recursive: true });
      await copyFile(BRIDGE_SRC, BRIDGE_DST);
      console.log(`  ${srcName('Bridge')} Copied to ${BRIDGE_DST}`);
    }
  }
  return BRIDGE_DST;
}

// ── Main ────────────────────────────────────────────────────────────

// Track stats
const stats = {
  total: 0,
  written: 0,
  skipped: 0,
  errors: 0,
  almaImported: 0,
};

async function main() {
  console.log('ChatWise → MCP-FS Scanner');
  console.log('='.repeat(50));
  console.log(`  ChatWise DB: ${CHATWISE_DB}`);
  console.log(`  MCP-FS dir:  ${MCP_FS_DIR}`);
  console.log(`  Dry run:     ${DRY_RUN}`);
  console.log();

  // 1. Ensure bridge.mjs is in place
  const bridgePath = await ensureBridge();

  // 2. Query ChatWise
  console.log('Scanning ChatWise MCP servers...');
  const rows = queryChatWise();
  console.log(`  Found ${rows.length} enabled MCP servers with cached tools`);
  console.log();

  if (rows.length === 0) {
    console.log('No servers to import.');
  } else {
    // 3. Generate manifests
    for (const row of rows) {
      stats.total++;

      // Parse config
      let config: Record<string, unknown>;
      try {
        config = JSON.parse(row.config);
      } catch {
        console.error(`  ${srcName(row.displayId)} Invalid config JSON, skipping`);
        stats.errors++;
        continue;
      }

      // Normalize config for bridge
      const bridgeConfig: Record<string, unknown> = {};

      const transportType = (config.type as string) || 'stdio';
      bridgeConfig.type = transportType;

      if (transportType === 'http' || transportType === 'sse') {
        // HTTP/SSE transport
        bridgeConfig.url = config.url as string;
        if (config.headers) bridgeConfig.headers = config.headers;
      } else {
        // Stdio transport
        const rawCmd = (config.command as string) || '';
        const { command, args } = splitCommand(rawCmd);
        bridgeConfig.command = command;
        bridgeConfig.args = args;

        // Parse env (ChatWise stores as string "KEY=val\nKEY2=val2")
        const envStr = config.env as string | undefined;
        const envObj = parseEnvString(envStr);
        if (envObj && Object.keys(envObj).length > 0) {
          bridgeConfig.env = envObj;
        }
      }

      // Parse tools from lastFetchedTools
      const tools = parseToolsFromChatWise(row.lastFetchedTools);
      if (tools.length === 0) {
        console.log(`  ${srcName(row.displayId)} No tools found, skipping`);
        stats.skipped++;
        continue;
      }

      // Generate manifest
      const safeName = sanitizeServerName(row.displayId);
      const serverDir = join(SERVERS_DIR, safeName);
      const manifest = generateManifest({
        serverName: safeName,
        displayName: row.displayId,
        config: bridgeConfig,
        tools,
        bridgePath,
      });

      if (!manifest) {
        stats.skipped++;
        continue;
      }

      await writeManifest(serverDir, manifest);
      stats.written++;
      console.log(`  ${srcName(row.displayId)} → servers/${safeName}/ (${tools.length} tools, ${transportType})`);
    }
  }

  // 4. Import Alma MCP config
  console.log();
  console.log('Importing Alma MCP config...');
  stats.almaImported = await importAlmaConfig(SERVERS_DIR, bridgePath);
  if (stats.almaImported > 0) {
    console.log(`  Imported ${stats.almaImported} Alma MCP servers`);
  } else {
    console.log('  No Alma MCP config found or all already imported');
  }

  // 5. Report
  console.log();
  console.log('='.repeat(50));
  console.log('Summary:');
  console.log(`  Total ChatWise servers found:  ${stats.total}`);
  console.log(`  Manifests written:             ${stats.written}`);
  console.log(`  Skipped (no tools):            ${stats.skipped}`);
  console.log(`  Errors:                        ${stats.errors}`);
  console.log(`  Alma servers imported:         ${stats.almaImported}`);

  if (stats.written === 0 && stats.almaImported === 0) {
    console.log();
    console.log('No manifests generated. Check that ChatWise has MCP servers configured.');
    return;
  }

  // 6. Post-install: hint to regenerate
  if (!DRY_RUN && stats.written > 0) {
    console.log();
    console.log('Next step: run mcpfs_discover to generate .ts wrapper files.');
    console.log('  Call the mcpfs_discover tool with regenerate=true');
    console.log('  Or run: bun run src/entrypoints/cli.tsx');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
