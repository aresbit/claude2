import { appendFile, mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join, sep } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { STRATEGY_DB_TOOL_NAME, DESCRIPTION } from './prompt.js'

// ─── Storage ────────────────────────────────────────────────────────────────

const DB_DIR = join(homedir(), '.claude', 'strategy-db')
const SUB_DIRS = ['templates', 'headlines', 'insights', 'competitors'] as const
type SubDir = (typeof SUB_DIRS)[number]
const INDEX_PATH = join(DB_DIR, 'index.json')

type IndexEntry = {
  id: string
  type: SubDir
  name: string
  tags: string[]
  date: string
  score: number
}

function uuid(): string {
  return crypto.randomUUID()
}

function dateStr(): string {
  return new Date().toISOString().split('T')[0]
}

async function ensureDirs(): Promise<void> {
  if (!existsSync(DB_DIR)) {
    await mkdir(DB_DIR, { recursive: true })
  }
  for (const sub of SUB_DIRS) {
    const p = join(DB_DIR, sub)
    if (!existsSync(p)) await mkdir(p, { recursive: true })
  }
}

async function loadIndex(): Promise<IndexEntry[]> {
  try {
    const raw = await readFile(INDEX_PATH, 'utf-8')
    return JSON.parse(raw) as IndexEntry[]
  } catch {
    return []
  }
}

