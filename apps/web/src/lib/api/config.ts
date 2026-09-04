/**
 * Transport configuration.
 *
 * `NEXT_PUBLIC_DATA_MODE` switches the TRANSPORT, never component behaviour.
 * Read it here and nowhere else, so there is exactly one place that knows the
 * app can run on fixtures.
 */

export type DataMode = "mock" | "live";

export function getDataMode(): DataMode {
  return process.env.NEXT_PUBLIC_DATA_MODE === "mock" ? "mock" : "live";
}

export function isMockMode(): boolean {
  return getDataMode() === "mock";
}

/**
 * Base URL of the Kotlin API. Never read in mock mode.
 *
 * The fallback chain matches what the rest of the repo already does
 * (`lib/api.ts`, the beta routes, the schedules page):
 * `NEXT_PUBLIC_VECTORBEA_API_URL` is the deployed name, `NEXT_PUBLIC_API_URL`
 * is what most local `.env.local` files actually carry. Reading only the first
 * would make this layer the one thing in the app that cannot find the API on a
 * developer's machine.
 */
export function getApiBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_VECTORBEA_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:8080";
  return raw.replace(/\/+$/, "");
}

/** Default per-request timeout. Overridable per call. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Retry budget for transport-layer faults. 3 attempts means 2 retries. */
export const MAX_ATTEMPTS = 3;
