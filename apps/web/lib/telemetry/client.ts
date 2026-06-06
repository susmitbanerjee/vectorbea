/**
 * Vectorbea analytics client for the web frontend.
 *
 * Usage:
 *   import { track } from '@/lib/telemetry/client'
 *   track('architect_opened', { source: 'dashboard' })
 *
 * Rules:
 *  - Never send secrets, passwords, API keys, or tokens.
 *  - Never send raw prompt content or LLM outputs.
 *  - Events are best-effort — failure does not throw.
 *  - Environment is auto-detected from NEXT_PUBLIC_VECTORBEA_ENV.
 */

const TELEMETRY_ENABLED = process.env.NEXT_PUBLIC_TELEMETRY_ENABLED === 'true'
const TELEMETRY_ENDPOINT = process.env.NEXT_PUBLIC_TELEMETRY_ENDPOINT ?? ''
const VECTORBEA_ENV = process.env.NEXT_PUBLIC_VECTORBEA_ENV ?? 'dev'

export interface TrackOptions {
  workspaceId?: string
  appUserId?: string
  environmentId?: string
  sessionId?: string
  runId?: string
  workflowId?: string
  connectionId?: string
  agentId?: string
  toolId?: string
  architectSessionId?: string
  sourcePage?: string
  sourceComponent?: string
  properties?: Record<string, unknown>
}

/**
 * Tracks a user journey or product analytics event.
 * Fire-and-forget — never throws.
 */
export function track(
  eventName: string,
  options: TrackOptions = {}
): void {
  if (!TELEMETRY_ENABLED || !TELEMETRY_ENDPOINT) return

  const { properties = {}, ...ids } = options

  // Strip any accidentally passed sensitive keys from properties
  const safeProperties = stripSensitiveKeys(properties)

  const payload = {
    events: [
      {
        eventName,
        eventCategory: categoryFor(eventName),
        occurredAt: new Date().toISOString(),
        environment: VECTORBEA_ENV,
        sourceService: 'vectorbea-web',
        sourcePage: typeof window !== 'undefined' ? window.location.pathname : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        ...ids,
        properties: safeProperties,
      },
    ],
  }

  void sendBestEffort(payload)
}

async function sendBestEffort(payload: object): Promise<void> {
  try {
    await fetch(`${TELEMETRY_ENDPOINT}/api/telemetry/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    })
  } catch {
    // Silently ignore — telemetry must not affect UX
  }
}

const SENSITIVE_KEYS = new Set([
  'password', 'secret', 'token', 'api_key', 'apikey',
  'authorization', 'credential', 'private_key',
  'connection_string', 'database_url', 'redis_url',
  'cookie', 'bearer', 'access_token', 'refresh_token',
  'prompt', 'raw_prompt', 'llm_output',
])

function stripSensitiveKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !SENSITIVE_KEYS.has(k.toLowerCase()))
  )
}

/** Infers event category from event name prefix. */
function categoryFor(eventName: string): string {
  const prefix = eventName.split('_')[0]
  const map: Record<string, string> = {
    beta: 'beta',
    workspace: 'workspace',
    user: 'user',
    member: 'user',
    architect: 'architect',
    workflow: 'workflow',
    connection: 'connection',
    run: 'run',
    simulation: 'simulation',
    real: 'real_execution',
    approval: 'approval',
    agent: 'agent',
    tool: 'tool',
    failure: 'recovery',
    recovery: 'recovery',
    usage: 'usage_limit',
    first: 'onboarding',
  }
  return map[prefix] ?? 'user'
}
