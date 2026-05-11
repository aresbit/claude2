/**
 * DeepSeek Prefix Optimizer
 *
 * Implements a three-region context partition that structurally guarantees
 * prefix-cache-friendly message ordering for DeepSeek's automatic byte-prefix
 * caching mechanism.
 *
 * Architecture modeled after DeepSeek-Reasonix:
 *   https://github.com/esengine/DeepSeek-Reasonix/blob/main/docs/ARCHITECTURE.md
 *
 * ## Three Regions
 *
 * 1. ImmutablePrefix — System prompt + tool specs. Hashed via SHA-256.
 *    Pinned at the start of every request. Rebuilt only on /compact or tool churn.
 *
 * 2. AppendOnlyLog — Monotonically-growing conversation history.
 *    append() / extend() only. Single mutation path: compactInPlace() for
 *    context folding (trades one cache miss for continued operation).
 *
 * 3. VolatileScratch — Per-turn transient state (reasoning traces, ephemeral
 *    notes). Reset each turn. NEVER sent to the API.
 *
 * ## Cache Principle
 *
 * DeepSeek's server-side automatic prefix caching matches on exact byte-prefix
 * of consecutive requests. By keeping the ImmutablePrefix invariant and the
 * AppendOnlyLog append-only, each turn's first N messages are byte-identical
 * to the previous turn, yielding ~90% cache hit rates.
 *
 * DeepSeek does NOT use Anthropic-style explicit cache_control blocks.
 * The optimizer suppresses them to avoid adding unrecognized fields to the request.
 */
import { createHash } from 'crypto'
import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { MessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { SystemPrompt } from '../../utils/systemPromptType.js'
import { logForDebugging } from '../../utils/debug.js'
import { jsonStringify } from '../../utils/slowOperations.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CacheMetrics {
  /** Tokens served from the prefix cache this turn */
  hitTokens: number
  /** Tokens that missed the cache this turn */
  missTokens: number
  /** Cumulative hit tokens across all turns */
  cumulativeHitTokens: number
  /** Cumulative miss tokens across all turns */
  cumulativeMissTokens: number
  /** hitTokens / (hitTokens + missTokens), or 0 if no tokens */
  hitRatio: number
}

export interface CompactResult {
  /** The replacement message that summarizes compacted history */
  summaryMessage: MessageParam
  /** Number of messages removed */
  removedCount: number
}

// ─── ImmutablePrefix ──────────────────────────────────────────────────────────

export class ImmutablePrefix {
  private _systemPrompt: SystemPrompt
  private _toolSchemas: BetaToolUnion[]
  private _fingerprint: string | null = null
  private _built: boolean = false

  constructor() {
    this._systemPrompt = []
    this._toolSchemas = []
  }

  /**
   * Set or update the system prompt. Invalidates the fingerprint.
   * Call this once per session (or after /compact changes the system prompt).
   */
  setSystemPrompt(prompt: SystemPrompt): void {
    this._systemPrompt = [...prompt]
    this._fingerprint = null
    this._built = true
  }

  /**
   * Set or update tool schemas. Invalidates the fingerprint.
   * Call this once per session or when tools change (MCP connect/disconnect).
   */
  setToolSchemas(schemas: BetaToolUnion[]): void {
    this._toolSchemas = [...schemas]
    this._fingerprint = null
  }

  get systemPrompt(): SystemPrompt {
    return this._systemPrompt
  }

  get toolSchemas(): readonly BetaToolUnion[] {
    return this._toolSchemas
  }

  get isBuilt(): boolean {
    return this._built
  }

  /**
   * SHA-256 fingerprint over the canonical JSON of all three components.
   * First 16 hex chars — 64-bit collision resistance sufficient for
   * session-scoped cache keying.
   */
  fingerprint(): string {
    if (this._fingerprint) return this._fingerprint
    const blob = jsonStringify({
      system: this._systemPrompt,
      tools: this._toolSchemas.map(t => ({ name: t.name, description: (t as any).description })),
    })
    this._fingerprint = createHash('sha256').update(blob).digest('hex').slice(0, 16)
    return this._fingerprint
  }

  /**
   * Build system prompt blocks suitable for the API request's `system` parameter.
   * No cache_control blocks — DeepSeek uses automatic prefix caching.
   */
  toSystemBlocks(): TextBlockParam[] {
    return this._systemPrompt.map(text => ({
      type: 'text' as const,
      text,
    }))
  }
}

