import { access, readFile, rm, stat, writeFile } from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { isAbsolute, join, resolve } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { runAgent } from '../AgentTool/runAgent.js'
import type { Message } from '../../types/message.js'
import { GENERAL_PURPOSE_AGENT } from '../AgentTool/built-in/generalPurposeAgent.js'
import { createUserMessage } from '../../utils/messages.js'
import { getCwd } from '../../utils/cwd.js'
import { exec } from '../../utils/Shell.js'
import {
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
  userFacingName,
} from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum([
        'start',
        'status',
        'off',
        'clear',
        'init_experiment',
        'run_experiment',
        'log_experiment',
        'queue',
        'queue_status',
        'queue_stop',
        'audit',
        'analyze',
      ])
      .optional()
      .describe('Action to perform. Default: start'),
    goal: z.string().optional().describe('The optimization goal to achieve (e.g., reduce test runtime)'),
    scope: z.string().optional().describe('File glob pattern defining which files can be modified'),
    metric: z.string().optional().describe('Primary metric to optimize (e.g., total_µs, throughput)'),
    verify: z
      .string()
      .optional()
      .describe('Benchmark command that outputs/derives the primary metric'),
    iterations: z.number().int().min(1).max(500).optional().describe('Maximum iteration count'),
    guard: z.string().optional().describe('Correctness guard command that must pass before keep'),
    workingDir: z
      .string()
      .optional()
      .describe('Override working directory. Relative path resolves from current cwd'),
    resume: z
      .boolean()
      .optional()
      .describe('Resume existing autoresearch session files when present (default: true)'),
    name: z.string().optional().describe('Experiment name for init_experiment'),
    metric_name: z.string().optional().describe('Primary metric key for init_experiment'),
    metric_unit: z.string().optional().describe('Metric unit label for init_experiment'),
    direction: z
      .enum(['lower', 'higher'])
      .optional()
      .describe('Whether lower or higher metric is better for init_experiment'),
    command: z
      .string()
      .optional()
      .describe('Benchmark command for run_experiment. If autoresearch.sh exists, it must be used'),
    checks_timeout_seconds: z
      .number()
      .int()
      .min(1)
      .max(3600)
      .optional()
      .describe('Timeout in seconds for autoresearch.checks.sh'),
    status: z
      .enum(['keep', 'discard', 'crash', 'checks_failed'])
      .optional()
      .describe('Final status for log_experiment'),
    metric_value: z.number().optional().describe('Primary metric value for log_experiment'),
    description: z.string().optional().describe('One-line summary for log_experiment'),
    metrics: z
      .record(z.string(), z.number())
      .optional()
      .describe('Secondary metrics map for log_experiment'),
    force: z
      .boolean()
      .optional()
      .describe('Allow introducing new secondary metrics in log_experiment'),
    asi: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Actionable side information recorded with log_experiment'),
    auto_stop_non_keep_streak: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Auto-stop threshold: stop loop after N consecutive non-keep results'),
    // --- queue action fields ---
    manifest: z
      .array(
        z.object({
          id: z.string().describe('Unique job identifier'),
          command: z.string().describe('Shell command to run for this job'),
          cwd: z.string().optional().describe('Working directory override for this job'),
          timeoutMs: z.number().int().positive().optional().describe('Per-job timeout in ms'),
          depends_on: z.array(z.string()).optional().describe('Job IDs that must succeed before this starts'),
          retry: z
            .object({
              max_attempts: z.number().int().positive().optional(),
              delay_ms: z.number().int().nonnegative().optional(),
            })
            .optional()
            .describe('Retry policy on failure'),
        }),
      )
      .optional()
      .describe('Job manifest for queue action (array of job definitions)'),
    max_parallel: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Max concurrent jobs for queue action'),
    queue_name: z.string().optional().describe('Queue name for queue_status / queue_stop'),
    // --- audit action fields ---
    audit_target: z
      .string()
      .optional()
      .describe('Audit target: workdir path for experiment audit'),
    expected_metrics: z
      .array(z.string())
      .optional()
      .describe('Expected metric names for audit verification'),
    // --- analyze action fields ---
    analyze_context: z
      .string()
      .optional()
      .describe('Context/question for result analysis'),
    group_by: z
      .string()
      .optional()
      .describe('Grouping key for analyze (e.g., "run", "segment", "status")'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type Input = z.infer<InputSchema>

const sessionSchema = z.object({
  workDir: z.string(),
  goal: z.string().optional(),
  totalRuns: z.number(),
  keep: z.number(),
  discard: z.number(),
  crash: z.number(),
  checksFailed: z.number(),
  keepRate: z.number(),
  metricName: z.string().optional(),
  lastMetric: z.number().optional(),
  nonKeepStreak: z
    .object({
      current: z.number(),
      limit: z.number(),
    })
    .optional(),
  stopReason: z.string().optional(),
})

const jobStatusSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']),
  command: z.string(),
  exitCode: z.number().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
  attempts: z.number().optional(),
})

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean().describe('Whether the autoresearch action succeeded'),
    mode: z
      .enum(['active', 'inactive'])
      .describe('Autoresearch mode after this call'),
    action: z
      .enum([
        'start',
        'status',
        'off',
        'clear',
        'init_experiment',
        'run_experiment',
        'log_experiment',
        'queue',
        'queue_status',
        'queue_stop',
        'audit',
        'analyze',
      ])
      .describe('Executed action'),
    message: z.string().describe('Status message'),
    session: sessionSchema.optional(),
    // queue output fields
    queue_name: z.string().optional(),
    queue_summary: z
      .object({
        total: z.number(),
        pending: z.number(),
        running: z.number(),
        completed: z.number(),
        failed: z.number(),
        skipped: z.number(),
        wallClockMs: z.number().optional(),
      })
      .optional(),
    jobs: z.array(jobStatusSchema).optional(),
    // audit output fields
    audit_report: z
      .object({
        checks: z.record(z.string(), z.unknown()),
        overall: z.enum(['pass', 'warn', 'fail']),
        details: z.string().optional(),
      })
      .optional(),
    // analyze output fields
    analysis: z
      .record(z.string(), z.unknown())
      .optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>
export type AutoresearchProgress = {
  type: 'autoresearch_progress'
  iteration: number
  message: Message
}

const AUTORESEARCH_CONFIG = 'autoresearch.config.json'
const AUTORESEARCH_RUNTIME = '.autoresearch.runtime.json'
const AUTORESEARCH_JSONL = 'autoresearch.jsonl'
const AUTORESEARCH_MD = 'autoresearch.md'
const AUTORESEARCH_IDEAS = 'autoresearch.ideas.md'
const AUTORESEARCH_SH = 'autoresearch.sh'
const AUTORESEARCH_CHECKS = 'autoresearch.checks.sh'
const DEFAULT_ITERATIONS = 10
const DEFAULT_AUTO_STOP_NON_KEEP_STREAK = 3

type SessionMode = 'active' | 'inactive'
type ExperimentStatus = 'keep' | 'discard' | 'crash' | 'checks_failed'
type MetricDirection = 'lower' | 'higher'
type AutoresearchAction = NonNullable<Input['action']>

// --- Queue types (ported from ARIS experiment-queue) ---
interface QueueJob {
  id: string
  command: string
  cwd?: string
  timeoutMs?: number
  depends_on?: string[]
  retry?: { max_attempts?: number; delay_ms?: number }
}

interface QueueJobState {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  command: string
  exitCode?: number
  durationMs?: number
  error?: string
  attempts: number
  startedAt?: string
  completedAt?: string
}

interface QueueRuntime {
  name: string
  createdAt: string
  updatedAt: string
  maxParallel: number
  jobs: QueueJobState[]
  wallClockStart?: string
  wallClockEnd?: string
}

// --- Audit types (ported from ARIS experiment-audit) ---
interface AuditCheckResult {
  status: 'pass' | 'warn' | 'fail'
  details: string
}

interface AuditReport {
  overall: 'pass' | 'warn' | 'fail'
  checks: Record<string, AuditCheckResult>
  details?: string
}

// --- Analyze types (ported from ARIS analyze-results) ---
interface AnalyzeStats {
  total: number
  byStatus: Record<string, number>
  metricRange?: { min: number; max: number; avg: number; last: number }
  topPerforming?: { run: number; metric: number; description: string }
  trends?: string[]
}

interface RuntimeState {
  mode: SessionMode
  workDir: string
  goal?: string
  updatedAt: string
  experiment?: RuntimeExperimentState
}
interface RuntimeExperimentState {
  name: string
  metricName: string
  metricUnit: string
  direction: MetricDirection
  maxIterations: number
  runCount: number
  secondaryMetrics: string[]
  currentSegment: number
  bestMetric?: number
  autoStopNonKeepStreak: number
  currentNonKeepStreak: number
  stopReason?: string
  lastRun?: RuntimeLastRun
}
interface RuntimeLastRun {
  command: string
  benchmarkPassed: boolean
  durationSeconds: number
  outputTail: string
  parsedPrimaryMetric?: number
  parsedMetrics: Record<string, number>
  checksPass: boolean | null
  checksTimedOut: boolean
  checksOutputTail: string
}

