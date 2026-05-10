import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'
import { MEMORY_TOOL_NAME } from './constants.js'
import { DESCRIPTION, getPrompt } from './prompt.js'
import { MemoryStore, type Memory } from './MemoryStore.js'
import { MEMORY_TYPES, type MemoryType } from '../../memdir/memoryTypes.js'

// Input schemas for different actions
const saveInputSchema = z.strictObject({
  action: z.literal('save'),
  type: z.enum(MEMORY_TYPES).describe('Type of memory: user, feedback, project, or reference'),
  name: z.string().describe('Name/title of the memory'),
  description: z.string().describe('One-line description for relevance determination'),
  content: z.string().describe('Memory content (for feedback/project: structure as rule/fact, then Why: and How to apply:)'),
  tags: z.array(z.string()).optional().describe('Optional tags for categorization'),
})

const searchInputSchema = z.strictObject({
  action: z.literal('search'),
  query: z.string().describe('Search query to match against name, description, or content'),
  type: z.enum(MEMORY_TYPES).optional().describe('Optional filter by memory type'),
  limit: z.number().optional().default(20).describe('Maximum number of results to return'),
})

const listInputSchema = z.strictObject({
  action: z.literal('list'),
  offset: z.number().optional().default(0).describe('Number of memories to skip'),
  limit: z.number().optional().default(20).describe('Maximum number of memories to return'),
})

const getInputSchema = z.strictObject({
  action: z.literal('get'),
  id: z.string().describe('Memory ID or filename (without .md extension)'),
})

const updateInputSchema = z.strictObject({
  action: z.literal('update'),
  id: z.string().describe('Memory ID or filename (without .md extension)'),
  name: z.string().optional().describe('Updated name/title'),
  description: z.string().optional().describe('Updated description'),
  content: z.string().optional().describe('Updated content'),
  tags: z.array(z.string()).optional().describe('Updated tags'),
})

const deleteInputSchema = z.strictObject({
  action: z.literal('delete'),
  id: z.string().describe('Memory ID or filename (without .md extension)'),
})

// ── Nietzschean Self-Overcoming Actions ──────────────────────────

const evolveInputSchema = z.strictObject({
  action: z.literal('evolve'),
  id: z.string().describe('Memory ID to overcome (supersede with new understanding)'),
  overcomeReason: z.string().describe('Why the old belief is being overcome — what was learned'),
  newContent: z.string().describe('The new, higher understanding that replaces the old'),
  newName: z.string().optional().describe('Optional new name for the evolved memory'),
})

const rehearseInputSchema = z.strictObject({
  action: z.literal('rehearse'),
  query: z.string().optional().describe('Optional search query to filter which memories to rehearse'),
  type: z.enum(MEMORY_TYPES).optional().describe('Optional filter by memory type'),
  limit: z.number().optional().default(5).describe('Maximum memories to rehearse (default 5)'),
})

const summarizeInputSchema = z.strictObject({
  action: z.literal('summarize'),
  id: z.string().describe('Memory ID to create a recoverable compressed version of'),
  summary: z.string().describe('Compressed summary of the memory content'),
  keyPoints: z.array(z.string()).describe('Key points extracted from the memory'),
})

const genealogyInputSchema = z.strictObject({
  action: z.literal('genealogy'),
  id: z.string().describe('Memory ID to trace the full evolution chain for'),
})

const synthesizeInputSchema = z.strictObject({
  action: z.literal('synthesize'),
  domain: z.string().describe('Domain name for the knowledge article (e.g., "React Performance", "API Design")'),
  query: z.string().optional().describe('Optional search query to find related memories (defaults to domain name)'),
  type: z.enum(MEMORY_TYPES).optional().describe('Optional filter by memory type'),
})

// ── Temporary Memory (临时记忆) Actions ──────────────────────

const tempSaveInputSchema = z.strictObject({
  action: z.literal('temp_save'),
  content: z.string().describe('Content to save to session-scoped scratchpad (auto-cleared on new session)'),
})

const tempReadInputSchema = z.strictObject({
  action: z.literal('temp_read'),
})

const tempClearInputSchema = z.strictObject({
  action: z.literal('temp_clear'),
})

// ── Auto-Rehearsal (工作记忆 + 主动记忆) ────────────────────