// ─── AppendOnlyLog ────────────────────────────────────────────────────────────

export class AppendOnlyLog {
  private _entries: MessageParam[] = []

  /**
   * Append a single message. The only normal write path.
   * Validates that the message has a role before pushing.
   */
  append(message: MessageParam): void {
    if (!message.role) {
      logForDebugging('[DeepSeekOpt] append() called with role-less message, skipping', { level: 'warn' })
      return
    }
    this._entries.push(message)
  }

  /**
   * Batch append. For assistant_response -> tool_result sequences.
   */
  extend(messages: MessageParam[]): void {
    for (const msg of messages) {
      this.append(msg)
    }
  }

  /**
   * Fully replace the log. The SOLE mutation path.
   * Reserved for context folding (compaction) — trades one cache miss
   * for continued operation in a constrained context window.
   *
   * @param replacementMessages Array that replaces ALL current entries
   */
  compactInPlace(replacementMessages: MessageParam[]): CompactResult {
    const removedCount = this._entries.length
    this._entries = replacementMessages.map(m => ({ ...m }))
    logForDebugging(
      `[DeepSeekOpt] compactInPlace: removed ${removedCount} messages, kept ${this._entries.length}`,
      { level: 'info' },
    )
    return {
      summaryMessage: this._entries[0]!,
      removedCount,
    }
  }

  /**
   * Returns a shallow copy of all entries.
   * Consumers must not mutate the returned array.
   */
  toMessages(): MessageParam[] {
    return this._entries.map(e => ({ ...e }))
  }

  get length(): number {
    return this._entries.length
  }

  get entries(): readonly MessageParam[] {
    return this._entries
  }

  /**
   * Last N messages. Used for constructing the current turn's context.
   */
  tail(n: number): MessageParam[] {
    return this._entries.slice(-n).map(e => ({ ...e }))
  }
}

// ─── VolatileScratch ──────────────────────────────────────────────────────────

export class VolatileScratch {
  /** R1/DeepSeek reasoning traces from the last API response */
  reasoning: string | null = null
  /** Transient planning state (never sent to API) */
  planState: Record<string, unknown> | null = null
  /** Ephemeral working notes */
  notes: string[] = []

  reset(): void {
    this.reasoning = null
    this.planState = null
    this.notes = []
  }
}

// ─── DeepSeekPrefixOptimizer ──────────────────────────────────────────────────

/**
 * Main optimizer instance. One per session.
 *
 * Lifecycle:
 *   session start → new DeepSeekPrefixOptimizer()
 *   each turn     → optimizer.buildRequestMessages(logEntries, currentTurn)
 *   /compact      → optimizer.log.compactInPlace(foldedMessages)
 *   session end   → discard (no persistence needed)
 */
export class DeepSeekPrefixOptimizer {
  readonly prefix: ImmutablePrefix
  readonly log: AppendOnlyLog
  readonly scratch: VolatileScratch
  private _cumulativeHitTokens: number = 0
  private _cumulativeMissTokens: number = 0
  private _lastMetrics: CacheMetrics | null = null

  constructor() {
    this.prefix = new ImmutablePrefix()
    this.log = new AppendOnlyLog()
    this.scratch = new VolatileScratch()
  }

  /**
   * Initialize the immutable prefix from the session's system prompt and tools.
   * Must be called once before any buildRequestMessages().
   */
  initialize(systemPrompt: SystemPrompt, toolSchemas: BetaToolUnion[]): void {
    this.prefix.setSystemPrompt(systemPrompt)
    this.prefix.setToolSchemas(toolSchemas)
    logForDebugging(
      `[DeepSeekOpt] initialized — prefix fingerprint: ${this.prefix.fingerprint()}, tools: ${toolSchemas.length}`,
      { level: 'info' },
    )
  }