interface SessionSummary {
  totalRuns: number
  keep: number
  discard: number
  crash: number
  checksFailed: number
  lastMetric?: number
  configMetric?: string
}
interface SessionSnapshot {
  workDir: string
  goal?: string
  totalRuns: number
  keep: number
  discard: number
  crash: number
  checksFailed: number
  keepRate: number
  metricName?: string
  lastMetric?: number
  experimentName?: string
  direction?: MetricDirection
  pendingRun?: {
    command: string
    benchmarkPassed: boolean
    checksPass: boolean | null
    checksTimedOut: boolean
    durationSeconds: number
  }
  nonKeepStreak?: {
    current: number
    limit: number
  }
  stopReason?: string
}

interface ConfigOverrides {
  maxIterations: number | null
  workingDir: string | null
}

function nowIso(): string {
  return new Date().toISOString()
}

function jsonErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function isDir(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath)
    return s.isDirectory()
  } catch {
    return false
  }
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function tailLines(text: string, maxLines = 80): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text.trim()
  return lines.slice(-maxLines).join('\n').trim()
}

function parseMetricLines(output: string): Record<string, number> {
  const metrics: Record<string, number> = {}
  const lines = output.split('\n')
  const metricLine = /^\s*METRIC\s+([A-Za-z0-9_.\-µ%]+)\s*=\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*$/i
  for (const line of lines) {
    const m = metricLine.exec(line)
    if (!m) continue
    const val = Number(m[2])
    if (Number.isFinite(val)) {
      metrics[m[1]] = val
    }
  }
  return metrics
}

function getPrimaryMetric(metrics: Record<string, number>, metricName: string): number | undefined {
  if (typeof metrics[metricName] === 'number') return metrics[metricName]
  const first = Object.values(metrics).find(v => Number.isFinite(v))
  return first
}

function isAutoresearchShCommand(command: string): boolean {
  const cmd = command.trim()
  return /^(?:(?:bash|sh)\s+(?:-\w+\s+)*)?(?:\.\/|\/[\w/.-]*\/)?autoresearch\.sh(?:\s|$)/.test(cmd)
}

async function runBashCommand(
  workDir: string,
  command: string,
  abortSignal: AbortSignal,
  timeoutMs: number,
): Promise<{
  code: number
  stdout: string
  stderr: string
  combined: string
  interrupted: boolean
}> {
  const wrapped = `cd ${shQuote(workDir)} && ${command}`
  const shellCommand = await exec(wrapped, abortSignal, 'bash', {
    timeout: timeoutMs,
    preventCwdChanges: true,
  })
  const result = await shellCommand.result
  shellCommand.cleanup()
  const combined = `${result.stdout}\n${result.stderr}`.trim()
  return {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    combined,
    interrupted: result.interrupted,
  }
}

async function readConfig(cwd: string): Promise<ConfigOverrides> {
  const configPath = join(cwd, AUTORESEARCH_CONFIG)
  if (!(await exists(configPath))) {
    return { maxIterations: null, workingDir: null }
  }

  try {
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as {
      maxIterations?: unknown
      workingDir?: unknown
    }
    const maxIterations =
      typeof parsed.maxIterations === 'number' &&
      Number.isFinite(parsed.maxIterations) &&
      parsed.maxIterations > 0
        ? Math.floor(parsed.maxIterations)
        : null
    const workingDir = typeof parsed.workingDir === 'string' && parsed.workingDir.trim()
      ? parsed.workingDir.trim()
      : null
    return { maxIterations, workingDir }
  } catch {
    return { maxIterations: null, workingDir: null }
  }
}

async function resolveWorkingDir(input: Input): Promise<{ ok: true; cwd: string; workDir: string; maxIterations: number } | { ok: false; error: string }> {
  const cwd = getCwd()
  const cfg = await readConfig(cwd)
  const rawWorkDir = input.workingDir ?? cfg.workingDir ?? cwd
  const workDir = isAbsolute(rawWorkDir) ? rawWorkDir : resolve(cwd, rawWorkDir)

  if (!(await isDir(workDir))) {
    return {
      ok: false,
      error: `Working directory does not exist or is not a directory: ${workDir}`,
    }
  }

  const maxIterations = input.iterations ?? cfg.maxIterations ?? DEFAULT_ITERATIONS
  return { ok: true, cwd, workDir, maxIterations }
}

function runtimePath(cwd: string): string {
  return join(cwd, AUTORESEARCH_RUNTIME)
}

async function readRuntime(cwd: string): Promise<RuntimeState | null> {
  const p = runtimePath(cwd)
  if (!(await exists(p))) return null
  try {
    const raw = await readFile(p, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<RuntimeState>
    if (parsed && (parsed.mode === 'active' || parsed.mode === 'inactive')) {
      const exp = parsed.experiment
      const experiment =
        exp &&
        typeof exp.name === 'string' &&
        typeof exp.metricName === 'string' &&
        typeof exp.metricUnit === 'string' &&
        (exp.direction === 'lower' || exp.direction === 'higher')
          ? {
              name: exp.name,
              metricName: exp.metricName,
              metricUnit: exp.metricUnit,
              direction: exp.direction,
              maxIterations:
                typeof exp.maxIterations === 'number' && exp.maxIterations > 0
                  ? Math.floor(exp.maxIterations)
                  : DEFAULT_ITERATIONS,
              runCount: typeof exp.runCount === 'number' ? Math.max(0, Math.floor(exp.runCount)) : 0,
              secondaryMetrics: Array.isArray(exp.secondaryMetrics)
                ? exp.secondaryMetrics.filter((m): m is string => typeof m === 'string')
                : [],
              currentSegment: typeof exp.currentSegment === 'number' ? Math.max(0, Math.floor(exp.currentSegment)) : 0,
              bestMetric: typeof exp.bestMetric === 'number' ? exp.bestMetric : undefined,
              autoStopNonKeepStreak:
                typeof exp.autoStopNonKeepStreak === 'number' && exp.autoStopNonKeepStreak > 0
                  ? Math.floor(exp.autoStopNonKeepStreak)
                  : DEFAULT_AUTO_STOP_NON_KEEP_STREAK,
              currentNonKeepStreak:
                typeof exp.currentNonKeepStreak === 'number' && exp.currentNonKeepStreak >= 0
                  ? Math.floor(exp.currentNonKeepStreak)
                  : 0,
              stopReason: typeof exp.stopReason === 'string' ? exp.stopReason : undefined,
              lastRun: exp.lastRun,
            }
          : undefined
      return {
        mode: parsed.mode,
        workDir: typeof parsed.workDir === 'string' ? parsed.workDir : cwd,
        goal: typeof parsed.goal === 'string' ? parsed.goal : undefined,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
        experiment,
      }
    }
    return null
  } catch {
    return null
  }
}

async function writeRuntime(cwd: string, state: RuntimeState): Promise<void> {
  await writeFile(runtimePath(cwd), JSON.stringify(state, null, 2), 'utf-8')
}

async function maybeSeedAutoresearchMd(workDir: string, input: Input, maxIterations: number): Promise<boolean> {
  const mdPath = join(workDir, AUTORESEARCH_MD)
  if (await exists(mdPath)) return false

  const body = [
    `# Autoresearch: ${input.goal ?? 'Optimization Session'}`,
    '',
    '## Objective',
    input.goal ?? 'TBD',
    '',
    '## Primary Metric',
    input.metric ?? 'TBD',
    '',
    '## Benchmark Command',
    input.verify ?? `bash ${AUTORESEARCH_SH}`,
    '',
    '## Guard Command',
    input.guard ?? '(optional)',
    '',
    '## Scope',
    input.scope ?? '(not constrained)',
    '',
    '## Max Iterations',
    String(maxIterations),
    '',
    '## Rules',
    '- Run baseline first.',
    '- Small, reversible changes each iteration.',
    '- Keep only when primary metric improves and guards pass.',
    '- On discard/crash/checks_failed, revert code changes but preserve autoresearch files.',
    '',
    '## What Has Been Tried',
    '- (append every iteration)',
    '',
  ].join('\n')

  await writeFile(mdPath, body, 'utf-8')
  return true
}

async function parseSessionSummary(workDir: string): Promise<SessionSummary> {
  const summary: SessionSummary = {
    totalRuns: 0,
    keep: 0,
    discard: 0,
    crash: 0,
    checksFailed: 0,
  }

  const jsonlPath = join(workDir, AUTORESEARCH_JSONL)
  if (!(await exists(jsonlPath))) return summary

  try {
    const raw = await readFile(jsonlPath, 'utf-8')
    const lines = raw.split('\n').map(line => line.trim()).filter(Boolean)
    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as Record<string, unknown>
        if (rec.type === 'config') {
          if (typeof rec.metricName === 'string') summary.configMetric = rec.metricName
          continue
        }
        const status = typeof rec.status === 'string' ? rec.status : ''
        if (status) summary.totalRuns += 1
        if (status === 'keep') summary.keep += 1
        if (status === 'discard') summary.discard += 1
        if (status === 'crash') summary.crash += 1
        if (status === 'checks_failed') summary.checksFailed += 1
        if (typeof rec.metric === 'number') summary.lastMetric = rec.metric
      } catch {
        // Ignore malformed lines and continue parsing.
      }
    }
  } catch {
    // Ignore read failures and return what we have.
  }

  return summary
}

