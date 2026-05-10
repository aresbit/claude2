import { readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { getAutoMemPath } from '../memdir/paths.js'

/**
 * Read SCRATCHPAD.md content silently — returns null if not found or
 * unreadable. This bridges 临时记忆 (Temporary Memory) into context.
 */
async function readScratchpadSilent(memDir: string): Promise<string | null> {
  const scratchPath = join(memDir, 'SCRATCHPAD.md')
  if (!existsSync(scratchPath)) return null
  try {
    const content = await readFile(scratchPath, 'utf-8')
    return content.trim() || null
  } catch {
    return null
  }
}

/**
 * Auto-Trigger: Surfaces relevant memories into the model's context
 * without the model explicitly calling MemoryTool.search.
 *
 * From Manus article §5 (Manipulating Attention Through Repetition):
 * "By continuously rewriting the todo list, Manus rehearses its goals
 * near the end of the context — exploiting recency bias."
 *
 * This module auto-loads the REHEARSAL.md file (written by MemoryTool's
 * rehearse action) and injects it into the system prompt. When no explicit
 * rehearsal exists, it loads the most recent memories as a fallback.
 *
 * Nietzsche: "He who has a why to live can bear almost any how."
 * The auto-trigger gives the model its "why" — the accumulated
 * wisdom it has overcome to acquire.
 */

export interface AutoTriggerResult {
  /** Content to inject into context */
  content: string
  /** How many memories were surfaced */
  memoryCount: number
  /** Whether this was an explicit rehearsal or auto-fallback */
  source: 'rehearsal' | 'fallback' | 'none'
}

/**
 * Load the auto-triggered memory content for context injection.
 * Called by the context builder (src/context.ts) when assembling
 * the system prompt.
 *
 * Priority:
 * 1. REHEARSAL.md (explicitly rehearsed memories + auto-rehearsal)
 * 2. SCRATCHPAD.md (临时记忆 — session-scoped temporary memory)
 * 3. Recent memories from MEMORY.md index (auto-fallback)
 * 4. Empty (no memories available)
 */
export async function getAutoTriggerContent(): Promise<AutoTriggerResult> {
  const memDir = getAutoMemPath()

  // 1. Try explicit rehearsal file (工作记忆 + 主动记忆)
  const rehearsalPath = join(memDir, 'REHEARSAL.md')
  if (existsSync(rehearsalPath)) {
    try {
      const content = await readFile(rehearsalPath, 'utf-8')
      if (content.trim()) {
        // Also include SCRATCHPAD.md content if it exists (临时记忆)
        const scratchContent = await readScratchpadSilent(memDir)
        const combined = scratchContent
          ? `${content}\n\n<!-- SCRATCHPAD (临时记忆) -->\n${scratchContent}\n`
          : content
        const memoryCount = (combined.match(/^## /gm) || []).length
        return {
          content: `\n<!-- ⚡ AUTO-TRIGGERED MEMORIES (Rehearsal) -->\n${combined}\n<!-- END REHEARSAL -->\n`,
          memoryCount,
          source: 'rehearsal',
        }
      }
    } catch {
      // Fall through to fallback
    }
  }

  // 2. Try standalone SCRATCHPAD.md (临时记忆 fallback)
  const scratchContent = await readScratchpadSilent(memDir)
  if (scratchContent) {
    return {
      content: `\n<!-- ⚡ SCRATCHPAD (临时记忆) -->\n${scratchContent}\n<!-- END SCRATCHPAD -->\n`,
      memoryCount: 1,
      source: 'rehearsal',
    }
  }

  // 3. Fallback: load recent memory index entries
  const indexPath = join(memDir, 'MEMORY.md')
  if (existsSync(indexPath)) {
    try {
      const indexContent = await readFile(indexPath, 'utf-8')
      const entries = indexContent
        .split('\n')
        .filter(line => line.startsWith('- ['))
        .slice(-10) // Last 10 entries (most recent)

      if (entries.length > 0) {
        const content = `\n<!-- ⚡ AUTO-TRIGGERED MEMORIES (Recent) -->\n## Recent Memories\n\n${entries.join('\n')}\n<!-- END AUTO-TRIGGER -->\n`
        return {
          content,
          memoryCount: entries.length,
          source: 'fallback',
        }
      }
    } catch {
      // No fallback available
    }
  }

  return { content: '', memoryCount: 0, source: 'none' }
}

/**
 * Search memories by a domain/topic keyword and return formatted content
 * for context injection. Used when the model is actively working in a
 * specific domain and needs relevant past learnings surfaced.
 *
 * From Manus article §4 (Filesystem as Context):
 * The filesystem holds the truth; this function retrieves it on demand.
 */
export async function getDomainContext(
  domain: string,
): Promise<AutoTriggerResult> {
  const memDir = getAutoMemPath()

  if (!existsSync(memDir)) {
    return { content: '', memoryCount: 0, source: 'none' }
  }

  const { readdir, readFile: rf } = await import('fs/promises')
  const files = await readdir(memDir)
  const memoryFiles = files.filter(f => f.endsWith('.md') && f !== 'MEMORY.md' && f !== 'REHEARSAL.md' && f !== 'SCRATCHPAD.md')

  const domainLower = domain.toLowerCase()
  const relevant: string[] = []

  for (const file of memoryFiles) {
    if (relevant.length >= 5) break
    try {
      const fileContent = await rf(join(memDir, file), 'utf-8')
      if (fileContent.toLowerCase().includes(domainLower)) {
        // Extract name and first meaningful line
        const lines = fileContent.split('\n')
        const nameMatch = lines.find(l => l.startsWith('name:'))
        const descMatch = lines.find(l => l.startsWith('description:'))
        const name = nameMatch ? nameMatch.replace('name:', '').trim() : file.replace('.md', '')
        const desc = descMatch ? descMatch.replace('description:', '').trim() : ''
        relevant.push(`- **${name}**: ${desc}`)
      }
    } catch {
      // Skip unreadable files
    }
  }

  if (relevant.length === 0) {
    return { content: '', memoryCount: 0, source: 'none' }
  }

  const content = `\n<!-- ⚡ DOMAIN CONTEXT: ${domain} -->\n## Relevant Knowledge: ${domain}\n\n${relevant.join('\n')}\n<!-- END DOMAIN CONTEXT -->\n`
  return { content, memoryCount: relevant.length, source: 'fallback' }
}
