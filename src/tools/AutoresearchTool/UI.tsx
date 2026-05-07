import React from 'react'
import { MessageResponse } from '../../components/MessageResponse.js'
import { Box, Text } from '../../ink.js'
import type { ProgressMessage } from '../../types/message.js'
import type { AutoresearchProgress, Input, Output } from './AutoresearchTool.js'

function percent(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0.0%'
  return `${((numerator / denominator) * 100).toFixed(1)}%`
}

function shortPath(fullPath: string): string {
  const parts = fullPath.split('/').filter(Boolean)
  if (parts.length <= 3) return fullPath
  return `.../${parts.slice(-3).join('/')}`
}

export function userFacingName(): string {
  return 'Autoresearch'
}

export function renderToolUseMessage(input: Partial<Input>): React.ReactNode {
  const action = input.action ?? 'start'
  if (action === 'init_experiment') {
    return `Init experiment${input.name ? `: ${input.name}` : ''}`
  }
  if (action === 'run_experiment') {
    return `Run experiment${input.command ? `: ${input.command}` : ''}`
  }
  if (action === 'log_experiment') {
    return `Log experiment${input.status ? ` (${input.status})` : ''}`
  }
  if (action === 'status') return 'Show autoresearch status'
  if (action === 'off') return 'Turn autoresearch mode off'
  if (action === 'clear') return 'Clear autoresearch session log'
  if (action === 'queue') return `Run experiment queue (${(input.manifest ?? []).length} jobs)`
  if (action === 'queue_status') return `Show queue status${input.queue_name ? `: ${input.queue_name}` : ''}`
  if (action === 'queue_stop') return `Stop queue: ${input.queue_name ?? ''}`
  if (action === 'audit') return `Audit experiment results in ${input.audit_target ?? 'workdir'}`
  if (action === 'analyze') return `Analyze experiment results${input.analyze_context ? `: ${input.analyze_context}` : ''}`
  const goal = input.goal?.trim()
  return goal ? `Start autoresearch: ${goal}` : 'Start autoresearch loop'
}

export function renderToolUseProgressMessage(
  progressMessages: ProgressMessage<AutoresearchProgress>[],
): React.ReactNode {
  if (progressMessages.length === 0) return null
  const last = progressMessages[progressMessages.length - 1]
  if (!last?.data || last.data.type !== 'autoresearch_progress') return null
  return (
    <MessageResponse>
      <Text dimColor={true}>Running autoresearch iteration {last.data.iteration}...</Text>
    </MessageResponse>
  )
}

export function renderToolResultMessage(output: Output): React.ReactNode {
  const session = output.session

  // Queue result
  if (output.action === 'queue' && output.queue_summary) {
    const qs = output.queue_summary
    return (
      <MessageResponse>
        <Box flexDirection="column">
          <Text>📋 autoresearch queue {output.queue_name ?? ''}</Text>
          <Text dimColor={true}>
            total {qs.total} | completed {qs.completed} | failed {qs.failed} | skipped {qs.skipped}
          </Text>
        </Box>
      </MessageResponse>
    )
  }

  // Audit result
  if (output.action === 'audit' && output.audit_report) {
    const ar = output.audit_report
    const icon = ar.overall === 'pass' ? '✅' : ar.overall === 'warn' ? '⚠️' : '🔴'
    return (
      <MessageResponse>
        <Box flexDirection="column">
          <Text>{icon} experiment audit {ar.overall}</Text>
        </Box>
      </MessageResponse>
    )
  }

  // Analyze result
  if (output.action === 'analyze') {
    return (
      <MessageResponse>
        <Text>📊 autoresearch analyze complete</Text>
      </MessageResponse>
    )
  }

  // Default: session-based display
  if (!session) {
    return (
      <MessageResponse>
        <Text>{output.mode === 'active' ? '🔬 autoresearch active' : '🔬 autoresearch inactive'}</Text>
      </MessageResponse>
    )
  }

  const failCount = session.crash + session.checksFailed
  const streakLabel = session.nonKeepStreak
    ? ` | non-keep streak ${session.nonKeepStreak.current}/${session.nonKeepStreak.limit}`
    : ''
  const metricLabel =
    session.metricName && typeof session.lastMetric === 'number'
      ? `${session.metricName}: ${session.lastMetric}`
      : session.metricName
        ? session.metricName
        : 'metric n/a'

  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text>
          🔬 autoresearch {output.mode} | runs {session.totalRuns} | keep {session.keep} (
          {percent(session.keep, session.totalRuns)})
        </Text>
        <Text dimColor={true}>
          discard {session.discard} | failures {failCount}
          {streakLabel} | {metricLabel} | {shortPath(session.workDir)}
        </Text>
        {session.stopReason ? <Text color="yellow">{session.stopReason}</Text> : null}
      </Box>
    </MessageResponse>
  )
}