async function buildStatusMessage(cwd: string, workDir: string): Promise<string> {
  const [runtime, summary] = await Promise.all([
    readRuntime(cwd),
    parseSessionSummary(workDir),
  ])

  const files = [
    AUTORESEARCH_MD,
    AUTORESEARCH_JSONL,
    AUTORESEARCH_SH,
    AUTORESEARCH_CHECKS,
    AUTORESEARCH_IDEAS,
  ]
  const fileStates = await Promise.all(files.map(async f => ({ name: f, present: await exists(join(workDir, f)) })))

  const lines: string[] = []
  lines.push(`Mode: ${runtime?.mode ?? 'inactive'}`)
  lines.push(`Work dir: ${workDir}`)
  if (runtime?.goal) lines.push(`Goal: ${runtime.goal}`)
  lines.push(`Runs: ${summary.totalRuns} (keep=${summary.keep}, discard=${summary.discard}, crash=${summary.crash}, checks_failed=${summary.checksFailed})`)
  if (summary.configMetric || typeof summary.lastMetric === 'number') {
    lines.push(`Metric: ${summary.configMetric ?? 'metric'}${typeof summary.lastMetric === 'number' ? `, last=${summary.lastMetric}` : ''}`)
  }
  lines.push(`Files: ${fileStates.map(f => `${f.name}:${f.present ? 'yes' : 'no'}`).join(', ')}`)
  return lines.join('\n')
}

async function buildSessionSnapshot(cwd: string, workDir: string): Promise<SessionSnapshot> {
  const [runtime, summary] = await Promise.all([
    readRuntime(cwd),
    parseSessionSummary(workDir),
  ])
  const keepRate = summary.totalRuns > 0 ? (summary.keep / summary.totalRuns) * 100 : 0
  return {
    workDir,
    goal: runtime?.goal,
    totalRuns: summary.totalRuns,
    keep: summary.keep,
    discard: summary.discard,
    crash: summary.crash,
    checksFailed: summary.checksFailed,
    keepRate,
    metricName: summary.configMetric,
    lastMetric: summary.lastMetric,
    experimentName: runtime?.experiment?.name,
    direction: runtime?.experiment?.direction,
    pendingRun: runtime?.experiment?.lastRun
      ? {
          command: runtime.experiment.lastRun.command,
          benchmarkPassed: runtime.experiment.lastRun.benchmarkPassed,
          checksPass: runtime.experiment.lastRun.checksPass,
          checksTimedOut: runtime.experiment.lastRun.checksTimedOut,
          durationSeconds: runtime.experiment.lastRun.durationSeconds,
        }
      : undefined,
    nonKeepStreak: runtime?.experiment
      ? {
          current: runtime.experiment.currentNonKeepStreak,
          limit: runtime.experiment.autoStopNonKeepStreak,
        }
      : undefined,
    stopReason: runtime?.experiment?.stopReason,
  }
}

function buildAutoresearchPrompt(input: Input, params: { workDir: string; maxIterations: number; resumeContext: string; hasAutoresearchSh: boolean; hasChecks: boolean }): string {
  const { workDir, maxIterations, resumeContext, hasAutoresearchSh, hasChecks } = params
  const verifyCommand = hasAutoresearchSh ? `bash ${AUTORESEARCH_SH}` : (input.verify ?? `bash ${AUTORESEARCH_SH}`)
  const guardCommand = input.guard ?? (hasChecks ? `bash ${AUTORESEARCH_CHECKS}` : '(none)')
  const scope = input.scope ?? '(not constrained)'
  const metric = input.metric ?? 'primary metric from benchmark output'
  const goal = input.goal ?? 'Continue existing autoresearch objective'

  const sections = [
    'You are running in AUTORESEARCH MODE. Execute an autonomous optimization loop and do not stop early.',
    '',
    'Session parameters:',
    `- Goal: ${goal}`,
    `- Work directory: ${workDir}`,
    `- Scope: ${scope}`,
    `- Primary metric: ${metric}`,
    `- Benchmark command: ${verifyCommand}`,
    `- Guard command: ${guardCommand}`,
    `- Max iterations: ${maxIterations}`,
    '',
    'Mandatory protocol (in order):',
    `1. Read ${AUTORESEARCH_MD} first (if present), then scan recent git log and ${AUTORESEARCH_JSONL} if present.`,
    `2. Establish/confirm baseline by running benchmark before optimization.`,
    '3. For each iteration: write a concise hypothesis, apply a small change, run benchmark, evaluate result.',
    `4. If ${AUTORESEARCH_CHECKS} exists and benchmark passed, run it. If checks fail/timed out => status must be checks_failed (never keep).`,
    `5. Log every iteration to ${AUTORESEARCH_JSONL} with JSON fields: run, status(keep|discard|crash|checks_failed), metric, metrics(optional), description, timestamp, asi.`,
    '6. keep: commit change with metric delta in commit message. discard/crash/checks_failed: revert code changes while preserving autoresearch files.',
    `7. Continuously update ${AUTORESEARCH_MD} "What Has Been Tried"; put deferred ideas into ${AUTORESEARCH_IDEAS}.`,
    `8. Stop only when max iterations reached, no promising hypotheses remain, or user interrupts. Then provide a summary with best kept result.`,
    '',
    'Hard guardrail:',
    hasAutoresearchSh
      ? `- ${AUTORESEARCH_SH} exists. Use it as the benchmark entry point (do not replace with arbitrary custom benchmark commands).`
      : '- Prefer a single stable benchmark command. If you create autoresearch.sh, use it consistently for the rest of the loop.',
    '',
    resumeContext ? `Resume context:\n${resumeContext}` : 'No prior session context found; initialize a fresh session.',
  ]
  return sections.join('\n')
}

async function collectResumeContext(workDir: string): Promise<string> {
  const chunks: string[] = []
  const mdPath = join(workDir, AUTORESEARCH_MD)
  const ideasPath = join(workDir, AUTORESEARCH_IDEAS)
  const jsonlPath = join(workDir, AUTORESEARCH_JSONL)

  if (await exists(mdPath)) {
    const md = await readFile(mdPath, 'utf-8')
    const trimmed = md.trim()
    if (trimmed) {
      chunks.push(`[${AUTORESEARCH_MD}]\n${trimmed.slice(-5000)}`)
    }
  }

  if (await exists(ideasPath)) {
    const ideas = await readFile(ideasPath, 'utf-8')
    const trimmed = ideas.trim()
    if (trimmed) {
      chunks.push(`[${AUTORESEARCH_IDEAS}]\n${trimmed.slice(-2000)}`)
    }
  }

  if (await exists(jsonlPath)) {
    const summary = await parseSessionSummary(workDir)
    const statLine = `runs=${summary.totalRuns}, keep=${summary.keep}, discard=${summary.discard}, crash=${summary.crash}, checks_failed=${summary.checksFailed}`
    chunks.push(`[${AUTORESEARCH_JSONL} summary]\n${statLine}`)
  }

  return chunks.join('\n\n')
}

async function appendJsonlRecord(workDir: string, record: Record<string, unknown>): Promise<void> {
  const jsonlPath = join(workDir, AUTORESEARCH_JSONL)
  let current = ''
  if (await exists(jsonlPath)) {
    current = await readFile(jsonlPath, 'utf-8')
  }
  const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : ''
  await writeFile(jsonlPath, `${current}${prefix}${JSON.stringify(record)}\n`, 'utf-8')
}