  /**
   * Build the complete messages array for an API request.
   *
   * Ordering:
   *   1. ImmutablePrefix system blocks → sent as `system` parameter
   *   2. AppendOnlyLog entries (all prior turns) → sent as `messages`
   *   3. Current turn messages
   *
   * The immutable prefix is always first, and the append-only log is never
   * rewritten, so DeepSeek's byte-prefix cache hits on every turn.
   *
   * @returns { system, messages, tools } — ready to spread into API params
   */
  buildRequestMessages(
    currentTurnMessages: MessageParam[],
  ): {
    system: TextBlockParam[]
    messages: MessageParam[]
    tools: BetaToolUnion[]
  } {
    this.scratch.reset()

    const system = this.prefix.toSystemBlocks()
    const logMessages = this.log.toMessages()
    const messages = [...logMessages, ...currentTurnMessages]
    const tools = [...this.prefix.toolSchemas] // defensive copy

    return { system, messages, tools }
  }

  /**
   * Record usage from an API response.
   * Extracts cache hit/miss tokens. DeepSeek uses the same field names
   * as Anthropic: prompt_cache_hit_tokens, prompt_cache_miss_tokens.
   */
  recordUsage(usage: {
    prompt_cache_hit_tokens?: number | null
    prompt_cache_miss_tokens?: number | null
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number | null
  }): CacheMetrics {
    const hitTokens = usage.prompt_cache_hit_tokens ?? 0
    const missTokens = usage.prompt_cache_miss_tokens ?? 0

    this._cumulativeHitTokens += hitTokens
    this._cumulativeMissTokens += missTokens

    const denom = hitTokens + missTokens
    const hitRatio = denom > 0 ? hitTokens / denom : 0

    this._lastMetrics = {
      hitTokens,
      missTokens,
      cumulativeHitTokens: this._cumulativeHitTokens,
      cumulativeMissTokens: this._cumulativeMissTokens,
      hitRatio,
    }

    return this._lastMetrics
  }

  /**
   * Get the cache hit ratio from the last recorded usage.
   */
  get lastMetrics(): CacheMetrics | null {
    return this._lastMetrics
  }

  /**
   * Cumulative cache hit ratio across all turns this session.
   */
  get cumulativeHitRatio(): number {
    const denom = this._cumulativeHitTokens + this._cumulativeMissTokens
    return denom > 0 ? this._cumulativeHitTokens / denom : 0
  }

  /**
   * Append assistant and tool_result messages to the log after a turn completes.
   * This is the normal path — the log ONLY grows.
   */
  commitTurn(messages: MessageParam[]): void {
    this.log.extend(messages)
  }

  /**
   * Compact the log. Replaces all history with a summary message.
   * The summary is prepended as a synthetic user message so the prefix cache
   * breaks cleanly on the next turn (one miss, then cache resumes).
   */
  compact(summary: string): CompactResult {
    const summaryMessage: MessageParam = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `<summary>\n${summary}\n</summary>\n\nPrevious conversation has been summarized. Continue helping the user.`,
        },
      ],
    }
    return this.log.compactInPlace([summaryMessage])
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _instance: DeepSeekPrefixOptimizer | null = null

/**
 * Get or create the session-scoped optimizer instance.
 * Returns null when DeepSeek prefix optimization is not enabled.
 */
export function getDeepSeekOptimizer(): DeepSeekPrefixOptimizer | null {
  // Lazy-import to avoid circular dependency at module load time
  const { isDeepSeekPrefixOptEnabled } = require('../../utils/model/providers.js') as typeof import('../../utils/model/providers.js')
  if (!isDeepSeekPrefixOptEnabled()) return null
  if (!_instance) _instance = new DeepSeekPrefixOptimizer()
  return _instance
}

/**
 * Reset the optimizer instance. Called on /clear.
 */
export function resetDeepSeekOptimizer(): void {
  _instance = null
}

/**
 * Check if the optimizer is active without creating an instance.
 * Fast path for hot code — avoids the lazy require.
 */
let _cachedEnabled: boolean | null = null
export function isDeepSeekOptimizerActive(): boolean {
  if (_cachedEnabled !== null) return _cachedEnabled
  // Use a simpler check that doesn't trigger the full require chain
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  const disabled = process.env.CLAUDE_CODE_DISABLE_DEEPSEEK_PREFIX_OPT
  if (!baseUrl || disabled === '1' || disabled === 'true') {
    _cachedEnabled = false
    return false
  }
  try {
    const host = new URL(baseUrl).host
    _cachedEnabled =
      host.includes('api.deepseek.com') ||
      host.includes('api.deepseek.ai') ||
      host.includes('deepseek-api.')
  } catch {
    _cachedEnabled = false
  }
  return _cachedEnabled
}
