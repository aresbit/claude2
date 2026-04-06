import path from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'
import { DESCRIPTION, getPrompt, LLMPEG_TOOL_NAME } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    prompt: z
      .string()
      .min(1)
      .describe('Natural language media processing request to convert into ffmpeg command'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean().describe('Whether a command was generated'),
    command: z.string().describe('Generated ffmpeg command'),
    operation: z
      .enum(['convert', 'extract_audio', 'remove_audio', 'resize', 'trim', 'compress', 'custom'])
      .describe('Detected ffmpeg operation'),
    inputFile: z.string().optional().describe('Detected input media path'),
    outputFile: z.string().optional().describe('Inferred output media path'),
    message: z.string().describe('Status or validation message'),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const MEDIA_EXTS = [
  'mp4',
  'mov',
  'mkv',
  'avi',
  'webm',
  'flv',
  'wmv',
  'mp3',
  'm4a',
  'aac',
  'wav',
  'flac',
]

function quoteSingle(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function findInputFile(text: string): string | null {
  const extGroup = MEDIA_EXTS.join('|')
  // Prefer quoted paths first so users can provide files with spaces.
  const quotedRe = new RegExp(`["']([^"']+\\.(?:${extGroup}))["']`, 'i')
  const quotedMatch = text.match(quotedRe)
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim()
  }

  // Fallback: match a single non-whitespace token with media extension.
  // This avoids swallowing natural-language prefixes like "extract subtitles from ...".
  const tokenRe = new RegExp(`(?:^|\\s)([^\\s"'<>]+\\.(?:${extGroup}))(?=$|\\s|[),.;:!?])`, 'i')
  const tokenMatch = text.match(tokenRe)
  if (!tokenMatch?.[1]) return null
  return tokenMatch[1].trim()
}

function detectTargetFormat(text: string): string | null {
  const lowered = text.toLowerCase()
  const ordered = ['webm', 'mp4', 'mov', 'mkv', 'avi', 'mp3', 'wav', 'flac', 'aac', 'm4a']
  for (const fmt of ordered) {
    if (lowered.includes(fmt)) return fmt
  }
  return null
}

function inferOutputFile(inputFile: string, suffix: string, ext: string): string {
  const dir = path.dirname(inputFile)
  const parsed = path.parse(inputFile)
  return path.join(dir, `${parsed.name}_${suffix}.${ext}`)
}

function detectOperation(text: string): Output['operation'] {
  const lowered = text.toLowerCase()

  if (
    lowered.includes('remove audio') ||
    lowered.includes('mute') ||
    lowered.includes('去音频') ||
    lowered.includes('移除音频')
  ) {
    return 'remove_audio'
  }

  if (
    lowered.includes('extract audio') ||
    lowered.includes('提取音频') ||
    lowered.includes('转音频')
  ) {
    return 'extract_audio'
  }

  if (
    lowered.includes('resize') ||
    lowered.includes('resolution') ||
    lowered.includes('分辨率')
  ) {
    return 'resize'
  }

  if (
    lowered.includes('trim') ||
    lowered.includes('cut') ||
    lowered.includes('裁剪') ||
    lowered.includes('截取')
  ) {
    return 'trim'
  }

  if (
    lowered.includes('compress') ||
    lowered.includes('压缩') ||
    lowered.includes('smaller size')
  ) {
    return 'compress'
  }

  if (
    lowered.includes('convert') ||
    lowered.includes('转成') ||
    lowered.includes('转换') ||
    lowered.includes('format')
  ) {
    return 'convert'
  }

  return 'custom'
}

function buildCommand(operation: Output['operation'], inputFile: string, prompt: string): { command: string; outputFile: string } {
  const targetFormat = detectTargetFormat(prompt) || path.extname(inputFile).replace('.', '') || 'mp4'

  switch (operation) {
    case 'remove_audio': {
      const outputFile = inferOutputFile(inputFile, 'noaudio', targetFormat)
      return {
        command: `ffmpeg -i ${quoteSingle(inputFile)} -c copy -an ${quoteSingle(outputFile)}`,
        outputFile,
      }
    }
    case 'extract_audio': {
      const audioFormat = ['wav', 'flac', 'aac', 'm4a'].includes(targetFormat) ? targetFormat : 'mp3'
      const outputFile = inferOutputFile(inputFile, 'audio', audioFormat)
      const codec = audioFormat === 'mp3' ? '-codec:a libmp3lame -q:a 2' : '-vn'
      return {
        command: `ffmpeg -i ${quoteSingle(inputFile)} -vn ${codec} ${quoteSingle(outputFile)}`,
        outputFile,
      }
    }
    case 'resize': {
      const sizeMatch = prompt.match(/(\d{3,4})\s*[xX]\s*(\d{3,4})/)
      const size = sizeMatch ? `${sizeMatch[1]}:${sizeMatch[2]}` : '1920:1080'
      const outputFile = inferOutputFile(inputFile, 'resized', targetFormat)
      return {
        command: `ffmpeg -i ${quoteSingle(inputFile)} -vf scale=${size} -c:a copy ${quoteSingle(outputFile)}`,
        outputFile,
      }
    }
    case 'trim': {
      const fromMatch = prompt.match(/(?:from|从)\s*(\d{1,2}:\d{2}(?::\d{2})?)/i)
      const toMatch = prompt.match(/(?:to|到)\s*(\d{1,2}:\d{2}(?::\d{2})?)/i)
      const start = fromMatch?.[1] || '00:00:00'
      const end = toMatch?.[1] || '00:00:10'
      const outputFile = inferOutputFile(inputFile, 'trimmed', targetFormat)
      return {
        command: `ffmpeg -i ${quoteSingle(inputFile)} -ss ${start} -to ${end} -c copy ${quoteSingle(outputFile)}`,
        outputFile,
      }
    }
    case 'compress': {
      const outputFile = inferOutputFile(inputFile, 'compressed', targetFormat)
      return {
        command: `ffmpeg -i ${quoteSingle(inputFile)} -c:v libx264 -crf 28 -preset medium -c:a aac -b:a 128k ${quoteSingle(outputFile)}`,
        outputFile,
      }
    }
    case 'convert':
    case 'custom':
    default: {
      const outputFile = inferOutputFile(inputFile, `in_${targetFormat}`, targetFormat)
      let codec = ''
      if (targetFormat === 'webm') {
        codec = '-c:v libvpx-vp9 -c:a libopus'
      } else if (targetFormat === 'mp4') {
        codec = '-c:v libx264 -c:a aac'
      }
      const codecPart = codec ? `${codec} ` : ''
      return {
        command: `ffmpeg -i ${quoteSingle(inputFile)} ${codecPart}${quoteSingle(outputFile)}`,
        outputFile,
      }
    }
  }
}

export const LlmpegTool = buildTool({
  name: LLMPEG_TOOL_NAME,
  searchHint: 'natural language to ffmpeg command',
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
    return 'LlmpegTool'
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
    const inputFile = findInputFile(input.prompt)
    if (!inputFile) {
      return {
        data: {
          success: false,
          command: '',
          operation: 'custom' as const,
          message: 'No input media file detected. Include a file path like input.mp4 in your prompt.',
        },
      }
    }

    const operation = detectOperation(input.prompt)
    const { command, outputFile } = buildCommand(operation, inputFile, input.prompt)

    return {
      data: {
        success: true,
        command,
        operation,
        inputFile,
        outputFile,
        message: 'ffmpeg command generated.',
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: content.success ? content.command : `llmpeg failed: ${content.message}`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
