export const LLMPEG_TOOL_NAME = 'llmpeg'

export const DESCRIPTION = `
Generate a single-line ffmpeg command from natural language instructions.

This tool is an inline TypeScript replacement for the standalone llmpeg bash script,
and requires no external LLM API key.

Behavior:
- Parses common ffmpeg intents from plain language
- Produces a one-line ffmpeg command
- Keeps output in same directory as input when input path is detectable
`

export function getPrompt(): string {
  return DESCRIPTION
}
