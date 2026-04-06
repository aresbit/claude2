import { appendFile, mkdir, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { MEMORY_TYPES, type MemoryType } from '../../memdir/memoryTypes.js'
import { MemoryStore } from '../MemoryTool/MemoryStore.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'
import { fetchContent } from '../WebFetchTool/utils.js'
import {
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'
import { DESCRIPTION } from './prompt.js'

const WIKI_TOOL_NAME = 'wikitool'

const WIKI_CATEGORIES = ['article', 'paper', 'note', 'image'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().url().describe('The URL to fetch content from'),
    title: z.string().describe('Title for the saved content'),
    description: z.string().optional().describe('Brief description of the content'),
    category: z
      .enum(WIKI_CATEGORIES)
      .default('article')
      .describe('Content category'),
    tags: z.array(z.string()).optional().describe('Tags for categorization'),
    saveMemory: z
      .boolean()
      .default(true)
      .describe('Whether to save a companion memory file'),
    memoryType: z
      .enum(MEMORY_TYPES)
      .default('project')
      .describe('Type of memory to save when saveMemory is true'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
    sourceFile: z.string().describe('Path to saved source file'),
    memoryFile: z.string().optional().describe('Path to saved memory file'),
    url: z.string().describe('The URL that was fetched'),
    title: z.string().describe('Title of the content'),
    message: z.string().describe('Status message'),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function sanitizeFilename(title: string): string {
  const sanitized = title
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .trim()

  return sanitized || 'untitled'
}

function getCategoryDirectory(category: Input['category']): string {
  switch (category) {
    case 'paper':
      return 'papers'
    case 'note':
      return 'notes'
    case 'image':
      return 'images'
    case 'article':
    default:
      return 'articles'
  }
}

function getWikiBasePath(): string {
  return process.env.WIKI_BASE_PATH || join(homedir(), 'yyswiki')
}

function formatTags(tags: string[] | undefined): string {
  return tags && tags.length > 0 ? tags.join(', ') : 'none'
}

function buildMarkdownContent(
  input: Input,
  fetchedContent: string,
  fetchedAt: string,
): string {
  const header = [
    `# ${input.title}`,
    '',
    input.description ? `> ${input.description}` : '',
    input.description ? '' : '',
    `**Source URL**: ${input.url}`,
    `**Fetched**: ${fetchedAt}`,
    `**Category**: ${input.category}`,
    input.tags && input.tags.length > 0 ? `**Tags**: ${input.tags.join(', ')}` : '',
    '',
    '---',
    '',
  ].filter(Boolean)

  return `${header.join('\n')}${fetchedContent.endsWith('\n') ? '' : '\n'}${fetchedContent}`
}

function buildMemoryContent(
  input: Input,
  sourceFile: string,
  savedAt: string,
): string {
  return `## Wiki Content: ${input.title}

**URL**: ${input.url}
**Category**: ${input.category}
**Saved**: ${savedAt}
**Source File**: ${sourceFile}

### Summary
${input.description || 'Content saved from web source'}

### Key Points
- Source: ${input.url}
- Type: ${input.category}
- Tags: ${formatTags(input.tags)}

### Why:
This content was fetched and saved as part of building a personal knowledge base.

### How to apply:
Use the source file for the full markdown content and this memory as a durable index entry.
`
}

function createAbortController(parentSignal: AbortSignal): AbortController {
  const controller = new AbortController()
  if (parentSignal.aborted) {
    controller.abort()
    return controller
  }

  parentSignal.addEventListener('abort', () => controller.abort(), { once: true })
  return controller
}

export const WikiTool = buildTool({
  name: WIKI_TOOL_NAME,
  searchHint: 'fetch and save content to wiki knowledge base',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return DESCRIPTION
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
    return 'WikiTool'
  },
  shouldDefer: false,
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return `${input.url} -> ${input.title}`
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  async call(input, context) {
    const abortController = createAbortController(context.abortController.signal)
    const now = new Date()
    const isoTimestamp = now.toISOString()
    const isoDate = isoTimestamp.split('T')[0] || isoTimestamp
    const wikiBasePath = getWikiBasePath()
    const categoryDir = getCategoryDirectory(input.category)
    const sourceDir = join(wikiBasePath, 'raw_sources', categoryDir)
    const filename = `${sanitizeFilename(input.title)}.md`
    const sourceFile = join(sourceDir, filename)

    try {
      const fetched = await fetchContent(input.url, abortController.signal, {
        mode: 'auto',
        format: 'markdown',
      })

      await mkdir(sourceDir, { recursive: true })
      await writeFile(
        sourceFile,
        buildMarkdownContent(input, fetched.content, isoDate),
        'utf-8',
      )

      let memoryFile: string | undefined
      if (input.saveMemory) {
        const memoryStore = new MemoryStore()
        const memory = await memoryStore.saveMemory(
          input.memoryType as MemoryType,
          `wiki_${sanitizeFilename(input.title)}`,
          `Wiki content: ${input.title} from ${input.url}`,
          buildMemoryContent(input, sourceFile, isoTimestamp),
          ['wiki', input.category, ...(input.tags || [])],
        )
        memoryFile = memory.filePath
      }

      const logDir = join(wikiBasePath, 'wiki')
      await mkdir(logDir, { recursive: true })
      await appendFile(
        join(logDir, 'log.md'),
        `## [${isoDate}] ingest | ${input.title}
- Source: ${input.url}
- Category: ${input.category}
- File: ${filename}
- Memory: ${input.saveMemory ? 'saved' : 'not saved'}

`,
        'utf-8',
      )

      return {
        data: {
          success: true,
          sourceFile,
          memoryFile,
          url: input.url,
          title: input.title,
          message: `Saved "${input.title}" to ${sourceFile}`,
        },
      }
    } catch (error) {
      return {
        data: {
          success: false,
          sourceFile: '',
          url: input.url,
          title: input.title,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const output = content as Output
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.success
        ? `Saved "${output.title}" to wiki`
        : `Failed to save "${output.title}" to wiki: ${output.message}`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
