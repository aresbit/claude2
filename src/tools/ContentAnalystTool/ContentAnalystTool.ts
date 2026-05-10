import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { CONTENT_ANALYST_TOOL_NAME, DESCRIPTION } from './prompt.js'

// ─── Input Schemas ───────────────────────────────────────────────────────────

const analyzeHeadlineSchema = z.strictObject({
  action: z.literal('analyze_headline'),
  headline: z.string().min(1).describe('The headline to analyze'),
  platform: z
    .enum(['wechat', 'zhihu', 'xiaohongshu', 'toutiao', 'general'])
    .optional()
    .default('general')
    .describe('Target platform for platform-specific analysis'),
})

const analyzeStructureSchema = z.strictObject({
  action: z.literal('analyze_structure'),
  content: z.string().min(1).describe('Full article content to analyze'),
})

const viralityScoreSchema = z.strictObject({
  action: z.literal('virality_score'),
  headline: z.string().describe('The article headline'),
  content: z.string().describe('The full article content'),
  platform: z
    .string()
    .optional()
    .default('general')
    .describe('Target platform'),
})

const analyzeHookSchema = z.strictObject({
  action: z.literal('analyze_hook'),
  opening: z
    .string()
    .min(1)
    .describe('The opening paragraph(s) of the article (first ~200 words)'),
})

const inputSchema = lazySchema(() =>
  z.discriminatedUnion('action', [
    analyzeHeadlineSchema,
    analyzeStructureSchema,
    viralityScoreSchema,
    analyzeHookSchema,
  ]),
)
type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

// ─── Output Schemas ──────────────────────────────────────────────────────────

const headlineAnalysisSchema = z.object({
  action: z.literal('analyze_headline'),
  headline: z.string(),
  platform: z.string(),
  // Dimensions
  length: z.object({
    chars: z.number(),
    assessment: z.string(),
  }),
  formulaMatch: z.object({
    detected: z.array(z.string()),
    confidence: z.number().min(0).max(1),
  }),
  emotionalTriggers: z.object({
    detected: z.array(z.string()),
    intensity: z.number().min(0).max(1),
  }),
  clarity: z.object({
    score: z.number().min(0).max(10),
    note: z.string(),
  }),
  curiosityGap: z.object({
    score: z.number().min(0).max(10),
    note: z.string(),
  }),
  powerWords: z.object({
    found: z.array(z.string()),
    count: z.number(),
  }),
  suggestions: z.array(z.string()),
  overallScore: z.number().min(0).max(10),
})

const structureAnalysisSchema = z.object({
  action: z.literal('analyze_structure'),
  wordCount: z.number(),
  templateMatch: z.object({
    detectedTemplates: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    description: z.string(),
  }),
  hookAnalysis: z.object({
    hookType: z.string(),
    hookPresent: z.boolean(),
    hookEffectiveness: z.number().min(0).max(10),
    suggestion: z.string(),
  }),
  paragraphPacing: z.object({
    avgWordsPerParagraph: z.number(),
    shortParagraphs: z.number(),
    mediumParagraphs: z.number(),
    longParagraphs: z.number(),
    assessment: z.string(),
  }),
  endingAnalysis: z.object({
    endingType: z.string(),
    effectiveness: z.number().min(0).max(10),
    suggestion: z.string(),
  }),
  sections: z.array(
    z.object({
      heading: z.string(),
      type: z.string(),
      wordCount: z.number(),
    }),
  ),
  overallScore: z.number().min(0).max(10),
})

const viralityScoreOutputSchema = z.object({
  action: z.literal('virality_score'),
  headline: z.string(),
  overallScore: z.number().min(0).max(100),
  dimensions: z.object({
    headlineEffectiveness: z.number().min(0).max(10),
    openingHook: z.number().min(0).max(10),
    structure: z.number().min(0).max(10),
    readability: z.number().min(0).max(10),
    emotionalAppeal: z.number().min(0).max(10),
    practicalValue: z.number().min(0).max(10),
    shareability: z.number().min(0).max(10),
  }),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  recommendations: z.array(z.string()),
  platformTips: z.string().optional(),
})

const hookAnalysisSchema = z.object({
  action: z.literal('analyze_hook'),
  hookType: z.string(),
  identifiedPatterns: z.array(z.string()),
  effectiveness: z.object({
    attention: z.number().min(0).max(10),
    curiosity: z.number().min(0).max(10),
    relevance: z.number().min(0).max(10),
    overall: z.number().min(0).max(10),
  }),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
})