async function saveIndex(index: IndexEntry[]): Promise<void> {
  await writeFile(INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8')
}

async function saveEntry(
  subDir: SubDir,
  data: Record<string, unknown>,
): Promise<string> {
  await ensureDirs()
  const id = uuid()
  const entry = { id, createdAt: dateStr(), ...data }
  const filePath = join(DB_DIR, subDir, `${id}.json`)
  await writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8')

  // Update index
  const index = await loadIndex()
  index.push({
    id,
    type: subDir,
    name: String(data.name ?? data.headline ?? data.competitor ?? id),
    tags: (data.tags as string[]) ?? [],
    date: dateStr(),
    score: Number(data.score ?? data.avgViralScore ?? data.viralScore ?? 0),
  })
  await saveIndex(index)

  return id
}

async function readEntry(subDir: SubDir, id: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(join(DB_DIR, subDir, `${id}.json`), 'utf-8')
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

async function queryEntries(
  type: SubDir | 'all',
  tags?: string[],
  limit = 20,
): Promise<Record<string, unknown>[]> {
  const index = await loadIndex()
  let filtered = index

  if (type !== 'all') {
    filtered = filtered.filter(e => e.type === type)
  }

  if (tags && tags.length > 0) {
    filtered = filtered.filter(e =>
      tags.some(t => e.tags.includes(t)),
    )
  }

  // Sort by date descending
  filtered.sort((a, b) => b.date.localeCompare(a.date))
  filtered = filtered.slice(0, limit)

  const results: Record<string, unknown>[] = []
  for (const entry of filtered) {
    const data = await readEntry(entry.type, entry.id)
    if (data) results.push(data)
  }
  return results
}

// ─── Input Schemas ──────────────────────────────────────────────────────────

const saveTemplateSchema = z.strictObject({
  action: z.literal('save_template'),
  templateType: z.enum([
    '认知颠覆型', '深度分析型', '故事叙事型', '清单干货型', '争议挑战型',
  ]).describe('Type of viral template'),
  pattern: z.array(z.string()).describe('Section pattern (e.g., ["引子:反常识数据", "冲突", "拆解层1-3", "案例"])'),
  source: z.string().optional().describe('Source article title or URL'),
  avgViralScore: z.number().min(0).max(10).optional().describe('Estimated virality score'),
  tags: z.array(z.string()).optional().default([]).describe('Tags for categorization'),
  notes: z.string().optional().describe('Additional notes'),
})

const saveHeadlineSchema = z.strictObject({
  action: z.literal('save_headline'),
  headline: z.string().min(1).describe('The headline text'),
  formulas: z.array(z.string()).describe('Detected headline formulas (e.g., ["悬念式", "反常识"])'),
  score: z.number().min(0).max(10).describe('ContentAnalyst score'),
  emotionTriggers: z.array(z.string()).optional().default([]).describe('Emotional triggers detected'),
  platform: z.string().optional().describe('Target platform'),
  patterns: z.array(z.string()).optional().default([]).describe('Structural patterns'),
  tags: z.array(z.string()).optional().default([]).describe('Tags for categorization'),
})

const saveInsightSchema = z.strictObject({
  action: z.literal('save_insight'),
  emotion: z.string().describe('Emotion type (e.g., surprise, anger, warmth)'),
  trigger: z.string().describe('What triggered this emotion'),
  context: z.string().describe('The context where this was observed'),
  effectiveness: z.number().min(0).max(1).describe('How effective this trigger was (0-1)'),
  source: z.string().optional().describe('Source of insight'),
  tags: z.array(z.string()).optional().default([]),
})

const saveCompetitorSchema = z.strictObject({
  action: z.literal('save_competitor'),
  competitor: z.string().min(1).describe('Competitor account name'),
  articleTitle: z.string().min(1).describe('Article title analyzed'),
  viralScore: z.number().min(0).max(10).optional().describe('Estimated virality score'),
  templateUsed: z.string().optional().describe('Viral template used'),
  headlineFormula: z.string().optional().describe('Headline formula used'),
  keyTakeaways: z.array(z.string()).describe('Key strategic takeaways'),
  tags: z.array(z.string()).optional().default([]),
})

const querySchema = z.strictObject({
  action: z.literal('query'),
  type: z.enum(['template', 'headline', 'insight', 'competitor', 'all'])
    .optional().default('all'),
  tags: z.array(z.string()).optional(),
  limit: z.number().min(1).max(100).optional().default(20),
})

const statsSchema = z.strictObject({
  action: z.literal('stats'),
  type: z.enum(['template', 'headline', 'insight', 'competitor', 'all'])
    .optional().default('all'),
})

const learnSchema = z.strictObject({
  action: z.literal('learn'),
  analysisResult: z.string().min(1).describe('ContentAnalyst tool output JSON string'),
  tags: z.array(z.string()).optional().default([]),
})

const inputSchema = lazySchema(() =>
  z.discriminatedUnion('action', [
    saveTemplateSchema,
    saveHeadlineSchema,
    saveInsightSchema,
    saveCompetitorSchema,
    querySchema,
    statsSchema,
    learnSchema,
  ]),
)
type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

// ─── Output Schemas ─────────────────────────────────────────────────────────

const saveOutputSchema = z.object({
  action: z.literal('saved'),
  id: z.string(),
  type: z.string(),
  message: z.string(),
})

const queryOutputSchema = z.object({
  action: z.literal('query_result'),
  count: z.number(),
  results: z.array(z.record(z.unknown())),
})

const statsOutputSchema = z.object({
  action: z.literal('stats_result'),
  totalEntries: z.number(),
  byType: z.record(z.number()),
  topTags: z.array(z.object({ tag: z.string(), count: z.number() })),
  topFormulas: z.array(z.object({ formula: z.string(), count: z.number() })),
  topTemplates: z.array(z.object({ template: z.string(), count: z.number() })),
  avgScore: z.number(),
})

const learnOutputSchema = z.object({
  action: z.literal('learn_result'),
  saved: z.array(z.object({ type: z.string(), id: z.string() })),
  summary: z.string(),
})

const outputSchema = lazySchema(() =>
  z.union([saveOutputSchema, queryOutputSchema, statsOutputSchema, learnOutputSchema]),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

// ─── Actions ────────────────────────────────────────────────────────────────

async function handleSaveTemplate(
  input: z.infer<typeof saveTemplateSchema>,
): Promise<Output> {
  const id = await saveEntry('templates', {
    name: `${input.templateType}-${input.pattern[0]?.slice(0, 30) ?? 'unnamed'}`,
    templateType: input.templateType,
    pattern: input.pattern,
    source: input.source,
    avgViralScore: input.avgViralScore,
    tags: input.tags,
    notes: input.notes,
  })
  return {
    action: 'saved',
    id,
    type: 'template',
    message: `模板「${input.templateType}」已保存 (${id.slice(0, 8)})`,
  }
}

async function handleSaveHeadline(
  input: z.infer<typeof saveHeadlineSchema>,
): Promise<Output> {
  const id = await saveEntry('headlines', {
    name: input.headline.slice(0, 60),
    headline: input.headline,
    formulas: input.formulas,
    score: input.score,
    emotionTriggers: input.emotionTriggers,
    platform: input.platform,
    patterns: input.patterns,
    tags: input.tags,
  })
  return {
    action: 'saved',
    id,
    type: 'headline',
    message: `标题已保存 (score: ${input.score}/10)`,
  }
}

async function handleSaveInsight(
  input: z.infer<typeof saveInsightSchema>,
): Promise<Output> {
  const id = await saveEntry('insights', {
    name: `${input.emotion}: ${input.trigger.slice(0, 40)}`,
    emotion: input.emotion,
    trigger: input.trigger,
    context: input.context,
    effectiveness: input.effectiveness,
    source: input.source,
    tags: input.tags,
  })
  return {
    action: 'saved',
    id,
    type: 'reader-insight',
    message: `情绪洞察已保存 (${input.emotion}, 效果: ${Math.round(input.effectiveness * 100)}%)`,
  }
}

async function handleSaveCompetitor(
  input: z.infer<typeof saveCompetitorSchema>,
): Promise<Output> {
  const id = await saveEntry('competitors', {
    name: `${input.competitor}: ${input.articleTitle.slice(0, 40)}`,
    competitor: input.competitor,
    articleTitle: input.articleTitle,
    viralScore: input.viralScore,
    templateUsed: input.templateUsed,
    headlineFormula: input.headlineFormula,
    keyTakeaways: input.keyTakeaways,
    tags: input.tags,
  })
  return {
    action: 'saved',
    id,
    type: 'competitor',
    message: `竞品分析已保存 (${input.competitor})`,
  }
}

async function handleQuery(
  input: z.infer<typeof querySchema>,
): Promise<Output> {
  const type = input.type === 'all' ? 'all' : (input.type + 's') as SubDir | 'all'
  const results = await queryEntries(type, input.tags, input.limit)
  return {
    action: 'query_result',
    count: results.length,
    results,
  }
}

async function handleStats(): Promise<Output> {
  const index = await loadIndex()
  const totalEntries = index.length

  const byType: Record<string, number> = {}
  for (const e of index) {
    byType[e.type] = (byType[e.type] ?? 0) + 1
  }

  // Tag frequency
  const tagCount = new Map<string, number>()
  for (const e of index) {
    for (const tag of e.tags) {
      tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1)
    }
  }
  const topTags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }))

  // Formula & template frequency (scan entries)
  const formulaCount = new Map<string, number>()
  const templateCount = new Map<string, number>()
  let totalScore = 0
  let scoreCount = 0

  for (const entry of index) {
    if (entry.score > 0) {
      totalScore += entry.score
      scoreCount++
    }
    // Load entry data for formula/template analysis
    const data = await readEntry(entry.type, entry.id)
    if (data) {
      const formulas = data.formulas as string[] | undefined
      if (formulas) {
        for (const f of formulas) {
          formulaCount.set(f, (formulaCount.get(f) ?? 0) + 1)
        }
      }
      const templateType = data.templateType as string | undefined
      if (templateType) {
        templateCount.set(templateType, (templateCount.get(templateType) ?? 0) + 1)
      }
    }
  }

  const topFormulas = [...formulaCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([formula, count]) => ({ formula, count }))

  const topTemplates = [...templateCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([template, count]) => ({ template, count }))

  return {
    action: 'stats_result',
    totalEntries,
    byType,
    topTags,
    topFormulas,
    topTemplates,
    avgScore: scoreCount > 0 ? Math.round((totalScore / scoreCount) * 10) / 10 : 0,
  }
}

