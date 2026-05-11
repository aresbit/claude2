import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { isEnvTruthy } from '../envUtils.js'

export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry'

export function getAPIProvider(): APIProvider {
  return isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
    ? 'bedrock'
    : isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
      ? 'vertex'
      : isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
        ? 'foundry'
        : 'firstParty'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if ANTHROPIC_BASE_URL is a first-party Anthropic API URL.
 * Returns true if not set (default API) or points to api.anthropic.com
 * (or api-staging.anthropic.com for ant users).
 */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}

/**
 * DeepSeek API detection patterns. Matches known DeepSeek API endpoints
 * and common proxy/gateway URLs that route to DeepSeek.
 */
const DEEPSEEK_HOST_PATTERNS = [
  'api.deepseek.com',
  'api.deepseek.ai',
  'deepseek-api.',
  '-deepseek-',
]

const DEEPSEEK_MODEL_PREFIX = 'deepseek'

/**
 * Detect if the configured API endpoint is DeepSeek.
 *
 * Detection order:
 * 1. ANTHROPIC_BASE_URL host matches known DeepSeek patterns
 * 2. ANTHROPIC_MODEL starts with 'deepseek' (fallback for proxy setups)
 *
 * Returns false when ANTHROPIC_BASE_URL is unset (defaults to Anthropic).
 */
export function isDeepSeekAPI(): boolean {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (baseUrl) {
    try {
      const host = new URL(baseUrl).host
      if (DEEPSEEK_HOST_PATTERNS.some(p => host.includes(p))) {
        return true
      }
    } catch {
      // invalid URL — fall through to model check
    }
  }

  // Fallback: check if the model name signals DeepSeek
  const model = process.env.ANTHROPIC_MODEL
  if (model && model.toLowerCase().startsWith(DEEPSEEK_MODEL_PREFIX)) {
    return true
  }

  return false
}

/**
 * Master toggle for DeepSeek prefix optimization.
 *
 * Returns true when:
 * - The API endpoint is detected as DeepSeek, AND
 * - CLAUDE_CODE_DISABLE_DEEPSEEK_PREFIX_OPT is NOT set
 *
 * The env var serves as both a global kill-switch and a per-session opt-out.
 */
export function isDeepSeekPrefixOptEnabled(): boolean {
  if (!isDeepSeekAPI()) return false
  return !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_DEEPSEEK_PREFIX_OPT)
}
