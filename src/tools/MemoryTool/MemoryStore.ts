import { readFile, writeFile, mkdir, readdir, stat, unlink } from 'fs/promises'
import { join, basename, dirname, relative, resolve } from 'path'
import { existsSync } from 'fs'
import { MEMORY_TYPES, type MemoryType } from '../../memdir/memoryTypes.js'
import { getAutoMemPath } from '../../memdir/paths.js'

export interface Memory {
  id: string
  type: MemoryType
  name: string
  description: string
  content: string
  tags?: string[]
  createdAt: Date
  updatedAt: Date
  filePath: string
}

export interface MemoryIndexEntry {
  id: string
  type: string
  name: string
  description: string
  filePath: string
  createdAt: Date
}

export class MemoryStore {
  private memoryDir: string
  private indexFile: string

  constructor(memoryDir?: string) {
    // Default memory directory: ~/.claude/projects/<encoded-project-path>/memory/
    // For now, use a simpler approach: project root/.claude/memory/
    this.memoryDir = memoryDir || this.getDefaultMemoryDir()
    this.indexFile = join(this.memoryDir, 'MEMORY.md')
  }

  private getDefaultMemoryDir(): string {
    // Use the same auto-memory directory as the rest of the system
    return getAutoMemPath()
  }

  private async ensureMemoryDir(): Promise<void> {
    if (!existsSync(this.memoryDir)) {
      await mkdir(this.memoryDir, { recursive: true })
    }
  }

