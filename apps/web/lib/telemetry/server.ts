import "server-only";

/**
 * Server-side telemetry emitter for Next.js API routes (sign-in, signup,
 * workspace creation…). Posts straight to the telemetry service's internal
 * endpoint with the internal token — fire-and-forget, never throws.
 *
 * Environment attribution: VECTORBEA_ENV (server truth) — falls back to
 * NEXT_PUBLIC_VECTORBEA_ENV, then "dev".
 */
export function trackServer(
  eventName: string,
  eventCategory: string,
  opts: {
    appUserId?: string;
    workspaceId?: string;
    properties?: Record<string, unknown>;
  } = {},
): void {
  const endpoint = (process.env.TELEMETRY_ENDPOINT ?? "").replace(/\/$/, "");
  const token = process.env.TELEMETRY_INTERNAL_TOKEN ?? "";
  if (!endpoint || !token) return;

  const environment = process.env.VECTORBEA_ENV ?? process.env.NEXT_PUBLIC_VECTORBEA_ENV ?? "dev";

  const payload = {
    events: [{
      eventName,
      eventCategory,
      occurredAt: new Date().toISOString(),
      environment,
      sourceService: "vectorbea-web",
      appUserId: opts.appUserId,
      workspaceId: opts.workspaceId,
      properties: opts.properties ?? {},
    }],
  };

  void fetch(`${endpoint}/internal/telemetry/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telemetry-Token": token,
      "X-Source-Service": "vectorbea-web",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(3000),
  }).catch(() => { /* telemetry never breaks the request path */ });
}