async function handleLearn(
  input: z.infer<typeof learnSchema>,
): Promise<Output> {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(input.analysisResult) as Record<string, unknown>
  } catch {
    return {
      action: 'learn_result',
      saved: [],
      summary: '无法解析 analysisResult JSON，请确保传入有效的 ContentAnalyst 输出',
    }
  }

  const saved: Array<{ type: string; id: string }> = []
  const notes: string[] = []
  const tags = input.tags

  const action = parsed.action as string | undefined

  // Handle headline analysis output
  if (action === 'analyze_headline') {
    const id = await saveEntry('headlines', {
      name: (parsed.headline as string)?.slice(0, 60),
      headline: parsed.headline,
      formulas: parsed.formulaMatch && (parsed.formulaMatch as Record<string, unknown>).detected,
      score: parsed.overallScore,
      emotionTriggers: parsed.emotionalTriggers && (parsed.emotionalTriggers as Record<string, unknown>).detected,
      tags,
    })
    saved.push({ type: 'headline', id })
    notes.push(`标题已自动归档 (score: ${String(parsed.overallScore)}/10)`)
  }

  // Handle structure analysis output
  if (action === 'analyze_structure') {
    const tm = parsed.templateMatch as Record<string, unknown> | undefined
    const templateType = (tm?.detectedTemplates as string[])?.[0]
    if (templateType) {
      const id = await saveEntry('templates', {
        name: templateType,
        templateType,
        source: `ContentAnalyst分析`,
        avgViralScore: parsed.overallScore,
        tags,
      })
      saved.push({ type: 'template', id })
      notes.push(`结构模板已自动归档: ${templateType}`)
    }
  }

  // Handle virality score output (comprehensive, save both headline + template)
  if (action === 'virality_score') {
    const dims = parsed.dimensions as Record<string, unknown> | undefined

    // Save headline pattern
    if (parsed.headline) {
      const id = await saveEntry('headlines', {
        name: (parsed.headline as string)?.slice(0, 60),
        headline: parsed.headline,
        score: parsed.overallScore
          ? Math.round((parsed.overallScore as number) / 10)
          : 5,
        tags,
      })
      saved.push({ type: 'headline', id })
      notes.push(`标题已归档 (综合评分: ${String(parsed.overallScore)}/100)`)
    }

    // Save strengths as insights
    const strengths = parsed.strengths as string[] | undefined
    if (strengths && strengths.length > 0) {
      const id = await saveEntry('insights', {
        name: `从文章提取的有效策略: ${strengths[0].slice(0, 40)}`,
        emotion: 'positive',
        trigger: strengths.join('; '),
        context: 'ContentAnalyst virality_score 自动提取',
        effectiveness: 0.7,
        tags,
      })
      saved.push({ type: 'insight', id })
    }
  }

  if (saved.length === 0) {
    return {
      action: 'learn_result',
      saved: [],
      summary: '未从分析结果中提取到可归档的模式。支持 analyze_headline / analyze_structure / virality_score 输出。',
    }
  }

  return {
    action: 'learn_result',
    saved,
    summary: `已自动归档 ${saved.length} 条策略数据。\n${notes.join('\n')}`,
  }
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