async function handleInitExperiment(
  input: Input,
  cwd: string,
  workDir: string,
  maxIterations: number,
): Promise<Output> {
  if (!input.name || !input.metric_name || !input.direction) {
    return {
      success: false,
      mode: 'inactive',
      action: 'init_experiment',
      message: 'init_experiment requires name, metric_name, and direction.',
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }

  const current = await readRuntime(cwd)
  const existingSegment = current?.experiment?.currentSegment ?? 0
  const autoStopNonKeepStreak =
    input.auto_stop_non_keep_streak ?? DEFAULT_AUTO_STOP_NON_KEEP_STREAK
  const experimentState: RuntimeExperimentState = {
    name: input.name,
    metricName: input.metric_name,
    metricUnit: input.metric_unit ?? '',
    direction: input.direction,
    maxIterations,
    runCount: 0,
    secondaryMetrics: [],
    currentSegment: existingSegment + 1,
    bestMetric: undefined,
    autoStopNonKeepStreak,
    currentNonKeepStreak: 0,
    stopReason: undefined,
    lastRun: undefined,
  }

  await appendJsonlRecord(workDir, {
    type: 'config',
    timestamp: Date.now(),
    segment: experimentState.currentSegment,
    name: experimentState.name,
    metricName: experimentState.metricName,
    metricUnit: experimentState.metricUnit,
    direction: experimentState.direction,
    maxIterations: experimentState.maxIterations,
    autoStopNonKeepStreak: experimentState.autoStopNonKeepStreak,
  })

  await writeRuntime(cwd, {
    mode: 'active',
    workDir,
    goal: input.goal ?? current?.goal,
    updatedAt: nowIso(),
    experiment: experimentState,
  })

  return {
    success: true,
    mode: 'active',
    action: 'init_experiment',
    message: `Initialized experiment "${experimentState.name}" (metric=${experimentState.metricName}, ${experimentState.direction} is better, auto-stop non-keep streak=${experimentState.autoStopNonKeepStreak}).`,
    session: await buildSessionSnapshot(cwd, workDir),
  }
}

async function handleRunExperiment(
  input: Input,
  cwd: string,
  workDir: string,
  contextAbortSignal: AbortSignal,
): Promise<Output> {
  const runtime = await readRuntime(cwd)
  if (!runtime?.experiment) {
    return {
      success: false,
      mode: runtime?.mode ?? 'inactive',
      action: 'run_experiment',
      message: 'run_experiment requires init_experiment first.',
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }

  const exp = runtime.experiment
  if (exp.stopReason) {
    return {
      success: false,
      mode: 'inactive',
      action: 'run_experiment',
      message: `Experiment is stopped: ${exp.stopReason}. Re-run init_experiment to start a new segment.`,
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }
  if (exp.runCount >= exp.maxIterations) {
    return {
      success: false,
      mode: runtime.mode,
      action: 'run_experiment',
      message: `Maximum experiments reached (${exp.maxIterations}). Re-run init_experiment to start a new segment.`,
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }

  const hasAutoresearchSh = await exists(join(workDir, AUTORESEARCH_SH))
  const command = input.command ?? (hasAutoresearchSh ? `bash ${AUTORESEARCH_SH}` : '')
  if (!command) {
    return {
      success: false,
      mode: runtime.mode,
      action: 'run_experiment',
      message: `No benchmark command provided. Set command or create ${AUTORESEARCH_SH}.`,
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }
  if (hasAutoresearchSh && !isAutoresearchShCommand(command)) {
    return {
      success: false,
      mode: runtime.mode,
      action: 'run_experiment',
      message: `${AUTORESEARCH_SH} exists; you must run it instead of a custom command.`,
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }

  const t0 = Date.now()
  const benchmark = await runBashCommand(workDir, command, contextAbortSignal, 30 * 60 * 1000)
  const durationSeconds = (Date.now() - t0) / 1000
  const parsedMetrics = parseMetricLines(benchmark.combined)
  const parsedPrimaryMetric = getPrimaryMetric(parsedMetrics, exp.metricName)
  const benchmarkPassed = benchmark.code === 0 && !benchmark.interrupted

  let checksPass: boolean | null = null
  let checksTimedOut = false
  let checksOutputTail = ''
  const checksPath = join(workDir, AUTORESEARCH_CHECKS)
  if (benchmarkPassed && (await exists(checksPath))) {
    const timeoutSec = input.checks_timeout_seconds ?? 300
    const checks = await runBashCommand(
      workDir,
      `bash ${AUTORESEARCH_CHECKS}`,
      contextAbortSignal,
      timeoutSec * 1000,
    )
    checksTimedOut = checks.interrupted
    checksPass = checks.code === 0 && !checks.interrupted
    checksOutputTail = tailLines(checks.combined, 80)
  }

  const outputTail = tailLines(benchmark.combined, 120)
  const nextRuntime: RuntimeState = {
    ...runtime,
    mode: 'active',
    workDir,
    updatedAt: nowIso(),
    experiment: {
      ...exp,
      lastRun: {
        command,
        benchmarkPassed,
        durationSeconds,
        outputTail,
        parsedPrimaryMetric,
        parsedMetrics,
        checksPass,
        checksTimedOut,
        checksOutputTail,
      },
    },
  }
  await writeRuntime(cwd, nextRuntime)

  let message = `run_experiment finished in ${durationSeconds.toFixed(2)}s (exit=${benchmark.code}).`
  if (!benchmarkPassed) {
    message += `\nBenchmark failed. Next: log_experiment with status="crash".`
  } else if (checksPass === false || checksTimedOut) {
    message += `\nChecks failed or timed out. Next: log_experiment with status="checks_failed".`
  } else {
    message += `\nBenchmark passed. Next: log_experiment with status keep/discard.`
  }
  if (typeof parsedPrimaryMetric === 'number') {
    message += `\nParsed primary metric (${exp.metricName}) = ${parsedPrimaryMetric}`
  } else {
    message += `\nNo METRIC line found for ${exp.metricName}. Provide metric manually in log_experiment.`
  }
  if (Object.keys(parsedMetrics).length > 0) {
    message += `\nParsed metrics: ${JSON.stringify(parsedMetrics)}`
  }
  if (outputTail) {
    message += `\n\nLast output lines:\n${outputTail}`
  }
  if (checksOutputTail) {
    message += `\n\nLast checks output lines:\n${checksOutputTail}`
  }

  return {
    success: benchmarkPassed,
    mode: 'active',
    action: 'run_experiment',
    message,
    session: await buildSessionSnapshot(cwd, workDir),
  }
}

function metricImproved(direction: MetricDirection, baseline: number, current: number): boolean {
  return direction === 'lower' ? current < baseline : current > baseline
}

async function handleLogExperiment(
  input: Input,
  cwd: string,
  workDir: string,
  contextAbortSignal: AbortSignal,
): Promise<Output> {
  const runtime = await readRuntime(cwd)
  if (!runtime?.experiment) {
    return {
      success: false,
      mode: runtime?.mode ?? 'inactive',
      action: 'log_experiment',
      message: 'log_experiment requires init_experiment first.',
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }
  const exp = runtime.experiment
  if (exp.stopReason) {
    return {
      success: false,
      mode: 'inactive',
      action: 'log_experiment',
      message: `Experiment is stopped: ${exp.stopReason}. Re-run init_experiment to start a new segment.`,
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }
  const lastRun = exp.lastRun
  if (!lastRun) {
    return {
      success: false,
      mode: runtime.mode,
      action: 'log_experiment',
      message: 'log_experiment requires run_experiment immediately before it.',
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }
  if (!input.status || !input.description) {
    return {
      success: false,
      mode: runtime.mode,
      action: 'log_experiment',
      message: 'log_experiment requires status and description.',
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }

  const status = input.status as ExperimentStatus
  if (!lastRun.benchmarkPassed && status !== 'crash') {
    return {
      success: false,
      mode: runtime.mode,
      action: 'log_experiment',
      message: 'Previous benchmark failed; status must be "crash".',
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }
  if (status === 'keep' && (lastRun.checksPass === false || lastRun.checksTimedOut)) {
    return {
      success: false,
      mode: runtime.mode,
      action: 'log_experiment',
      message: 'Cannot keep because checks failed/timed out; use status="checks_failed".',
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }

  const primaryMetric = input.metric_value ?? lastRun.parsedPrimaryMetric
  if (typeof primaryMetric !== 'number' || !Number.isFinite(primaryMetric)) {
    return {
      success: false,
      mode: runtime.mode,
      action: 'log_experiment',
      message: `Missing primary metric for log_experiment. Provide metric or emit METRIC ${exp.metricName}=... in benchmark output.`,
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }

  const mergedSecondaryMetrics: Record<string, number> = {
    ...Object.fromEntries(
      Object.entries(lastRun.parsedMetrics).filter(([k]) => k !== exp.metricName),
    ),
    ...(input.metrics ?? {}),
  }
  const knownSet = new Set(exp.secondaryMetrics)
  if (knownSet.size > 0) {
    const missing = [...knownSet].filter(k => !(k in mergedSecondaryMetrics))
    if (missing.length > 0) {
      return {
        success: false,
        mode: runtime.mode,
        action: 'log_experiment',
        message: `Missing secondary metrics: ${missing.join(', ')}`,
        session: await buildSessionSnapshot(cwd, workDir),
      }
    }
  }
  const newMetricNames = Object.keys(mergedSecondaryMetrics).filter(k => !knownSet.has(k))
  if (newMetricNames.length > 0 && !input.force && knownSet.size > 0) {
    return {
      success: false,
      mode: runtime.mode,
      action: 'log_experiment',
      message: `New secondary metrics not tracked before: ${newMetricNames.join(', ')}. Re-run with force=true to accept.`,
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }

  // keep only when it improves segment-local best metric
  if (
    status === 'keep' &&
    typeof exp.bestMetric === 'number' &&
    !metricImproved(exp.direction, exp.bestMetric, primaryMetric)
  ) {
    return {
      success: false,
      mode: runtime.mode,
      action: 'log_experiment',
      message: `status=keep rejected: metric did not improve vs segment best (${exp.bestMetric}).`,
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }

  let gitNote = ''
  if (status === 'keep') {
    try {
      await runBashCommand(workDir, 'git add -A', contextAbortSignal, 10_000)
      const cachedDiff = await runBashCommand(
        workDir,
        'git diff --cached --quiet',
        contextAbortSignal,
        10_000,
      )
      if (cachedDiff.code === 0) {
        gitNote = 'nothing to commit'
      } else {
        const commitPayload = JSON.stringify({
          status,
          [exp.metricName]: primaryMetric,
          ...mergedSecondaryMetrics,
        })
        const commitMsg = `${input.description}\n\nResult: ${commitPayload}`
        const commit = await runBashCommand(
          workDir,
          `git commit -m ${shQuote(commitMsg)}`,
          contextAbortSignal,
          15_000,
        )
        gitNote = commit.code === 0 ? 'committed' : `commit failed (exit=${commit.code})`
      }
    } catch (error) {
      gitNote = `commit error: ${jsonErrorMessage(error)}`
    }
  } else {
    try {
      const excludes = [
        AUTORESEARCH_JSONL,
        AUTORESEARCH_MD,
        AUTORESEARCH_IDEAS,
        AUTORESEARCH_SH,
        AUTORESEARCH_CHECKS,
      ]
      const restoreCmd =
        'git restore --worktree --staged -- . ' +
        excludes.map(file => shQuote(`:(exclude)${file}`)).join(' ')
      await runBashCommand(workDir, restoreCmd, contextAbortSignal, 10_000)
      gitNote = `reverted (${status})`
    } catch (error) {
      gitNote = `revert error: ${jsonErrorMessage(error)}`
    }
  }

  const runNumber = exp.runCount + 1
  await appendJsonlRecord(workDir, {
    type: 'run',
    run: runNumber,
    segment: exp.currentSegment,
    timestamp: Date.now(),
    status,
    metric: primaryMetric,
    metricName: exp.metricName,
    metrics: mergedSecondaryMetrics,
    description: input.description,
    durationSeconds: lastRun.durationSeconds,
    command: lastRun.command,
    checksPass: lastRun.checksPass,
    checksTimedOut: lastRun.checksTimedOut,
    asi: input.asi,
  })

  const nextNonKeepStreak = status === 'keep' ? 0 : exp.currentNonKeepStreak + 1
  const autoStoppedByNonKeep =
    nextNonKeepStreak >= exp.autoStopNonKeepStreak
  const stopReason = autoStoppedByNonKeep
    ? `auto-stop: ${nextNonKeepStreak} consecutive non-keep results (limit=${exp.autoStopNonKeepStreak})`
    : undefined

  const nextExperiment: RuntimeExperimentState = {
    ...exp,
    runCount: runNumber,
    secondaryMetrics: [...new Set([...exp.secondaryMetrics, ...Object.keys(mergedSecondaryMetrics)])],
    bestMetric:
      status === 'keep'
        ? typeof exp.bestMetric === 'number'
          ? exp.direction === 'lower'
            ? Math.min(exp.bestMetric, primaryMetric)
            : Math.max(exp.bestMetric, primaryMetric)
          : primaryMetric
        : exp.bestMetric,
    currentNonKeepStreak: nextNonKeepStreak,
    stopReason,
    lastRun: undefined,
  }
  await writeRuntime(cwd, {
    ...runtime,
    mode:
      nextExperiment.runCount >= nextExperiment.maxIterations || autoStoppedByNonKeep
        ? 'inactive'
        : 'active',
    updatedAt: nowIso(),
    experiment: nextExperiment,
  })

  const finishedByLimit = nextExperiment.runCount >= nextExperiment.maxIterations
  return {
    success: true,
    mode: finishedByLimit || autoStoppedByNonKeep ? 'inactive' : 'active',
    action: 'log_experiment',
    message: `Logged run #${runNumber} as ${status}. Git: ${gitNote}. Non-keep streak=${nextNonKeepStreak}/${exp.autoStopNonKeepStreak}.${finishedByLimit ? ` Reached maxIterations=${nextExperiment.maxIterations}.` : ''}${autoStoppedByNonKeep ? ` ${stopReason}.` : ''}`,
    session: await buildSessionSnapshot(cwd, workDir),
  }
}

// =============================================================================
// Feature: Experiment Queue (ported from ARIS experiment-queue)
// =============================================================================

const QUEUE_DIR = '.autoresearch_queues'
const DEFAULT_MAX_PARALLEL = 4
const DEFAULT_RETRY_MAX = 2
const DEFAULT_RETRY_DELAY_MS = 10_000

function queueStatePath(workDir: string, name: string): string {
  return join(workDir, QUEUE_DIR, `${name}.json`)
}

async function ensureQueueDir(workDir: string): Promise<void> {
  const dir = join(workDir, QUEUE_DIR)
  if (!(await exists(dir))) {
    const { mkdir } = await import('fs/promises')
    await mkdir(dir, { recursive: true })
  }
}

async function readQueueState(workDir: string, name: string): Promise<QueueRuntime | null> {
  const p = queueStatePath(workDir, name)
  if (!(await exists(p))) return null
  try {
    const raw = await readFile(p, 'utf-8')
    return JSON.parse(raw) as QueueRuntime
  } catch {
    return null
  }
}

async function writeQueueState(workDir: string, state: QueueRuntime): Promise<void> {
  await ensureQueueDir(workDir)
  await writeFile(queueStatePath(workDir, state.name), JSON.stringify(state, null, 2), 'utf-8')
}

function generateQueueName(): string {
  return `queue_${Date.now()}`
}

/**
 * Determine which jobs in a queue are eligible to run (dependencies met).
 */
function getRunnableJobs(jobs: QueueJobState[], maxParallel: number): QueueJobState[] {
  const running = jobs.filter(j => j.status === 'running').length
  const available = maxParallel - running
  if (available <= 0) return []

  const completedIds = new Set(jobs.filter(j => j.status === 'completed').map(j => j.id))

  return jobs
    .filter(
      j =>
        j.status === 'pending' &&
        (!j.attempts || j.attempts === 0) &&
        (!j.depends_on || (j.depends_on as string[]).every(d => completedIds.has(d))),
    )
    .slice(0, available)
}

async function handleQueueAction(
  input: Input,
  workDir: string,
  contextAbortSignal: AbortSignal,
): Promise<Output> {
  const manifest = input.manifest
  if (!manifest || !Array.isArray(manifest) || manifest.length === 0) {
    return {
      success: false,
      mode: 'inactive',
      action: 'queue',
      message: 'queue action requires a non-empty manifest array.',
    }
  }

  const maxParallel = input.max_parallel ?? DEFAULT_MAX_PARALLEL
  const queueName = generateQueueName()

  // Build initial job states
  const jobStates: QueueJobState[] = manifest.map((job: QueueJob) => ({
    id: job.id,
    status: 'pending' as const,
    command: job.command,
    attempts: 0,
    depends_on: job.depends_on,
  }))

  const queueState: QueueRuntime = {
    name: queueName,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    maxParallel,
    jobs: jobStates,
    wallClockStart: nowIso(),
  }

  await writeQueueState(workDir, queueState)

  // Run loop: pick runnable jobs, execute sequentially in batches
  let allDone = false
  while (!allDone && !contextAbortSignal.aborted) {
    const current = await readQueueState(workDir, queueName)
    if (!current) break

    const runnable = getRunnableJobs(current.jobs, maxParallel)
    if (runnable.length === 0) {
      // Check if all jobs are in terminal state
      const terminal = current.jobs.filter(
        j => j.status === 'completed' || j.status === 'failed' || j.status === 'skipped',
      )
      if (terminal.length === current.jobs.length) {
        allDone = true
        break
      }
      // Wait a bit before re-checking
      await new Promise(resolve => setTimeout(resolve, 1000))
      continue
    }

    // Execute runnable jobs
    for (const job of runnable) {
      if (contextAbortSignal.aborted) break

      // Mark running
      const idx = current.jobs.findIndex(j => j.id === job.id)
      if (idx === -1) continue
      current.jobs[idx] = {
        ...current.jobs[idx],
        status: 'running',
        startedAt: nowIso(),
        attempts: current.jobs[idx].attempts + 1,
      }
      await writeQueueState(workDir, current)

      // Find the job definition for retry config
      const jobDef = manifest.find((m: QueueJob) => m.id === job.id)
      const maxAttempts = jobDef?.retry?.max_attempts ?? DEFAULT_RETRY_MAX
      const retryDelayMs = jobDef?.retry?.delay_ms ?? DEFAULT_RETRY_DELAY_MS

      // Execute the job with retry
      let lastError = ''
      let success = false
      let exitCode = -1
      let durationMs = 0

      for (let attempt = 1; attempt <= Math.max(maxAttempts, 1); attempt++) {
        if (contextAbortSignal.aborted) break

        const jobWorkDir = jobDef?.cwd ?? workDir
        const cmd = `cd ${shQuote(jobWorkDir)} && ${job.command}`
        const timeout = jobDef?.timeoutMs ?? 5 * 60 * 1000

        try {
          const t0 = Date.now()
          const shellResult = await exec(cmd, contextAbortSignal, 'bash', {
            timeout,
            preventCwdChanges: true,
          })
          const result = await shellResult.result
          shellResult.cleanup()
          durationMs = Date.now() - t0

          if (result.code === 0 && !result.interrupted) {
            success = true
            exitCode = 0
            break
          } else {
            lastError = `exit=${result.code}, interrupted=${result.interrupted}`
            exitCode = result.code ?? -1
            if (attempt < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, retryDelayMs))
            }
          }
        } catch (err) {
          durationMs = Date.now() - Date.now()
          lastError = jsonErrorMessage(err)
          if (attempt < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, retryDelayMs))
          }
        }
      }

      // Update job state
      const finalIdx = current.jobs.findIndex(j => j.id === job.id)
      if (finalIdx !== -1) {
        current.jobs[finalIdx] = {
          ...current.jobs[finalIdx],
          status: success ? 'completed' : 'failed',
          exitCode,
          durationMs,
          error: success ? undefined : lastError,
          completedAt: nowIso(),
          attempts: current.jobs[finalIdx].attempts,
        }
      }

      // Check dependencies: if job failed, skip dependent jobs
      if (!success) {
        const dependentIds = current.jobs
          .filter(j => j.depends_on?.includes(job.id))
          .map(j => j.id)
        for (const depId of dependentIds) {
          const depIdx = current.jobs.findIndex(j => j.id === depId)
          if (depIdx !== -1 && current.jobs[depIdx].status === 'pending') {
            current.jobs[depIdx] = {
              ...current.jobs[depIdx],
              status: 'skipped',
              error: `Dependency failed: ${job.id}`,
              completedAt: nowIso(),
            }
          }
        }
      }

      await writeQueueState(workDir, current)
    }
  }

  // Compute final summary
  const finalState = await readQueueState(workDir, queueName)
  const jobs = finalState?.jobs ?? jobStates
  const total = jobs.length
  const completed = jobs.filter(j => j.status === 'completed').length
  const failed = jobs.filter(j => j.status === 'failed').length
  const skipped = jobs.filter(j => j.status === 'skipped').length
  const running = jobs.filter(j => j.status === 'running').length
  const pending = jobs.filter(j => j.status === 'pending').length

  const summaryStr =
    `Queue ${queueName}: ${total} jobs (completed=${completed}, failed=${failed}, skipped=${skipped}, running=${running}, pending=${pending})`

  return {
    success: failed === 0 && running === 0 && pending === 0,
    mode: 'inactive',
    action: 'queue',
    message: `Experiment queue finished.\n${summaryStr}`,
    queue_name: queueName,
    queue_summary: {
      total,
      pending,
      running,
      completed,
      failed,
      skipped,
    },
    jobs: jobs.map(j => ({
      id: j.id,
      status: j.status,
      command: j.command,
      exitCode: j.exitCode,
      durationMs: j.durationMs,
      error: j.error,
      attempts: j.attempts,
    })),
  }
}

async function handleQueueStatus(
  input: Input,
  workDir: string,
): Promise<Output> {
  const queueName = input.queue_name
  if (!queueName) {
    // List all queues
    const queueDir = join(workDir, QUEUE_DIR)
    if (!(await exists(queueDir))) {
      return {
        success: true,
        mode: 'inactive',
        action: 'queue_status',
        message: 'No queues found.',
      }
    }
    const { readdir } = await import('fs/promises')
    const files = await readdir(queueDir)
    const queues = files.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
    if (queues.length === 0) {
      return {
        success: true,
        mode: 'inactive',
        action: 'queue_status',
        message: 'No queues found.',
      }
    }
    const summaries: string[] = []
    for (const q of queues) {
      const state = await readQueueState(workDir, q)
      if (!state) continue
      const total = state.jobs.length
      const done = state.jobs.filter(j => j.status === 'completed').length
      const fail = state.jobs.filter(j => j.status === 'failed').length
      summaries.push(`${q}: ${done}/${total} done, ${fail} failed`)
    }
    return {
      success: true,
      mode: 'inactive',
      action: 'queue_status',
      message: `Queues:\n${summaries.join('\n')}`,
      queue_name: `(${queues.length} queues)`,
    }
  }

  const state = await readQueueState(workDir, queueName)
  if (!state) {
    return {
      success: false,
      mode: 'inactive',
      action: 'queue_status',
      message: `Queue not found: ${queueName}`,
      queue_name: queueName,
    }
  }

  const total = state.jobs.length
  const completed = state.jobs.filter(j => j.status === 'completed').length
  const failed = state.jobs.filter(j => j.status === 'failed').length
  const skipped = state.jobs.filter(j => j.status === 'skipped').length
  const running = state.jobs.filter(j => j.status === 'running').length
  const pending = state.jobs.filter(j => j.status === 'pending').length

  return {
    success: true,
    mode: running > 0 ? 'active' : 'inactive',
    action: 'queue_status',
    message: `Queue ${queueName}: ${total} jobs (completed=${completed}, failed=${failed}, skipped=${skipped}, running=${running}, pending=${pending})`,
    queue_name: queueName,
    queue_summary: { total, pending, running, completed, failed, skipped },
    jobs: state.jobs.map(j => ({
      id: j.id,
      status: j.status,
      command: j.command,
      exitCode: j.exitCode,
      durationMs: j.durationMs,
      error: j.error,
      attempts: j.attempts,
    })),
  }
}

async function handleQueueStop(
  input: Input,
  workDir: string,
): Promise<Output> {
  const queueName = input.queue_name
  if (!queueName) {
    return {
      success: false,
      mode: 'inactive',
      action: 'queue_stop',
      message: 'queue_stop requires queue_name.',
    }
  }

  const state = await readQueueState(workDir, queueName)
  if (!state) {
    return {
      success: false,
      mode: 'inactive',
      action: 'queue_stop',
      message: `Queue not found: ${queueName}`,
      queue_name: queueName,
    }
  }

  // Mark running jobs as failed
  for (const job of state.jobs) {
    if (job.status === 'running' || job.status === 'pending') {
      job.status = 'failed'
      job.error = 'Queue stopped by user'
      job.completedAt = nowIso()
    }
  }
  state.wallClockEnd = nowIso()
  state.updatedAt = nowIso()
  await writeQueueState(workDir, state)

  return {
    success: true,
    mode: 'inactive',
    action: 'queue_stop',
    message: `Queue ${queueName} stopped.`,
    queue_name: queueName,
  }
}

// =============================================================================
// Feature: Experiment Audit (ported from ARIS experiment-audit)
// =============================================================================

async function handleAuditAction(
  input: Input,
  workDir: string,
): Promise<Output> {
  const jsonlPath = join(workDir, AUTORESEARCH_JSONL)
  if (!(await exists(jsonlPath))) {
    return {
      success: false,
      mode: 'inactive',
      action: 'audit',
      message: `No ${AUTORESEARCH_JSONL} found in ${workDir}. Run some experiments first.`,
    }
  }

  const expectedMetrics = input.expected_metrics ?? []
  const checks: Record<string, AuditCheckResult> = {}

  // Check 1: JSONL file integrity
  try {
    const raw = await readFile(jsonlPath, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    let parseErrors = 0
    let configCount = 0
    let runCount = 0
    const metricValues: number[] = []
    const uniqueMetricNames = new Set<string>()

    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as Record<string, unknown>
        if (rec.type === 'config') {
          configCount++
          if (typeof rec.metricName === 'string') uniqueMetricNames.add(rec.metricName)
        } else if (rec.type === 'run') {
          runCount++
          if (typeof rec.metric === 'number' && Number.isFinite(rec.metric)) {
            metricValues.push(rec.metric as number)
          }
        }
      } catch {
        parseErrors++
      }
    }

    const details = `${lines.length} lines, ${configCount} configs, ${runCount} runs, ${parseErrors} parse errors`
    checks.jsonl_integrity = {
      status: parseErrors === 0 && runCount > 0 ? 'pass' : parseErrors > 0 ? 'warn' : 'fail',
      details,
    }

    // Check 2: Metric consistency
    if (metricValues.length > 0) {
      const min = Math.min(...metricValues)
      const max = Math.max(...metricValues)
      const avg = metricValues.reduce((a, b) => a + b, 0) / metricValues.length
      const variances = metricValues.map(v => (v - avg) ** 2)
      const stdDev = Math.sqrt(variances.reduce((a, b) => a + b, 0) / variances.length)
      const cv = avg !== 0 ? stdDev / avg : 0

      checks.metric_consistency = {
        status: cv < 2 ? 'pass' : cv < 5 ? 'warn' : 'fail',
        details: `${metricValues.length} metrics: min=${min}, max=${max}, avg=${avg.toFixed(4)}, std=${stdDev.toFixed(4)}, cv=${cv.toFixed(4)}`,
      }
    } else {
      checks.metric_consistency = {
        status: 'warn',
        details: 'No numeric metric values found in run records.',
      }
    }

    // Check 3: Expected metrics presence
    if (expectedMetrics.length > 0) {
      const found = expectedMetrics.filter(m => uniqueMetricNames.has(m))
      const missing = expectedMetrics.filter(m => !uniqueMetricNames.has(m))
      checks.expected_metrics = {
        status: missing.length === 0 ? 'pass' : 'warn',
        details: `Expected: ${expectedMetrics.join(', ')}. Found: ${found.join(', ')}. Missing: ${missing.join(', ') || 'none'}.`,
      }
    }

    // Check 4: Status distribution
    const statusCounts: Record<string, number> = {}
    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as Record<string, unknown>
        if (rec.type === 'run' && typeof rec.status === 'string') {
          statusCounts[rec.status as string] = (statusCounts[rec.status as string] || 0) + 1
        }
      } catch {
        // skip
      }
    }
    const keepRate = statusCounts['keep'] ? (statusCounts['keep'] / runCount) * 100 : 0
    checks.status_distribution = {
      status: keepRate >= 10 ? 'pass' : runCount > 0 ? 'warn' : 'fail',
      details: `Statuses: ${JSON.stringify(statusCounts)}. Keep rate: ${keepRate.toFixed(1)}%`,
    }
  } catch (err) {
    checks.jsonl_integrity = {
      status: 'fail',
      details: `Failed to read/parse ${AUTORESEARCH_JSONL}: ${jsonErrorMessage(err)}`,
    }
  }

  const checkValues = Object.values(checks)
  const failCount = checkValues.filter(c => c.status === 'fail').length
  const warnCount = checkValues.filter(c => c.status === 'warn').length
  const overall: 'pass' | 'warn' | 'fail' =
    failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass'

  const detailsStr = Object.entries(checks)
    .map(([name, c]) => `  ${name}: ${c.status} — ${c.details}`)
    .join('\n')

  return {
    success: true,
    mode: 'inactive',
    action: 'audit',
    message: `Experiment audit ${overall}.\n${detailsStr}`,
    audit_report: {
      overall,
      checks: checks as unknown as Record<string, unknown>,
      details: detailsStr,
    },
  }
}

// =============================================================================
// Feature: Analyze Results (ported from ARIS analyze-results)
// =============================================================================

async function handleAnalyzeAction(
  input: Input,
  workDir: string,
): Promise<Output> {
  const jsonlPath = join(workDir, AUTORESEARCH_JSONL)
  if (!(await exists(jsonlPath))) {
    return {
      success: false,
      mode: 'inactive',
      action: 'analyze',
      message: `No ${AUTORESEARCH_JSONL} found in ${workDir}. Run some experiments first.`,
    }
  }

  const raw = await readFile(jsonlPath, 'utf-8')
  const lines = raw.split('\n').filter(Boolean)

  // Parse config
  let configMetricName = 'metric'
  let configDirection: string | undefined
  for (const line of lines) {
    try {
      const rec = JSON.parse(line) as Record<string, unknown>
      if (rec.type === 'config' && typeof rec.metricName === 'string') {
        configMetricName = rec.metricName
        configDirection = typeof rec.direction === 'string' ? (rec.direction as string) : undefined
      }
    } catch {
      // skip
    }
  }

  // Parse runs
  const runs: Array<{
    run: number
    segment: number
    status: string
    metric: number | undefined
    description: string
    durationSeconds: number | undefined
  }> = []

  for (const line of lines) {
    try {
      const rec = JSON.parse(line) as Record<string, unknown>
      if (rec.type === 'run') {
        runs.push({
          run: typeof rec.run === 'number' ? (rec.run as number) : 0,
          segment: typeof rec.segment === 'number' ? (rec.segment as number) : 0,
          status: typeof rec.status === 'string' ? (rec.status as string) : 'unknown',
          metric: typeof rec.metric === 'number' ? (rec.metric as number) : undefined,
          description: typeof rec.description === 'string' ? (rec.description as string) : '',
          durationSeconds: typeof rec.durationSeconds === 'number' ? (rec.durationSeconds as number) : undefined,
        })
      }
    } catch {
      // skip
    }
  }

  if (runs.length === 0) {
    return {
      success: false,
      mode: 'inactive',
      action: 'analyze',
      message: 'No run records found in experiment log.',
    }
  }

  // Compute statistics
  const byStatus: Record<string, number> = {}
  const metricValues: number[] = []
  let topRun: { run: number; metric: number; description: string } | undefined

  for (const r of runs) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1
    if (typeof r.metric === 'number') {
      metricValues.push(r.metric)
      if (!topRun || r.metric > topRun.metric) {
        topRun = { run: r.run, metric: r.metric, description: r.description }
      }
    }
  }

  const metricRange = metricValues.length > 0
    ? {
        min: Math.min(...metricValues),
        max: Math.max(...metricValues),
        avg: metricValues.reduce((a, b) => a + b, 0) / metricValues.length,
        last: metricValues[metricValues.length - 1],
      }
    : undefined

  const groupByKey = input.group_by ?? 'status'
  const groups: Record<string, number> = {}
  for (const r of runs) {
    const key = groupByKey === 'segment' ? `segment_${r.segment}` : r.status
    groups[key] = (groups[key] || 0) + 1
  }

  // Generate trends
  const trends: string[] = []
  const keepRuns = runs.filter(r => r.status === 'keep')
  const improveRuns = keepRuns.length >= 2 ? keepRuns : []
  if (improveRuns.length >= 2) {
    const first = improveRuns[0].metric ?? 0
    const last = improveRuns[improveRuns.length - 1].metric ?? 0
    const dir = configDirection === 'higher' ? last > first : last < first
    if (dir) {
      trends.push(`Metrics improving across keep-runs: ${first} → ${last}`)
    }
  }

  const crashRuns = runs.filter(r => r.status === 'crash')
  if (crashRuns.length > runs.length * 0.3) {
    trends.push(`High crash rate (${crashRuns.length}/${runs.length}): check experiment stability`)
  }

  const analysis: AnalyzeStats = {
    total: runs.length,
    byStatus,
    metricRange,
    topPerforming: topRun,
    trends: trends.length > 0 ? trends : undefined,
  }

  const context = input.analyze_context ? `\nContext: ${input.analyze_context}` : ''
  const metricsStr = metricRange
    ? `\n${configMetricName}: range [${metricRange.min}, ${metricRange.max}], avg=${metricRange.avg.toFixed(4)}, last=${metricRange.last}`
    : ''
  const trendsStr = trends.length > 0 ? `\nTrends:\n  ${trends.join('\n  ')}` : ''
  const groupingStr = `\nBy-${groupByKey}: ${JSON.stringify(groups)}`

  return {
    success: true,
    mode: 'inactive',
    action: 'analyze',
    message: `Analysis: ${runs.length} runs across ${Object.keys(byStatus).length} statuses.${metricsStr}${trendsStr}${groupingStr}${context}`,
    analysis: analysis as unknown as Record<string, unknown>,
  }
}

export const AutoresearchTool = buildTool({
  name: 'autoresearch',
  searchHint: 'autonomous research optimization loop',
  maxResultSizeChars: 100_000,
  userFacingName,
  async description() {
    return 'Run a session-based autonomous optimization loop with a strong state machine: init_experiment -> run_experiment -> log_experiment. Also supports queue (multi-job batch), audit (experiment integrity), and analyze (cross-experiment statistics).'
  },
  async prompt() {
    return 'Autoresearch tool: supports action=start|status|off|clear|init_experiment|run_experiment|log_experiment|queue|queue_status|queue_stop|audit|analyze. Preferred protocol is strict: init_experiment once, run_experiment, then log_experiment every time. checks_failed cannot be kept; discard/crash/checks_failed auto-revert non-autoresearch changes. queue runs multi-job manifests with dependency tracking. audit checks experiment integrity. analyze computes cross-experiment statistics from JSONL.'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const safeOutput =
      output && typeof output === 'object'
        ? (output as Partial<Output>)
        : undefined
    const content =
      typeof safeOutput?.message === 'string'
        ? safeOutput.message
        : 'Autoresearch failed before producing a structured result.'
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content,
      is_error: safeOutput?.success !== true,
    }
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  async call(input, context, canUseTool, parentMessage, onProgress) {
    const action: AutoresearchAction = input.action ?? 'start'
    const resolved = await resolveWorkingDir(input)
    if (!resolved.ok) {
      return {
        success: false,
        mode: 'inactive',
        action,
        message: `Autoresearch failed: ${resolved.error}`,
      }
    }
    const { cwd, workDir, maxIterations } = resolved

    if (action === 'init_experiment') {
      return await handleInitExperiment(input, cwd, workDir, maxIterations)
    }

    if (action === 'run_experiment') {
      return await handleRunExperiment(
        input,
        cwd,
        workDir,
        context.abortController.signal,
      )
    }

    if (action === 'log_experiment') {
      return await handleLogExperiment(
        input,
        cwd,
        workDir,
        context.abortController.signal,
      )
    }

    if (action === 'status') {
      const runtime = await readRuntime(cwd)
      const message = await buildStatusMessage(cwd, workDir)
      const session = await buildSessionSnapshot(cwd, workDir)
      return {
        success: true,
        mode: runtime?.mode ?? 'inactive',
        action,
        message,
        session,
      }
    }

    if (action === 'off') {
      const current = await readRuntime(cwd)
      await writeRuntime(cwd, {
        mode: 'inactive',
        workDir,
        goal: current?.goal ?? input.goal,
        updatedAt: nowIso(),
      })
      return {
        success: true,
        mode: 'inactive',
        action,
        message: `Autoresearch mode OFF.\nWork dir: ${workDir}`,
        session: await buildSessionSnapshot(cwd, workDir),
      }
    }

    if (action === 'clear') {
      const jsonlPath = join(workDir, AUTORESEARCH_JSONL)
      if (await exists(jsonlPath)) {
        await rm(jsonlPath, { force: true })
      }
      await writeRuntime(cwd, {
        mode: 'inactive',
        workDir,
        goal: input.goal,
        updatedAt: nowIso(),
      })
      return {
        success: true,
        mode: 'inactive',
        action,
        message: `Cleared ${AUTORESEARCH_JSONL} and turned autoresearch mode OFF.\nWork dir: ${workDir}`,
        session: await buildSessionSnapshot(cwd, workDir),
      }
    }

    // =============================================================================
    // New ported features: Queue, Audit, Analyze
    // =============================================================================
    if (action === 'queue') {
      return await handleQueueAction(input, workDir, context.abortController.signal)
    }
    if (action === 'queue_status') {
      return await handleQueueStatus(input, workDir)
    }
    if (action === 'queue_stop') {
      return await handleQueueStop(input, workDir)
    }
    if (action === 'audit') {
      return await handleAuditAction(input, workDir)
    }
    if (action === 'analyze') {
      return await handleAnalyzeAction(input, workDir)
    }

    const shouldResume = input.resume ?? true
    const hasMd = await exists(join(workDir, AUTORESEARCH_MD))
    const runtimeBeforeStart = await readRuntime(cwd)
    if (!input.goal && !runtimeBeforeStart?.experiment && !(shouldResume && hasMd)) {
      return {
        success: false,
        mode: 'inactive',
        action,
        message: `action=start requires goal when no ${AUTORESEARCH_MD} exists for resume.\nWork dir: ${workDir}`,
      }
    }
    if (runtimeBeforeStart?.experiment?.stopReason) {
      return {
        success: false,
        mode: 'inactive',
        action,
        message: `Autoresearch start blocked: ${runtimeBeforeStart.experiment.stopReason}\nRun init_experiment to start a new segment.`,
        session: await buildSessionSnapshot(cwd, workDir),
      }
    }

    const seeded = await maybeSeedAutoresearchMd(workDir, input, maxIterations)
    const [resumeContext, hasAutoresearchSh, hasChecks] = await Promise.all([
      shouldResume ? collectResumeContext(workDir) : Promise.resolve(''),
      exists(join(workDir, AUTORESEARCH_SH)),
      exists(join(workDir, AUTORESEARCH_CHECKS)),
    ])
    const effectiveName =
      runtimeBeforeStart?.experiment?.name ??
      input.name ??
      input.goal ??
      'Autoresearch Session'
    const effectiveMetricName =
      runtimeBeforeStart?.experiment?.metricName ??
      input.metric_name ??
      input.metric ??
      'metric'
    const effectiveDirection =
      runtimeBeforeStart?.experiment?.direction ?? input.direction ?? 'lower'
    const effectiveMetricUnit =
      runtimeBeforeStart?.experiment?.metricUnit ?? input.metric_unit ?? ''

    let bootstrapNote = ''
    if (!runtimeBeforeStart?.experiment) {
      const initResult = await handleInitExperiment(
        {
          ...input,
          action: 'init_experiment',
          name: effectiveName,
          metric_name: effectiveMetricName,
          metric_unit: effectiveMetricUnit,
          direction: effectiveDirection,
        },
        cwd,
        workDir,
        maxIterations,
      )
      if (!initResult.success) {
        return {
          ...initResult,
          action: 'start',
        }
      }
      bootstrapNote = `${initResult.message}\n`
    }

    const strictProtocolPrompt = [
      'You are in protocol-first AUTORESEARCH mode.',
      'You MUST use ONLY autoresearch actions: run_experiment and log_experiment (init_experiment already handled unless you are explicitly resetting segment).',
      '',
      'Loop requirements:',
      `- Work directory: ${workDir}`,
      `- Max iterations: ${maxIterations}`,
      `- Auto-stop non-keep streak: ${runtimeBeforeStart?.experiment?.autoStopNonKeepStreak ?? input.auto_stop_non_keep_streak ?? DEFAULT_AUTO_STOP_NON_KEEP_STREAK}`,
      `- Primary metric: ${effectiveMetricName}`,
      `- Direction: ${effectiveDirection}`,
      `- Scope: ${input.scope ?? '(not constrained)'}`,
      `- Benchmark command: ${input.command ?? input.verify ?? (hasAutoresearchSh ? `bash ${AUTORESEARCH_SH}` : '(provide command in run_experiment)')}`,
      `- Guard command: ${input.guard ?? (hasChecks ? `bash ${AUTORESEARCH_CHECKS}` : '(none)')}`,
      '',
      'For each iteration:',
      '1) Make one small code change hypothesis.',
      '2) Call autoresearch with action="run_experiment".',
      '3) Immediately call autoresearch with action="log_experiment".',
      '4) Status policy:',
      '- benchmark failed => crash',
      '- checks failed/timed out => checks_failed (never keep)',
      '- benchmark passed + improved primary metric => keep',
      '- otherwise => discard',
      '',
      'Do not manually run git commit/revert; log_experiment enforces it.',
      'Stop when max iterations reached or no promising hypotheses remain.',
      `Hard stop: if consecutive non-keep results reaches configured limit, the tool will auto-stop and reject further runs until init_experiment is called again.`,
      '',
      resumeContext ? `Resume context:\n${resumeContext}` : 'No prior session context found.',
    ].join('\n')
    const userMessage = createUserMessage(strictProtocolPrompt)
    const agentMessages: Message[] = []
    const currentRuntime = await readRuntime(cwd)

    await writeRuntime(cwd, {
      mode: 'active',
      workDir,
      goal: input.goal ?? currentRuntime?.goal,
      updatedAt: nowIso(),
      experiment: currentRuntime?.experiment,
    })

    try {
      for await (const message of runAgent({
        agentDefinition: GENERAL_PURPOSE_AGENT,
        promptMessages: [userMessage],
        toolUseContext: context,
        canUseTool,
        isAsync: false,
        querySource: 'agent:custom',
        model: undefined,
        availableTools: context.options.tools,
        override: { agentId: `autoresearch-${Date.now()}` },
      })) {
        agentMessages.push(message)

        // Report progress if needed
        if (onProgress && (message.type === 'assistant' || message.type === 'user')) {
          onProgress({
            toolUseID: `autoresearch_${parentMessage?.message.id || 'unknown'}`,
            data: {
              message,
              type: 'autoresearch_progress',
              iteration: agentMessages.length,
            } satisfies AutoresearchProgress,
          })
        }
      }

      let resultText = ''
      for (const msg of agentMessages) {
        if (msg.type === 'assistant' && msg.message.content) {
          const content = msg.message.content
          if (typeof content === 'string') {
            resultText += content
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text') {
                resultText += block.text
              }
            }
          }
        }
      }

      if (!resultText.trim()) {
        resultText = 'Autoresearch completed but no summary was provided by the agent.'
      }

      const postSummary = await parseSessionSummary(workDir)
      const summaryTail = `\n\nSession stats: runs=${postSummary.totalRuns}, keep=${postSummary.keep}, discard=${postSummary.discard}, crash=${postSummary.crash}, checks_failed=${postSummary.checksFailed}`
      const seedNote = seeded ? `\nInitialized ${AUTORESEARCH_MD}.` : ''

      return {
        success: true,
        mode: 'active',
        action,
        message: `Autoresearch loop completed.${seedNote}\n${bootstrapNote}Work dir: ${workDir}\n\nResults:\n${resultText}${summaryTail}`,
        session: await buildSessionSnapshot(cwd, workDir),
      }
    } catch (error) {
      await writeRuntime(cwd, {
        mode: 'inactive',
        workDir,
        goal: input.goal,
        updatedAt: nowIso(),
      })
      return {
        success: false,
        mode: 'inactive',
        action,
        message: `Autoresearch failed: ${error instanceof Error ? error.message : String(error)}\nWork dir: ${workDir}`,
        session: await buildSessionSnapshot(cwd, workDir),
      }
    }
  },
})