const autoRehearseInputSchema = z.strictObject({
  action: z.literal('auto_rehearse'),
  query: z.string().optional().describe('Optional context query to find relevant memories for rehearsal'),
  type: z.enum(MEMORY_TYPES).optional().describe('Optional filter by memory type'),
  limit: z.number().optional().default(3).describe('Max memories to rehearse (default 3)'),
})

// ── Archive (长期记忆) ─────────────────────────────────────

const archiveInputSchema = z.strictObject({
  action: z.literal('archive'),
  daysOld: z.number().optional().default(90).describe('Archive memories older than this many days (default 90)'),
})

const inputSchema = lazySchema(() =>
  z.discriminatedUnion('action', [
    saveInputSchema,
    searchInputSchema,
    listInputSchema,
    getInputSchema,
    updateInputSchema,
    deleteInputSchema,
    evolveInputSchema,
    rehearseInputSchema,
    summarizeInputSchema,
    genealogyInputSchema,
    synthesizeInputSchema,
    tempSaveInputSchema,
    tempReadInputSchema,
    tempClearInputSchema,
    autoRehearseInputSchema,
    archiveInputSchema,
  ])
)

type InputSchema = ReturnType<typeof inputSchema>

// Output schemas
const memoryOutputSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  description: z.string(),
  content: z.string(),
  tags: z.array(z.string()).optional(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
  filePath: z.string(),
})

const saveOutputSchema = z.object({
  action: z.literal('save'),
  memory: memoryOutputSchema,
})

const searchOutputSchema = z.object({
  action: z.literal('search'),
  memories: z.array(memoryOutputSchema),
  count: z.number(),
})

const listOutputSchema = z.object({
  action: z.literal('list'),
  memories: z.array(memoryOutputSchema),
  offset: z.number(),
  limit: z.number(),
  total: z.number(),
})

const getOutputSchema = z.object({
  action: z.literal('get'),
  memory: memoryOutputSchema.nullable(),
})

const updateOutputSchema = z.object({
  action: z.literal('update'),
  memory: memoryOutputSchema,
})

const deleteOutputSchema = z.object({
  action: z.literal('delete'),
  deleted: z.boolean(),
  id: z.string(),
})

const evolveOutputSchema = z.object({
  action: z.literal('evolve'),
  overcome: memoryOutputSchema,
  successor: memoryOutputSchema,
  overcomeReason: z.string(),
})

const rehearseOutputSchema = z.object({
  action: z.literal('rehearse'),
  memories: z.array(memoryOutputSchema),
  rehearsal: z.string(),
  count: z.number(),
})

const summarizeOutputSchema = z.object({
  action: z.literal('summarize'),
  original: memoryOutputSchema,
  summary: memoryOutputSchema,
})

const genealogyOutputSchema = z.object({
  action: z.literal('genealogy'),
  chain: z.array(memoryOutputSchema),
  depth: z.number(),
})

const synthesizeOutputSchema = z.object({
  action: z.literal('synthesize'),
  domain: z.string(),
  memories: z.array(memoryOutputSchema),
  article: z.string(),
  memoryCount: z.number(),
})

const tempSaveOutputSchema = z.object({
  action: z.literal('temp_save'),
  path: z.string(),
  length: z.number(),
})

const tempReadOutputSchema = z.object({
  action: z.literal('temp_read'),
  content: z.string().nullable(),
})

const tempClearOutputSchema = z.object({
  action: z.literal('temp_clear'),
  cleared: z.boolean(),
})

const autoRehearseOutputSchema = z.object({
  action: z.literal('auto_rehearse'),
  memories: z.array(memoryOutputSchema),
  rehearsal: z.string(),
  count: z.number(),
})

const archiveOutputSchema = z.object({
  action: z.literal('archive'),
  archived: z.number(),
  archiveDir: z.string(),
})