  private generateMemoryId(type: string, name: string): string {
    const timestamp = Date.now()
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '-')
    return `${type}_${sanitizedName}_${timestamp}`
  }

  private generateFilename(memory: Omit<Memory, 'id' | 'filePath' | 'createdAt' | 'updatedAt'>): string {
    const timestamp = Date.now()
    const sanitizedName = memory.name.toLowerCase().replace(/[^a-z0-9]/g, '-')
    return `${memory.type}_${sanitizedName}_${timestamp}.md`
  }

  private formatMemoryFile(memory: Omit<Memory, 'filePath'>): string {
    const tagsLine = memory.tags && memory.tags.length > 0
      ? `tags: [${memory.tags.join(', ')}]\n`
      : ''
    const frontmatter = `---
name: ${memory.name}
description: ${memory.description}
type: ${memory.type}
${tagsLine}---

${memory.content}
`
    return frontmatter
  }

  private parseMemoryFile(content: string, filePath: string): Memory | null {
    try {
      const lines = content.split('\n')
      if (!lines[0].startsWith('---')) return null

      let frontmatterEnd = 1
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].startsWith('---')) {
          frontmatterEnd = i
          break
        }
      }

      const frontmatterLines = lines.slice(1, frontmatterEnd)
      const memoryContent = lines.slice(frontmatterEnd + 1).join('\n').trim()

      const frontmatter: Record<string, string> = {}
      for (const line of frontmatterLines) {
        const match = line.match(/^(\w+):\s*(.+)$/)
        if (match) {
          const [, key, value] = match
          frontmatter[key] = value
        }
      }

      // Parse tags from frontmatter (format: [tag1, tag2, tag3])
      let tags: string[] | undefined
      if (frontmatter.tags) {
        tags = frontmatter.tags
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map(t => t.trim())
          .filter(Boolean)
      }

      const filename = basename(filePath, '.md')
      const [type, ...nameParts] = filename.split('_')
      const name = nameParts.join('_').replace(/_(\d+)$/, '') // Remove timestamp

      return {
        id: filename,
        type: type as Memory['type'],
        name: frontmatter.name || name,
        description: frontmatter.description || '',
        content: memoryContent,
        tags,
        createdAt: new Date(),
        updatedAt: new Date(),
        filePath
      }
    } catch (error) {
      console.error('Failed to parse memory file:', error)
      return null
    }
  }

  async saveMemory(
    type: Memory['type'],
    name: string,
    description: string,
    content: string,
    tags?: string[]
  ): Promise<Memory> {
    await this.ensureMemoryDir()

    const filename = this.generateFilename({ type, name, description, content, tags })
    const filePath = join(this.memoryDir, filename)
    const id = this.generateMemoryId(type, name)

    const memory: Omit<Memory, 'filePath'> = {
      id,
      type,
      name,
      description,
      content,
      tags,
      createdAt: new Date(),
      updatedAt: new Date()
    }

    const fileContent = this.formatMemoryFile(memory)
    await writeFile(filePath, fileContent, 'utf-8')

    // Update index
    await this.updateIndex({
      id,
      type,
      name,
      description,
      filePath,
      createdAt: memory.createdAt
    })

    return { ...memory, filePath }
  }

  private async updateIndex(entry: MemoryIndexEntry): Promise<void> {
    await this.ensureMemoryDir()

    let indexContent = ''
    if (existsSync(this.indexFile)) {
      indexContent = await readFile(this.indexFile, 'utf-8')
    }

    const indexLine = `- [${entry.name}](${basename(entry.filePath)}) — ${entry.description}\n`
    indexContent += indexLine

    await writeFile(this.indexFile, indexContent, 'utf-8')
  }

  async searchMemories(query: string, type?: string, limit: number = 20): Promise<Memory[]> {
    await this.ensureMemoryDir()

    if (!existsSync(this.memoryDir)) {
      return []
    }

    const files = await readdir(this.memoryDir)
    const memoryFiles = files.filter(f => f.endsWith('.md') && f !== 'MEMORY.md')

    const memories: Memory[] = []
    for (const file of memoryFiles) {
      if (memories.length >= limit) break

      const filePath = join(this.memoryDir, file)
      try {
        const content = await readFile(filePath, 'utf-8')
        const memory = this.parseMemoryFile(content, filePath)

        if (memory) {
          // Word-level search: each query word must match somewhere
          const searchableText = `${memory.name} ${memory.description} ${memory.content} ${(memory.tags || []).join(' ')}`.toLowerCase()
          const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean)
          const matches = queryWords.length === 0 || queryWords.some(word => searchableText.includes(word))
          if (matches) {
            if (!type || memory.type === type) {
              memories.push(memory)
            }
          }
        }
      } catch (error) {
        console.error(`Failed to read memory file ${file}:`, error)
      }
    }

    return memories
  }

  async listMemories(offset: number = 0, limit: number = 20): Promise<Memory[]> {
    await this.ensureMemoryDir()

    if (!existsSync(this.memoryDir)) {
      return []
    }

    const files = await readdir(this.memoryDir)
    const memoryFiles = files.filter(f => f.endsWith('.md') && f !== 'MEMORY.md')

    // Sort by modification time (newest first)
    const filesWithStats = await Promise.all(
      memoryFiles.map(async (file) => {
        const filePath = join(this.memoryDir, file)
        const stats = await stat(filePath)
        return { file, mtime: stats.mtime, filePath }
      })
    )

    filesWithStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

    const memories: Memory[] = []
    for (let i = offset; i < Math.min(offset + limit, filesWithStats.length); i++) {
      const { filePath } = filesWithStats[i]
      try {
        const content = await readFile(filePath, 'utf-8')
        const memory = this.parseMemoryFile(content, filePath)
        if (memory) {
          memories.push(memory)
        }
      } catch (error) {
        console.error(`Failed to read memory file ${filePath}:`, error)
      }
    }

    return memories
  }

  async getMemory(id: string): Promise<Memory | null> {
    await this.ensureMemoryDir()

    if (!existsSync(this.memoryDir)) {
      return null
    }

    // Look for file with matching id (filename without extension)
    const files = await readdir(this.memoryDir)
    const matchingFile = files.find(f => f.startsWith(id) || f === `${id}.md`)

    if (!matchingFile) {
      return null
    }

    const filePath = join(this.memoryDir, matchingFile)
    try {
      const content = await readFile(filePath, 'utf-8')
      return this.parseMemoryFile(content, filePath)
    } catch (error) {
      console.error(`Failed to read memory file ${filePath}:`, error)
      return null
    }
  }

  async deleteMemory(id: string): Promise<boolean> {
    await this.ensureMemoryDir()

    if (!existsSync(this.memoryDir)) {
      return false
    }

    // Look for file with matching id (filename without extension)
    const files = await readdir(this.memoryDir)
    const matchingFile = files.find(f => f.startsWith(id) || f === `${id}.md`)

    if (!matchingFile) {
      return false
    }

    const filePath = join(this.memoryDir, matchingFile)
    try {
      await unlink(filePath)

      // Also try to remove from index (simplified - we'll just regenerate index)
      await this.regenerateIndex()

      return true
    } catch (error) {
      console.error(`Failed to delete memory file ${filePath}:`, error)
      return false
    }
  }

  async updateMemory(
    id: string,
    updates: Partial<{
      name: string
      description: string
      content: string
      tags: string[]
    }>
  ): Promise<Memory | null> {
    await this.ensureMemoryDir()

    if (!existsSync(this.memoryDir)) {
      return null
    }

    // Find existing memory
    const files = await readdir(this.memoryDir)
    const matchingFile = files.find(f => f.startsWith(id) || f === `${id}.md`)

    if (!matchingFile) {
      return null
    }

    const filePath = join(this.memoryDir, matchingFile)
    try {
      const content = await readFile(filePath, 'utf-8')
      const existing = this.parseMemoryFile(content, filePath)

      if (!existing) {
        return null
      }

      // Merge updates
      const updatedMemory: Omit<Memory, 'filePath'> = {
        ...existing,
        name: updates.name ?? existing.name,
        description: updates.description ?? existing.description,
        content: updates.content ?? existing.content,
        tags: updates.tags ?? existing.tags,
        updatedAt: new Date(),
      }

      // Write back to same file
      const fileContent = this.formatMemoryFile(updatedMemory)
      await writeFile(filePath, fileContent, 'utf-8')

      // Regenerate index
      await this.regenerateIndex()

      return { ...updatedMemory, filePath }
    } catch (error) {
      console.error(`Failed to update memory file ${filePath}:`, error)
      return null
    }
  }

  private async regenerateIndex(): Promise<void> {
    await this.ensureMemoryDir()

    if (!existsSync(this.memoryDir)) {
      return
    }

    const files = await readdir(this.memoryDir)
    const memoryFiles = files.filter(f => f.endsWith('.md') && f !== 'MEMORY.md')

    const indexEntries: string[] = []

    for (const file of memoryFiles) {
      const filePath = join(this.memoryDir, file)
      try {
        const content = await readFile(filePath, 'utf-8')
        const memory = this.parseMemoryFile(content, filePath)

        if (memory) {
          const indexLine = `- [${memory.name}](${basename(filePath)}) — ${memory.description}\n`
          indexEntries.push(indexLine)
        }
      } catch (error) {
        console.error(`Failed to read memory file ${file} for index regeneration:`, error)
      }
    }

    const indexContent = indexEntries.join('')
    await writeFile(this.indexFile, indexContent, 'utf-8')
  }

  // ═══════════════════════════════════════════════════════════════
  //  Nietzschean Self-Overcoming Primitives
  //  "What does not overcome me makes me stronger."
  // ═══════════════════════════════════════════════════════════════

  /**
   * EVOLVE — Overcome a memory by creating a new version that supersedes
   * the old one. The old memory is preserved as "genealogy" (a stepping
   * stone), never deleted. The new memory carries a `previousId` backlink
   * and an `overcomeReason` explaining WHY the old belief was overcome.
   *
   * From Manus article §3 (Masking, Not Removing) + §6 (Error Preservation):
   * Never erase evidence. The system adapts by overcoming, not forgetting.
   *
   * Nietzsche: "You must be ready to burn yourself in your own flame;
   * how could you rise anew if you have not first become ashes?"
   */
  async evolveMemory(
    id: string,
    overcomeReason: string,
    newContent: string,
    newName?: string,
  ): Promise<{ overcome: Memory; successor: Memory } | null> {
    const existing = await this.getMemory(id)
    if (!existing) return null

    // Preserve the old — append overcome metadata
    const overcomeContent = existing.content
    const overcome: Omit<Memory, 'filePath'> = {
      ...existing,
      name: existing.name,
      description: `[OVERCOME] ${existing.description}`,
      content: overcomeContent,
      tags: [...(existing.tags || []), 'overcome', 'genealogy'],
      updatedAt: new Date(),
    }

    // Write the overcome marker back to the original file (append-only)
    const oldFilePath = join(this.memoryDir, `${existing.id}.md`)
    const overcomeFileContent = this.formatMemoryFile(overcome)
    await writeFile(oldFilePath, overcomeFileContent, 'utf-8')

    // Create the successor — the new, higher form
    const successorContent = `## Genealogy of Self-Overcoming

*This knowledge evolved from a previous understanding.*

**Previous Memory**: ${existing.name} (\`${existing.id}\`)
**Overcome Reason**: ${overcomeReason}
**Overcome At**: ${new Date().toISOString()}

---

## Current Understanding

${newContent}

---
*"One must still have chaos in oneself to be able to give birth to a dancing star." — Nietzsche*
`

    const successor = await this.saveMemory(
      existing.type,
      newName || `${existing.name} (evolved)`,
      `[EVOLVED from: ${existing.name}] ${existing.description}`,
      successorContent,
      [...(existing.tags || []), 'evolved', `overcomes:${existing.id}`],
    )

    return { overcome: { ...overcome, filePath: oldFilePath }, successor }
  }

  /**
   * REHEARSE — Bring the most important memories to the "end of context"
   * for attention manipulation. Like Manus's todo.md technique (§5), this
   * writes a rehearsal file that the system prompt can inject near the
   * model's current context, biasing attention toward key learnings.
   *
   * From Manus article §5 (Manipulating Attention Through Repetition):
   * "By continuously rewriting the todo list, Manus rehearses its goals
   * near the end of the context — exploiting recency bias."
   *
   * Nietzsche: Eternal Recurrence — "If this thought gained possession
   * of you, it would change you as you are... The question in each and
   * every thing: 'Do you desire this once more and innumerable times?'"
   */
  async rehearseMemories(
    query?: string,
    type?: string,
    limit: number = 5,
  ): Promise<{ rehearsal: string; memories: Memory[] }> {
    const memories = query
      ? await this.searchMemories(query, type, limit)
      : await this.listMemories(0, limit)

    if (memories.length === 0) {
      return { rehearsal: '', memories: [] }
    }

    const lines = [
      '<!-- REHEARSAL: Key memories for this session -->',
      '',
    ]

    for (const m of memories) {
      const tags = m.tags?.length ? ` [${m.tags.join(', ')}]` : ''
      const isOvercome = m.tags?.includes('overcome')
      const marker = isOvercome ? '⚡ OVERCOME — stepping stone' : '◆ ACTIVE'
      lines.push(`## ${marker}: ${m.name}${tags}`)
      lines.push(`> ${m.description}`)
      lines.push('')
      // Include a compressed excerpt (first 3 non-empty lines of content)
      const contentLines = m.content.split('\n').filter(l => l.trim())
      const excerpt = contentLines.slice(0, 3).join('\n')
      lines.push(excerpt)
      lines.push('')
      if (isOvercome) {
        lines.push('*This memory has been overcome — preserved as genealogy.*')
        lines.push('')
      }
    }

    const rehearsal = lines.join('\n')

    // Write rehearsal file for context injection
    const rehearsalPath = join(this.memoryDir, 'REHEARSAL.md')
    await writeFile(rehearsalPath, rehearsal, 'utf-8')

    return { rehearsal, memories }
  }

  /**
   * SUMMARIZE — Create a recoverably-compressed version of a memory.
   * The original is preserved intact; the summary links back to it.
   *
   * From Manus article §4 (Filesystem as Context):
   * "The compression strategy is always designed to be recoverable."
   * Content can be shortened as long as the reference (file path) remains.
   */
  async summarizeMemory(
    id: string,
    summary: string,
    keyPoints: string[],
  ): Promise<{ original: Memory; summary: Memory } | null> {
    const original = await this.getMemory(id)
    if (!original) return null

    const summaryContent = `## Summary (Recoverable Compression)

${summary}

## Key Points
${keyPoints.map(p => `- ${p}`).join('\n')}

## Source
- **Original Memory**: [${original.name}](${original.id}.md)
- **Original Type**: ${original.type}
- **Compressed At**: ${new Date().toISOString()}

> This is a compressed version. See the original memory for full context.
> The original is preserved intact — this summary is recoverable.
`

    const summaryMemory = await this.saveMemory(
      original.type,
      `${original.name} (summary)`,
      `[COMPRESSED from: ${original.name}] ${original.description}`,
      summaryContent,
      [...(original.tags || []), 'summary', 'compressed', `source:${original.id}`],
    )

    return { original, summary: summaryMemory }
  }

  /**
   * SYNTHESIZE — Aggregate related memories into a structured domain
   * knowledge article. This bridges MemoryTool → WikiTool by producing
   * content ready to be saved to the wiki knowledge repository.
   *
   * From Manus article §4 (Filesystem as Context) + user requirement:
   * Domain knowledge should be externalized as structured articles in the
   * wiki repository — forming a growing, self-improving knowledge base.
   *
   * Nietzsche: "The snake which cannot shed its skin perishes."
   * Memories that are not synthesized into knowledge stagnate.
   */
  async synthesizeDomain(
    domain: string,
    query?: string,
    type?: string,
  ): Promise<{
    domain: string
    memories: Memory[]
    article: string
  }> {
    const searchQuery = query || domain
    const memories = await this.searchMemories(searchQuery, type, 50)

    // Build structured domain knowledge article
    const now = new Date().toISOString()
    const sections: string[] = [
      `# Domain Knowledge: ${domain}`,
      '',
      `> Auto-synthesized from ${memories.length} memories on ${now}`,
      `> This article bridges MemoryTool learnings into the WikiTool knowledge repository.`,
      '',
      '---',
      '',
      '## Genealogy of Knowledge',
      '',
      'The following insights were accumulated, challenged, and overcome through iterative learning:',
      '',
    ]

    // Group memories by type
    const byType: Record<string, typeof memories> = {}
    for (const m of memories) {
      byType[m.type] = byType[m.type] || []
      byType[m.type]!.push(m)
    }

    for (const [memType, mems] of Object.entries(byType)) {
      sections.push(`### ${capitalize(memType)}`)
      sections.push('')
      for (const m of mems!) {
        const overcome = m.tags?.includes('overcome') ? ' ⚡ (overcome)' : ''
        const evolved = m.tags?.includes('evolved') ? ' 🦅 (evolved)' : ''
        sections.push(`- **${m.name}**${overcome}${evolved}: ${m.description}`)
      }
      sections.push('')
    }

    // Extracted principles (non-overcome feedback/project memories)
    const activeMemories = memories.filter(m => !m.tags?.includes('overcome'))
    if (activeMemories.length > 0) {
      sections.push('## Extracted Principles')
      sections.push('')
      for (const m of activeMemories.slice(0, 10)) {
        const excerpt = m.content
          .split('\n')
          .filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('-'))
          .slice(0, 2)
          .join(' ')
        if (excerpt) {
          sections.push(`> ${excerpt.substring(0, 200)}`)
          sections.push('')
        }
      }
    }

    sections.push('---')
    sections.push('')
    sections.push(`*Synthesized at ${now} | ${memories.length} memories | Domain: ${domain}*`)
    sections.push('')
    sections.push('> "One must still have chaos in oneself to be able to give birth to a dancing star." — Nietzsche')

    const article = sections.join('\n')

    return { domain, memories, article }
  }

  /**
   * GENEALOGY — Trace the full evolution chain of a memory.
   * Walks the `overcomes:` and `source:` tag links to reconstruct
   * the complete history of how this knowledge came to be.
   *
   * Nietzsche: "We are unknown to ourselves, we knowers...
   * we have never sought ourselves."
   */
  async getGenealogy(id: string): Promise<Memory[]> {
    const chain: Memory[] = []
    const visited = new Set<string>()

    let current = await this.getMemory(id)
    while (current && !visited.has(current.id)) {
      chain.push(current)
      visited.add(current.id)

      // Follow the overcome chain backward
      const overcomeTag = current.tags?.find(t => t.startsWith('overcomes:'))
      const sourceTag = current.tags?.find(t => t.startsWith('source:'))

      const prevId = overcomeTag?.split(':')[1] || sourceTag?.split(':')[1]
      if (prevId) {
        current = await this.getMemory(prevId)
      } else {
        break
      }
    }

    return chain
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}