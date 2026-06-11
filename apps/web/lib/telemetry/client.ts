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

// Default ON: events go to the same-origin proxy (/api/telemetry/events),
// which no-ops server-side when TELEMETRY_ENDPOINT isn't configured.
// Set NEXT_PUBLIC_TELEMETRY_ENABLED=false to hard-disable in the browser.
const TELEMETRY_ENABLED = process.env.NEXT_PUBLIC_TELEMETRY_ENABLED !== 'false'
// Legacy direct mode: if a public endpoint is set, post straight to it
// (requires the localStorage token copy). Otherwise use the cookie-auth proxy.
const DIRECT_ENDPOINT = process.env.NEXT_PUBLIC_TELEMETRY_ENDPOINT ?? ''
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
  if (!TELEMETRY_ENABLED || typeof window === 'undefined') return

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
    const body = JSON.stringify(payload)

    if (DIRECT_ENDPOINT) {
      // Legacy direct mode — needs the localStorage token copy.
      const token = localStorage.getItem('vectorbea-access-token')
      if (!token) return
      await fetch(`${DIRECT_ENDPOINT}/api/telemetry/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body,
        keepalive: true,
      })
      return
    }

    // Same-origin proxy — authenticated by the httpOnly session cookie.
    // sendBeacon survives page navigations; fall back to keepalive fetch.
    const url = '/api/telemetry/events'
    if (navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) return
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
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