const outputSchema = lazySchema(() =>
  z.union([
    headlineAnalysisSchema,
    structureAnalysisSchema,
    viralityScoreOutputSchema,
    hookAnalysisSchema,
  ]),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

// ─── Constants ───────────────────────────────────────────────────────────────

// Known headline formulas for detection
const HEADLINE_FORMULAS: Array<{
  name: string
  patterns: RegExp[]
  weight: number
}> = [
  {
    name: '数字清单',
    patterns: [/\d+\s*[个个项条种步招]/],
    weight: 0.9,
  },
  {
    name: '疑问式',
    patterns: [/^为什么/, /^如何/, /^怎么/, /\?$/, /？$/],
    weight: 0.8,
  },
  {
    name: '对比式',
    patterns: [/vs/i, /对比/, /还是/, / VS /],
    weight: 0.7,
  },
  {
    name: '悬念式',
    patterns: [/秘密/, /真相/, /不为人知/, /背后/, /内幕/],
    weight: 0.8,
  },
  {
    name: '否定式',
    patterns: [/别再/, /不要/, /别再/, /拒绝/, /不是/],
    weight: 0.7,
  },
  {
    name: '利益式',
    patterns: [/这样做/, /学会/, /掌握/, /提升/, /倍增/, /效率/],
    weight: 0.7,
  },
  {
    name: '新闻式',
    patterns: [/刚刚/, /突发/, /最新/, /重磅/, /官宣/],
    weight: 0.8,
  },
  {
    name: '身份式',
    patterns: [/写给/, /给.*的/, /.*人必/, /.*指南/, /.*手册/],
    weight: 0.6,
  },
  {
    name: '故事式',
    patterns: [/从.*到/, /我.*了/, /经历/, /那年/, /那天/],
    weight: 0.6,
  },
  {
    name: '反常识',
    patterns: [/其实/, /是错的/, /真相/, /颠覆/, /你可能不知道/],
    weight: 0.8,
  },
]

// Power words that increase click-through
const POWER_WORDS = new Set([
  '惊人', '震撼', '疯狂', '难以置信', '不可思议',
  '免费', '独家', '限时', '最后', '紧急',
  '秘密', '真相', '内幕', '揭秘', '曝光',
  '简单', '快速', '容易', '高效', '立即',
  '终极', '完整', '权威', '专业', '官方',
  '最新', '首发', '首次', '前所未有', '革命性',
  '你', '你的', '这', '这个', '这些',
  '为什么', '如何', '怎样', '什么', '何时',
  '顶级', '最佳', '第一', '领先', '首选',
  '省钱', '赚钱', '增长', '暴涨', '翻倍',
  '恐怖', '危险', '警告', '注意', '千万别',
])

const EMOTIONAL_TRIGGERS: Array<{ word: string; emotion: string; intensity: number }> = [
  { word: '震惊', emotion: 'surprise', intensity: 0.9 },
  { word: '激动', emotion: 'excitement', intensity: 0.8 },
  { word: '愤怒', emotion: 'anger', intensity: 0.9 },
  { word: '感动', emotion: 'warmth', intensity: 0.7 },
  { word: '泪目', emotion: 'sadness', intensity: 0.8 },
  { word: '可怕', emotion: 'fear', intensity: 0.8 },
  { word: '希望', emotion: 'hope', intensity: 0.6 },
  { word: '后悔', emotion: 'regret', intensity: 0.7 },
  { word: '温暖', emotion: 'warmth', intensity: 0.6 },
  { word: '焦虑', emotion: 'anxiety', intensity: 0.7 },
  { word: '骄傲', emotion: 'pride', intensity: 0.6 },
  { word: '羡慕', emotion: 'envy', intensity: 0.6 },
  { word: '恶心', emotion: 'disgust', intensity: 0.7 },
  { word: '惊喜', emotion: 'surprise', intensity: 0.8 },
  { word: '恐惧', emotion: 'fear', intensity: 0.9 },
]

// Hook types
const HOOK_PATTERNS: Array<{
  name: string
  patterns: RegExp[]
}> = [
  {
    name: '数据钩子',
    patterns: [/据统计/, /数据显示/, /\d+%/, /\d+万/, /\d+亿/, /同比增长/],
  },
  {
    name: '故事钩子',
    patterns: [/上个月/, /去年/, /那天/, /遇到/, /有个朋友/, /曾经/],
  },
  {
    name: '问题钩子',
    patterns: [/你有没有想过/, /你是否/, /为什么.*？/, /如何.*？/],
  },
  {
    name: '断言钩子',
    patterns: [/大多数.*是错的/, /其实你/, /本质上/, /核心是/],
  },
  {
    name: '场景钩子',
    patterns: [/凌晨.*点/, /你.*的时候/, /当你/, /每次.*时/],
  },
  {
    name: '对比钩子',
    patterns: [/同样是/, /有人.*有人/, /一边.*一边/, /vs/i],
  },
  {
    name: '引用钩子',
    patterns: [/说过/, /有句话/, /名言/, /曾言/, /曰/],
  },
]

// Ending types
const ENDING_PATTERNS: Array<{
  name: string
  patterns: RegExp[]
}> = [
  {
    name: '行动号召',
    patterns: [/现在.*就/, /立即/, /打开.*吧/, /试试/, /开始.*吧/],
  },
  {
    name: '金句升华',
    patterns: [/说到底/, /归根结底/, /其实/, /最后/],
  },
  {
    name: '开放提问',
    patterns: [/你怎么看/, /评论区/, /告诉我/, /说说你的/, /如果是你/],
  },
  {
    name: '预告钩子',
    patterns: [/下篇/, /下一篇/, /下次/, /下一期/, /未完待续/],
  },
  {
    name: '清单总结',
    patterns: [/最后总结/, /综上所述/, /总结一下/, /简单来说/, /一句话/],
  },
]

// Viral templates
const VIRAL_TEMPLATES: Array<{
  name: string
  patterns: RegExp[]
}> = [
  {
    name: '认知颠覆型',
    patterns: [/其实/, /真相/, /错的/, /颠覆/, /大多数人/],
  },
  {
    name: '深度分析型',
    patterns: [/为什么/, /底层/, /本质/, /逻辑/, /机制/, /拆解/],
  },
  {
    name: '故事叙事型',
    patterns: [/那年/, /那天/, /开始/, /后来/, /最终/, /回首/],
  },
  {
    name: '清单干货型',
    patterns: [/学会/, /掌握/, /方法/, /技巧/, /步骤/, /指南/],
  },
  {
    name: '争议挑战型',
    patterns: [/劝你/, /正在毁掉/, /别再/, /警惕/, /警告/],
  },
]

// Platform-specific headline recommendations
const PLATFORM_TIPS: Record<string, string[]> = {
  wechat: [
    '公众号标题前 15 字必须包含核心信息，因为折叠后只显示这些',
    '公众号推荐 20-30 字标题，信息量大但不过长',
    '公众号适合疑问式和悬念式，打开率最高',
    '避免纯英文标题，降低打开率',
  ],
  zhihu: [
    '知乎标题本身由问题决定，专注于在问题中做关键词覆盖',
    '开头 200-300 字必须有核心观点',
    '适合深度分析型，3000-8000 字最佳',
  ],
  xiaohongshu: [
    '小红书标题最多 20 字，必须简短有力',
    '使用表情符号增强视觉吸引力：✨🔥✅',
    '公式：情绪词 + 场景 + 结果',
    '封面文字 5-10 字，字体大、对比强',
  ],
  toutiao: [
    '头条利益直给，简单粗暴',
    '数字往标题放',
    '开头必须快速进入主题，完读率是核心指标',
  ],
}

// ─── Analysis Functions ──────────────────────────────────────────────────────

function analyzeHeadlineText(
  headline: string,
  platform: string,
): z.infer<typeof headlineAnalysisSchema> {
  const chars = headline.length

  // Length assessment
  let lengthAssessment: string
  if (chars <= 10) lengthAssessment = '过短，缺少信息量'
  else if (chars <= 15) lengthAssessment = '偏短，适合小红书风格'
  else if (chars <= 20) lengthAssessment = '适中偏短，适合社交媒体'
  else if (chars <= 30) lengthAssessment = '理想长度，信息量充足'
  else if (chars <= 40) lengthAssessment = '偏长，适合公众号深度文章'
  else lengthAssessment = '过长，可能被截断，注意核心信息前置'

  // Formula detection
  const detectedFormulas: string[] = []
  for (const formula of HEADLINE_FORMULAS) {
    for (const pattern of formula.patterns) {
      if (pattern.test(headline)) {
        detectedFormulas.push(formula.name)
        break
      }
    }
  }
  const formulaConfidence = detectedFormulas.length > 0
    ? Math.min(0.5 + detectedFormulas.length * 0.2, 0.95)
    : 0.1

  // Emotional trigger detection
  const detectedEmotions: string[] = []
  let totalEmotionIntensity = 0
  for (const trigger of EMOTIONAL_TRIGGERS) {
    if (headline.includes(trigger.word)) {
      detectedEmotions.push(`${trigger.word} (${trigger.emotion})`)
      totalEmotionIntensity += trigger.intensity
    }
  }
  const emotionIntensity = detectedEmotions.length > 0
    ? Math.min(totalEmotionIntensity / detectedEmotions.length, 1)
    : 0

  // Power words
  const foundPowerWords: string[] = []
  for (const word of POWER_WORDS) {
    if (headline.includes(word)) {
      foundPowerWords.push(word)
    }
  }

  // Clarity assessment
  const clarityScore = (() => {
    let score = 7
    if (chars < 8) score -= 2 // too short to be clear
    if (chars > 50) score -= 2 // too long, hard to parse
    if (detectedFormulas.length === 0) score -= 1 // no clear formula
    if (detectedFormulas.length > 3) score -= 1 // too many formulas, confusing
    return Math.max(1, Math.min(10, score))
  })()

  // Curiosity gap
  const curiosityScore = (() => {
    let score = 5
    if (detectedEmotions.length > 0) score += 2
    if (headline.includes('为什么') || headline.includes('如何')) score += 2
    if (headline.includes('秘密') || headline.includes('真相')) score += 2
    if (headline.includes('?' ) || headline.includes('？')) score += 1
    if (foundPowerWords.length > 2) score += 1
    if (chars < 10) score -= 2 // too short to create curiosity
    return Math.max(1, Math.min(10, score))
  })()

  // Suggestions
  const suggestions: string[] = []
  if (chars > 40) suggestions.push('标题过长，建议缩减到 30 字以内，核心信息前置')
  if (chars < 8) suggestions.push('标题过短，建议增加具体信息或数字')
  if (detectedFormulas.length === 0) suggestions.push('未检测到明确的标题公式，建议套用数字清单/疑问式/对比式等已知公式')
  if (emotionIntensity < 0.3) suggestions.push('情感触发较弱，建议加入情感化词汇增强共鸣')
  if (clarityScore < 5) suggestions.push('标题清晰度不足，确保读者能在 2 秒内理解文章主题')
  if (curiosityScore < 5) suggestions.push('好奇心缺口较小，建议制造信息缺口让读者想点击')

  // Overall score (weighted)
  const overallScore = Math.round(
    (clarityScore * 0.3 + curiosityScore * 0.35 + (detectedFormulas.length > 0 ? 7 : 3) * 0.2 + (emotionIntensity * 10) * 0.15) * 10
  ) / 10

  return {
    action: 'analyze_headline',
    headline,
    platform,
    length: { chars, assessment: lengthAssessment },
    formulaMatch: {
      detected: detectedFormulas,
      confidence: Math.round(formulaConfidence * 100) / 100,
    },
    emotionalTriggers: {
      detected: detectedEmotions,
      intensity: Math.round(emotionIntensity * 100) / 100,
    },
    clarity: { score: clarityScore, note: clarityScore >= 7 ? '清晰度良好' : clarityScore >= 5 ? '清晰度一般' : '清晰度不足' },
    curiosityGap: { score: curiosityScore, note: curiosityScore >= 7 ? '好奇心驱动强' : curiosityScore >= 5 ? '好奇心驱动中等' : '好奇心驱动弱' },
    powerWords: { found: foundPowerWords, count: foundPowerWords.length },
    suggestions,
    overallScore,
  }
}

function analyzeHookText(opening: string): z.infer<typeof hookAnalysisSchema> {
  const detectedPatterns: string[] = []
  let detectedHookType = '未检测到明确钩子类型'

  for (const hook of HOOK_PATTERNS) {
    for (const pattern of hook.patterns) {
      if (pattern.test(opening)) {
        detectedPatterns.push(hook.name)
        detectedHookType = hook.name
        break
      }
    }
  }

  // Effectiveness scoring
  const attentionScore = (() => {
    let score = 5
    if (detectedPatterns.length > 0) score += 2
    if (opening.length < 50) score -= 1
    if (opening.length > 300) score -= 1
    // Check for immediate engagement
    if (/^\d+/.test(opening)) score += 1 // starts with number
    if (/^"/.test(opening) || /^'/.test(opening)) score += 1 // starts with quote
    if (opening.includes('\n')) score += 1 // uses line break for impact
    return Math.max(1, Math.min(10, score))
  })()

  const curiosityScore = (() => {
    let score = 5
    if (detectedPatterns.length > 0) score += 1
    if (opening.includes('但是') || opening.includes('然而') || opening.includes('不过')) score += 1
    if (opening.includes('?' ) || opening.includes('？')) score += 1
    if (opening.includes('秘密') || opening.includes('真相')) score += 1
    return Math.max(1, Math.min(10, score))
  })()

  const relevanceScore = (() => {
    let score = 7
    if (opening.includes('你') || opening.includes('你的')) score += 1
    if (opening.length < 80) score -= 2
    return Math.max(1, Math.min(10, score))
  })()

  const overall = Math.round((attentionScore + curiosityScore + relevanceScore) / 3 * 10) / 10

  // Strengths & improvements
  const strengths: string[] = []
  const improvements: string[] = []

  if (detectedPatterns.length > 0) {
    strengths.push(`使用${detectedHookType}，能快速吸引注意力`)
  } else {
    improvements.push('开头缺少明确的钩子策略，建议使用数据/故事/问题/断言等钩子')
  }
  if (relevanceScore >= 7) strengths.push('与读者相关，能引发共鸣')
  else improvements.push('增加"你"或场景描写，让读者感到与自己相关')
  if (curiosityScore >= 7) strengths.push('制造了有效的好奇心缺口')
  else improvements.push('引入对立或反常元素，制造信息缺口')
  if (attentionScore < 6) improvements.push('开头冲击力不足，建议用更具体、更出乎意料的信息开场')

  return {
    action: 'analyze_hook',
    hookType: detectedHookType,
    identifiedPatterns: detectedPatterns,
    effectiveness: {
      attention: attentionScore,
      curiosity: curiosityScore,
      relevance: relevanceScore,
      overall,
    },
    strengths,
    improvements,
  }
}

function analyzeStructureText(
  content: string,
): z.infer<typeof structureAnalysisSchema> {
  const wordCount = content.length

  // Detect templates
  const detectedTemplates: string[] = []
  for (const template of VIRAL_TEMPLATES) {
    let matchCount = 0
    for (const pattern of template.patterns) {
      if (pattern.test(content)) matchCount++
    }
    if (matchCount >= 2) {
      detectedTemplates.push(template.name)
    }
  }

  const templateConfidence = detectedTemplates.length > 0
    ? Math.min(0.3 + detectedTemplates.length * 0.2, 0.9)
    : 0.1

  const templateDescription = detectedTemplates.length > 0
    ? `文章结构类似「${detectedTemplates.join('」+「')}」模板`
    : '未匹配到已知爆款模板'

  // Paragraph analysis
  const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0)
  const avgWordsPerParagraph = paragraphs.length > 0
    ? Math.round(wordCount / paragraphs.length)
    : 0

  let shortParas = 0
  let mediumParas = 0
  let longParas = 0
  for (const p of paragraphs) {
    const len = p.length
    if (len < 50) shortParas++
    else if (len < 200) mediumParas++
    else longParas++
  }

  const paraRatio = shortParas / Math.max(paragraphs.length, 1)
  let pacingAssessment: string
  if (paraRatio > 0.5) pacingAssessment = '段落偏短，节奏快，适合社交媒体阅读'
  else if (paraRatio > 0.3) pacingAssessment = '段落节奏良好，长短结合'
  else pacingAssessment = '段落偏长，建议增加短段落来改善阅读节奏'

  // Ending analysis
  const last300 = content.slice(-300)
  let endingType = '未分类'
  for (const ending of ENDING_PATTERNS) {
    for (const pattern of ending.patterns) {
      if (pattern.test(last300)) {
        endingType = ending.name
        break
      }
    }
    if (endingType !== '未分类') break
  }

  const endingEffectiveness = endingType !== '未分类' ? 7 : 4
  const endingSuggestion = endingType !== '未分类'
    ? `使用${endingType}，有效`
    : '结尾缺少明确的收束策略，建议使用行动号召/金句升华/开放提问等'

  // Hook analysis (first paragraph)
  const firstPara = paragraphs[0] || ''
  const hookResult = analyzeHookText(firstPara)

  // Section detection (headings)
  const headingLines = content.split('\n').filter(line => /^#{1,3}\s/.test(line))
  const sections = headingLines.map(h => {
    const level = h.match(/^#+/)?.[0].length || 1
    const title = h.replace(/^#+\s*/, '').trim()
    return {
      heading: title,
      type: level === 1 ? '主标题' : level === 2 ? '章节' : '子章节',
      wordCount: title.length,
    }
  })

  // Structure score
  let structureScore = 6
  if (detectedTemplates.length > 0) structureScore += 1
  if (hookResult.effectiveness.overall >= 7) structureScore += 1
  if (paraRatio > 0.2 && paraRatio < 0.6) structureScore += 1
  if (headingLines.length >= 3) structureScore += 1
  if (endingType !== '未分类') structureScore += 1
  structureScore = Math.max(1, Math.min(10, structureScore))

  return {
    action: 'analyze_structure',
    wordCount,
    templateMatch: {
      detectedTemplates,
      confidence: Math.round(templateConfidence * 100) / 100,
      description: templateDescription,
    },
    hookAnalysis: {
      hookType: hookResult.hookType,
      hookPresent: hookResult.identifiedPatterns.length > 0,
      hookEffectiveness: hookResult.effectiveness.overall,
      suggestion: hookResult.improvements[0] || '开头有效',
    },
    paragraphPacing: {
      avgWordsPerParagraph,
      shortParagraphs: shortParas,
      mediumParagraphs: mediumParas,
      longParagraphs: longParas,
      assessment: pacingAssessment,
    },
    endingAnalysis: {
      endingType,
      effectiveness: endingEffectiveness,
      suggestion: endingSuggestion,
    },
    sections,
    overallScore: structureScore,
  }
}

function computeViralityScore(
  headline: string,
  content: string,
  platform: string,
): z.infer<typeof viralityScoreOutputSchema> {
  const headlineResult = analyzeHeadlineText(headline, platform)
  const hookResult = analyzeHookText(content.slice(0, 500))
  const structureResult = analyzeStructureText(content)

  const dimensions = {
    headlineEffectiveness: headlineResult.overallScore,
    openingHook: hookResult.effectiveness.overall,
    structure: structureResult.overallScore,
    readability: Math.min(10, Math.round(structureResult.paragraphPacing.avgWordsPerParagraph > 0 && structureResult.paragraphPacing.avgWordsPerParagraph < 80 ? 7 + (structureResult.paragraphPacing.shortParagraphs > 3 ? 2 : 0) : 5)),
    emotionalAppeal: Math.min(10, Math.round((headlineResult.emotionalTriggers.intensity * 5) + (hookResult.effectiveness.curiosity > 5 ? 3 : 1) + (headlineResult.curiosityGap.score > 5 ? 2 : 1))),
    practicalValue: content.includes('步骤') || content.includes('方法') || content.includes('技巧') || content.includes('工具') ? 8 : 5,
    shareability: Math.min(10, Math.round((headlineResult.emotionalTriggers.intensity * 4) + (headlineResult.curiosityGap.score > 6 ? 3 : 1) + (hookResult.effectiveness.overall > 7 ? 2 : 1))),
  }

  const overallScore = Math.round(
    (dimensions.headlineEffectiveness * 0.20 +
      dimensions.openingHook * 0.15 +
      dimensions.structure * 0.15 +
      dimensions.readability * 0.10 +
      dimensions.emotionalAppeal * 0.15 +
      dimensions.practicalValue * 0.10 +
      dimensions.shareability * 0.15) * 10,
  )

  // Strengths
  const strengths: string[] = []
  if (dimensions.headlineEffectiveness >= 7) strengths.push('标题有效，有吸引力')
  else if (dimensions.headlineEffectiveness >= 5) strengths.push('标题基本可用')
  if (dimensions.openingHook >= 7) strengths.push('开头钩子强，能抓住读者')
  if (dimensions.structure >= 7) strengths.push('结构清晰，符合爆款模板')
  if (dimensions.readability >= 7) strengths.push('可读性好，段落节奏佳')
  if (dimensions.emotionalAppeal >= 7) strengths.push('情感共鸣强，容易引发转发')
  if (dimensions.practicalValue >= 7) strengths.push('实用价值高，读者愿意收藏')
  if (dimensions.shareability >= 7) strengths.push('分享驱动力强，具备传播基因')
  if (headlineResult.formulaMatch.detected.length > 0) strengths.push(`使用了${headlineResult.formulaMatch.detected[0]}标题公式`)
  if (strengths.length === 0) strengths.push('内容有基础框架，但各维度都有提升空间')

  // Weaknesses
  const weaknesses: string[] = []
  if (dimensions.headlineEffectiveness < 6) weaknesses.push('标题吸引力不足')
  if (dimensions.openingHook < 6) weaknesses.push('开头缺少有效钩子')
  if (dimensions.structure < 6) weaknesses.push('结构不够清晰')
  if (dimensions.readability < 6) weaknesses.push('段落节奏有待优化')
  if (dimensions.emotionalAppeal < 6) weaknesses.push('情感触发不足')
  if (dimensions.practicalValue < 6) weaknesses.push('实用价值不够突出')
  if (dimensions.shareability < 6) weaknesses.push('分享驱动力弱')
  if (headlineResult.curiosityGap.score < 6) weaknesses.push('好奇心缺口不够')
  if (headlineResult.length.chars > 40) weaknesses.push('标题过长')

  // Recommendations
  const recommendations: string[] = [
    ...headlineResult.suggestions.slice(0, 2),
    ...hookResult.improvements.slice(0, 1),
  ]
  if (structureResult.endingAnalysis.effectiveness < 6) {
    recommendations.push(structureResult.endingAnalysis.suggestion)
  }
  if (structureResult.sections.length < 3) {
    recommendations.push('增加小标题划分章节，改善阅读体验')
  }
  if (recommendations.length === 0) recommendations.push('整体质量较高，可尝试在不同平台分发测试效果')

  // Platform tips
  const platformKey = (platform || 'general') as keyof typeof PLATFORM_TIPS
  const platformTips = PLATFORM_TIPS[platformKey]
    ? PLATFORM_TIPS[platformKey].slice(0, 3).join('\n')
    : undefined

  return {
    action: 'virality_score',
    headline,
    overallScore,
    dimensions,
    strengths,
    weaknesses,
    recommendations,
    platformTips,
  }
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

function getToolUseSummary(input: Record<string, unknown>): string {
  const action = (input as { action?: string }).action
  switch (action) {
    case 'analyze_headline':
      return `"${(input as { headline?: string }).headline}"`
    case 'analyze_structure':
      return 'article structure'
    case 'virality_score':
      return `"${(input as { headline?: string }).headline}"`
    case 'analyze_hook':
      return 'opening hook'
    default:
      return 'content analysis'
  }
}

export const ContentAnalystTool = buildTool({
  name: CONTENT_ANALYST_TOOL_NAME,
  searchHint: 'analyze content virality, score headlines, extract patterns',
  shouldDefer: true,
  maxResultSizeChars: 50_000,

  description(_input) {
    return 'Analyze content for viral potential and optimization'
  },
  userFacingName() {
    return 'Content Analyst'
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
  isReadOnly() {
    return true
  },

  async prompt() {
    return DESCRIPTION
  },

  async validateInput(input) {
    const action = (input as { action?: string }).action
    if (!action) {
      return {
        result: false,
        message: 'Error: "action" field is required. Must be one of: analyze_headline, analyze_structure, virality_score, analyze_hook.',
        errorCode: 1,
      }
    }
    return { result: true }
  },

  async call(input, _context) {
    const { action } = input as Input

    switch (action) {
      case 'analyze_headline': {
        const { headline, platform = 'general' } = input as z.infer<typeof analyzeHeadlineSchema>
        const result = analyzeHeadlineText(headline, platform)
        return { data: result }
      }

      case 'analyze_structure': {
        const { content } = input as z.infer<typeof analyzeStructureSchema>
        const result = analyzeStructureText(content)
        return { data: result }
      }

      case 'virality_score': {
        const { headline, content, platform = 'general' } = input as z.infer<typeof viralityScoreSchema>
        const result = computeViralityScore(headline, content, platform)
        return { data: result }
      }

      case 'analyze_hook': {
        const { opening } = input as z.infer<typeof analyzeHookSchema>
        const result = analyzeHookText(opening)
        return { data: result }
      }

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