const outputSchema = lazySchema(() =>
  z.union([
    saveOutputSchema,
    searchOutputSchema,
    listOutputSchema,
    getOutputSchema,
    updateOutputSchema,
    deleteOutputSchema,
    evolveOutputSchema,
    rehearseOutputSchema,
    summarizeOutputSchema,
    genealogyOutputSchema,
    synthesizeOutputSchema,
    tempSaveOutputSchema,
    tempReadOutputSchema,
    tempClearOutputSchema,
    autoRehearseOutputSchema,
    archiveOutputSchema,
  ])
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

// Helper to convert Memory to serializable object
function memoryToSerializable(memory: Memory): z.infer<typeof memoryOutputSchema> {
  return {
    ...memory,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  }
}

export const MemoryTool = buildTool({
  name: MEMORY_TOOL_NAME,
  searchHint: 'manage persistent memory system',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return getPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get inputJSONSchema() {
    const schema = zodToJsonSchema(inputSchema())
    schema.type = 'object'
    return schema
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'MemoryTool'
  },
  shouldDefer: true,
  isEnabled() {
    // Always enabled for now
    return true
  },
  isConcurrencySafe() {
    return true
  },
  toAutoClassifierInput(input) {
    return `${input.action} memory`
  },
  renderToolUseMessage() {
    return null
  },
  async call(input, context) {
    const store = new MemoryStore()

    switch (input.action) {
      case 'save': {
        const memory = await store.saveMemory(
          input.type,
          input.name,
          input.description,
          input.content,
          input.tags
        )
        return {
          data: {
            action: 'save' as const,
            memory: memoryToSerializable(memory),
          },
        }
      }

      case 'search': {
        const memories = await store.searchMemories(input.query, input.type, input.limit)
        return {
          data: {
            action: 'search' as const,
            memories: memories.map(memoryToSerializable),
            count: memories.length,
          },
        }
      }

      case 'list': {
        const memories = await store.listMemories(input.offset, input.limit)
        return {
          data: {
            action: 'list' as const,
            memories: memories.map(memoryToSerializable),
            offset: input.offset,
            limit: input.limit,
            total: memories.length, // Note: this is just the returned count, not total count
          },
        }
      }

      case 'get': {
        const memory = await store.getMemory(input.id)
        return {
          data: {
            action: 'get' as const,
            memory: memory ? memoryToSerializable(memory) : null,
          },
        }
      }

      case 'update': {
        const updates: Partial<{
          name: string
          description: string
          content: string
          tags: string[]
        }> = {}

        if (input.name !== undefined) updates.name = input.name
        if (input.description !== undefined) updates.description = input.description
        if (input.content !== undefined) updates.content = input.content
        if (input.tags !== undefined) updates.tags = input.tags

        const updatedMemory = await store.updateMemory(input.id, updates)
        if (!updatedMemory) {
          throw new Error(`Memory with ID ${input.id} not found or could not be updated`)
        }

        return {
          data: {
            action: 'update' as const,
            memory: memoryToSerializable(updatedMemory),
          },
        }
      }

      case 'delete': {
        const deleted = await store.deleteMemory(input.id)
        return {
          data: {
            action: 'delete' as const,
            deleted,
            id: input.id,
          },
        }
      }

      // ── Nietzschean Self-Overcoming Actions ──────────────────

      case 'evolve': {
        const result = await store.evolveMemory(
          input.id,
          input.overcomeReason,
          input.newContent,
          input.newName,
        )
        if (!result) {
          throw new Error(`Memory with ID ${input.id} not found — cannot evolve what does not exist`)
        }
        return {
          data: {
            action: 'evolve' as const,
            overcome: memoryToSerializable(result.overcome),
            successor: memoryToSerializable(result.successor),
            overcomeReason: input.overcomeReason,
          },
        }
      }

      case 'rehearse': {
        const { rehearsal, memories } = await store.rehearseMemories(
          input.query,
          input.type,
          input.limit,
        )
        return {
          data: {
            action: 'rehearse' as const,
            memories: memories.map(memoryToSerializable),
            rehearsal,
            count: memories.length,
          },
        }
      }

      case 'summarize': {
        const result = await store.summarizeMemory(
          input.id,
          input.summary,
          input.keyPoints,
        )
        if (!result) {
          throw new Error(`Memory with ID ${input.id} not found — cannot summarize`)
        }
        return {
          data: {
            action: 'summarize' as const,
            original: memoryToSerializable(result.original),
            summary: memoryToSerializable(result.summary),
          },
        }
      }

      case 'genealogy': {
        const chain = await store.getGenealogy(input.id)
        return {
          data: {
            action: 'genealogy' as const,
            chain: chain.map(memoryToSerializable),
            depth: chain.length,
          },
        }
      }

      case 'synthesize': {
        const { domain: dom, memories, article } = await store.synthesizeDomain(
          input.domain,
          input.query,
          input.type,
        )
        return {
          data: {
            action: 'synthesize' as const,
            domain: dom,
            memories: memories.map(memoryToSerializable),
            article,
            memoryCount: memories.length,
          },
        }
      }

      // ── Temporary Memory (临时记忆) ────────────────────

      case 'temp_save': {
        const path = await store.saveScratchpad(input.content)
        return {
          data: {
            action: 'temp_save' as const,
            path,
            length: input.content.length,
          },
        }
      }

      case 'temp_read': {
        const content = await store.readScratchpad()
        return {
          data: {
            action: 'temp_read' as const,
            content,
          },
        }
      }

      case 'temp_clear': {
        const cleared = await store.clearScratchpad()
        return {
          data: {
            action: 'temp_clear' as const,
            cleared,
          },
        }
      }

      // ── Auto-Rehearsal (工作记忆 + 主动记忆) ────────────

      case 'auto_rehearse': {
        const { rehearsal, memories } = await store.autoRehearse(
          input.query,
          input.type,
          input.limit,
        )
        return {
          data: {
            action: 'auto_rehearse' as const,
            memories: memories.map(memoryToSerializable),
            rehearsal,
            count: memories.length,
          },
        }
      }

      // ── Archive (长期记忆) ──────────────────────────────

      case 'archive': {
        const { archived, archiveDir } = await store.archiveOldMemories(input.daysOld)
        return {
          data: {
            action: 'archive' as const,
            archived,
            archiveDir,
          },
        }
      }

      default:
        throw new Error(`Unknown action: ${(input as any).action}`)
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const data = content as Output
    let message = ''

    switch (data.action) {
      case 'save':
        message = `Saved memory: ${data.memory.name} (${data.memory.type})`
        break
      case 'search':
        message = `Found ${data.count} memory${data.count === 1 ? '' : 'ies'} matching search`
        break
      case 'list':
        message = `Listed ${data.memories.length} memory${data.memories.length === 1 ? '' : 'ies'} (offset: ${data.offset}, limit: ${data.limit})`
        break
      case 'get':
        message = data.memory
          ? `Retrieved memory: ${data.memory.name}`
          : `Memory not found`
        break
      case 'update':
        message = `Updated memory: ${data.memory.name}`
        break
      case 'delete':
        message = data.deleted
          ? `Deleted memory ${data.id}`
          : `Failed to delete memory ${data.id}`
        break
      case 'evolve':
        message = `Memory evolved: "${data.overcome.name}" overcome → "${data.successor.name}"\nReason: ${data.overcomeReason}`
        break
      case 'rehearse':
        message = data.count > 0
          ? `Rehearsed ${data.count} memories — written to REHEARSAL.md for context injection`
          : 'No memories found to rehearse'
        break
      case 'summarize':
        message = `Memory "${data.original.name}" compressed → "${data.summary.name}" (recoverable)`
        break
      case 'genealogy':
        message = data.depth > 0
          ? `Genealogy chain of ${data.depth} memories: ${data.chain.map(m => m.name).join(' → ')}`
          : 'No genealogy chain found'
        break
      case 'synthesize':
        message = `Domain knowledge synthesized: "${data.domain}" — ${data.memoryCount} memories aggregated into structured article.\n\nTo save to wiki: use WikiTool with the article content as description. The article is in the output data.article field.`
        break
      // ── Temporary Memory (临时记忆) ──
      case 'temp_save':
        message = `Saved ${data.length} characters to scratchpad (临时记忆)`
        break
      case 'temp_read':
        message = data.content
          ? `Scratchpad (临时记忆): ${data.content.substring(0, 200)}${data.content.length > 200 ? '...' : ''}`
          : 'Scratchpad is empty'
        break
      case 'temp_clear':
        message = data.cleared
          ? 'Scratchpad cleared (临时记忆)'
          : 'Scratchpad was already empty'
        break
      // ── Auto-Rehearsal (工作记忆 + 主动记忆) ──
      case 'auto_rehearse':
        message = data.count > 0
          ? `Auto-rehearsed ${data.count} memories with scratchpad — written to REHEARSAL.md (工作记忆)`
          : 'No active memories to rehearse'
        break
      // ── Archive (长期记忆) ──
      case 'archive':
        message = data.archived > 0
          ? `Archived ${data.archived} old memories to ${data.archiveDir} (长期记忆)`
          : 'No memories needed archiving'
        break
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: message,
    }
  },
} satisfies ToolDef<InputSchema, Output>)