function getToolUseSummary(input: Record<string, unknown>): string {
  const action = input.action as string
  switch (action) {
    case 'save_template':
      return `template: ${String(input.templateType ?? '')}`
    case 'save_headline':
      return `headline: ${String(input.headline ?? '').slice(0, 30)}`
    case 'save_insight':
      return `insight: ${String(input.emotion ?? '')}`
    case 'save_competitor':
      return `competitor: ${String(input.competitor ?? '')}`
    case 'query':
      return `query type=${String(input.type ?? 'all')}`
    case 'stats':
      return 'knowledge base stats'
    case 'learn':
      return 'learn from ContentAnalyst'
    default:
      return 'strategy db operation'
  }
}

export const StrategyDBTool = buildTool({
  name: STRATEGY_DB_TOOL_NAME,
  searchHint: 'content strategy knowledge base, viral patterns, headline library',
  shouldDefer: true,
  maxResultSizeChars: 50_000,

  description() {
    return 'Content strategy knowledge base for archiving viral patterns and insights'
  },
  userFacingName() {
    return 'Strategy DB'
  },
  getToolUseSummary(input) {
    return getToolUseSummary(input as Record<string, unknown>)
  },

  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  isConcurrencySafe() {
    return true
  },
  isReadOnly(input) {
    const a = (input as { action?: string }).action
    return a === 'query' || a === 'stats'
  },

  async prompt() {
    return DESCRIPTION
  },

  async validateInput(input) {
    const action = (input as { action?: string }).action
    if (!action) {
      return {
        result: false,
        message: 'Error: "action" field required. Choose from: save_template, save_headline, save_insight, save_competitor, query, stats, learn.',
        errorCode: 1,
      }
    }
    return { result: true }
  },

  async call(input) {
    const { action } = input as Input

    switch (action) {
      case 'save_template':
        return { data: await handleSaveTemplate(input as z.infer<typeof saveTemplateSchema>) }
      case 'save_headline':
        return { data: await handleSaveHeadline(input as z.infer<typeof saveHeadlineSchema>) }
      case 'save_insight':
        return { data: await handleSaveInsight(input as z.infer<typeof saveInsightSchema>) }
      case 'save_competitor':
        return { data: await handleSaveCompetitor(input as z.infer<typeof saveCompetitorSchema>) }
      case 'query':
        return { data: await handleQuery(input as z.infer<typeof querySchema>) }
      case 'stats':
        return { data: await handleStats() }
      case 'learn':
        return { data: await handleLearn(input as z.infer<typeof learnSchema>) }
      default:
        throw new Error(`Unknown action: ${action}`)
    }
  },

  mapToolResultToToolResultBlockParam({ result }, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
