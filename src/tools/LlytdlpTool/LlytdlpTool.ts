import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'
import { DESCRIPTION, getPrompt, LLYTDLP_TOOL_NAME } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    prompt: z.string().min(1).describe('Natural language download request for yt-dlp'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean().describe('Whether a command was generated'),
    command: z.string().describe('Generated yt-dlp command'),
    detectedUrl: z.string().optional().describe('URL detected from input'),
    mode: z
      .enum(['video', 'audio', 'playlist'])
      .describe('Detected generation mode for yt-dlp command'),
    message: z.string().describe('Status or validation message'),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const URL_RE = /(https?:\/\/[^\s"'<>]+)|(www\.[^\s"'<>]+)/i

function quoteSingle(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }
  return `https://${trimmed}`
}

function hasAny(text: string, words: string[]): boolean {
  return words.some(word => text.includes(word))
}

function buildAudioCommand(url: string, normalizedPrompt: string): string {
  const wantM4a = hasAny(normalizedPrompt, ['m4a', 'aac'])
  const wantWav = hasAny(normalizedPrompt, ['wav'])
  const format = wantM4a ? 'm4a' : wantWav ? 'wav' : 'mp3'

  const qualityMatch = normalizedPrompt.match(/(?:\b|\s)(96|128|160|192|256|320)k(?:\b|\s)/i)
  const quality = qualityMatch ? qualityMatch[1] : '192'

  return [
    'yt-dlp',
    '--ignore-errors',
    '--no-overwrites',
    '-x',
    '--audio-format',
    format,
    '--audio-quality',
    `${quality}K`,
    '-o',
    quoteSingle('%(title)s.%(ext)s'),
    quoteSingle(url),
  ].join(' ')
}

function buildVideoCommand(url: string, normalizedPrompt: string, playlist: boolean): string {
  const mp4 = hasAny(normalizedPrompt, ['mp4'])
  const webm = hasAny(normalizedPrompt, ['webm'])
  const withSubs = hasAny(normalizedPrompt, ['subtitle', 'subtitles', '字幕'])
  const withThumb = hasAny(normalizedPrompt, ['thumbnail', '封面', '缩略图'])

  const formatArgs: string[] = []
  if (webm) {
    formatArgs.push('-f', quoteSingle('bv*[ext=webm]+ba[ext=webm]/b[ext=webm]/best'))
  } else {
    formatArgs.push('-f', quoteSingle('bv*+ba/best'))
  }

  if (mp4) {
    formatArgs.push('--merge-output-format', 'mp4')
  }

  const outputTemplate = playlist
    ? '%(playlist_title|playlist)s/%(playlist_index)03d - %(title)s.%(ext)s'
    : '%(title)s.%(ext)s'

  const args = [
    'yt-dlp',
    '--ignore-errors',
    '--no-overwrites',
    ...formatArgs,
    '-o',
    quoteSingle(outputTemplate),
  ]

  if (withSubs) {
    args.push('--write-sub', '--sub-langs', 'all,-live_chat', '--embed-subs')
  }

  if (withThumb) {
    args.push('--write-thumbnail')
  }

  args.push(quoteSingle(url))
  return args.join(' ')
}

export const LlytdlpTool = buildTool({
  name: LLYTDLP_TOOL_NAME,
  searchHint: 'natural language to yt-dlp command',
  maxResultSizeChars: 25_000,
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
    return 'LlytdlpTool'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.prompt
  },
  async call(input: Input) {
    const normalizedPrompt = input.prompt.toLowerCase()
    const urlMatch = input.prompt.match(URL_RE)

    if (!urlMatch?.[0]) {
      return {
        data: {
          success: false,
          command: '',
          mode: 'video' as const,
          message: 'No URL detected. Please include a video/playlist URL in your request.',
        },
      }
    }

    const url = normalizeUrl(urlMatch[0])
    const isPlaylist = hasAny(normalizedPrompt, ['playlist', '播放列表', '列表'])
    const audioOnly = hasAny(normalizedPrompt, [
      'audio',
      'mp3',
      'm4a',
      'wav',
      'extract audio',
      '提取音频',
      '仅音频',
    ])

    const command = audioOnly
      ? buildAudioCommand(url, normalizedPrompt)
      : buildVideoCommand(url, normalizedPrompt, isPlaylist)

    return {
      data: {
        success: true,
        command,
        detectedUrl: url,
        mode: audioOnly ? ('audio' as const) : isPlaylist ? ('playlist' as const) : ('video' as const),
        message: 'yt-dlp command generated.',
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: content.success ? content.command : `llytdlp failed: ${content.message}`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
