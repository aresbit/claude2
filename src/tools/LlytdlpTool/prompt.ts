export const LLYTDLP_TOOL_NAME = 'llytdlp'

export const DESCRIPTION = `
Generate a yt-dlp command from natural language instructions.

This tool is intended as an inline replacement for the standalone llytdlp bash script,
but without requiring any external LLM API key configuration.

Behavior:
- Parses user intent from plain language
- Produces a single-line yt-dlp command
- Applies safe defaults: --ignore-errors --no-overwrites
- Uses sensible output templates for video/audio/playlist cases
`

export function getPrompt(): string {
  return DESCRIPTION
}
