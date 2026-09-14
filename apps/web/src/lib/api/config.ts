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

/* ══════════════════════════════════════════════════════════════════════════════
   THE ORIGIN WE TELL A CUSTOMER TO CALL IS NOT THE ORIGIN THE BROWSER CALLS.

   `getApiBaseUrl()` is a TRANSPORT detail. On a deployed environment it is the
   platform's own hosting origin — today a `*.up.railway.app` address — and the
   browser reaching the API through it is fine, because nobody reads a fetch.

   Printing it is a different act. The endpoint card, the curl snippet and the
   docs are things a customer copies into their own backend, their CI, a
   third party's console and, eventually, a support thread. Every one of those
   turns our hosting provider into something they depend on and something an
   attacker can address directly — past whatever sits in front of the vanity
   domain. It is also a promise we cannot keep: the day the API moves off that
   provider, every snippet anybody ever copied stops working.

   So there are two functions. Transport reads the first; anything a human is
   meant to copy reads [getPublicApiBaseUrl].

   ── THE PUBLIC HOST FOLLOWS THE ENVIRONMENT ─────────────────────────────────
   `NEXT_PUBLIC_VECTORBEA_ENV` already segments production from everything else
   (lib/env.ts), so the public host is derived from it:

     prod / production   → https://api.vectorbea.com
     anything else       → https://devapi.vectorbea.com

   The API makes the same decision from `VECTORBEA_ENV` (`PublicUrls.apiBase`),
   which is what keeps a webhook URL the API mints and a curl snippet this app
   prints on the same host. `NEXT_PUBLIC_PUBLIC_API_BASE_URL` overrides both
   directions, for a deployment that fronts the API somewhere else.

   localhost is the one exception, and it is not a leak: on a developer's own
   machine the transport origin IS the public one, and a snippet pointing at
   devapi from a laptop would call a different database.
══════════════════════════════════════════════════════════════════════════════ */

export const PUBLIC_API_PRODUCTION = "https://api.vectorbea.com";
export const PUBLIC_API_DEVELOPMENT = "https://devapi.vectorbea.com";

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "0.0.0.0";
}

/** The origin a CUSTOMER should call. Never the hosting provider's. */
export function getPublicApiBaseUrl(): string {
  const declared =
    process.env.NEXT_PUBLIC_PUBLIC_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_PUBLIC_URL;
  if (declared && declared.trim() !== "") return declared.trim().replace(/\/+$/, "");

  const internal = getApiBaseUrl();
  try {
    if (isLoopback(new URL(internal).hostname)) return internal;
  } catch {
    /* An unparseable transport origin says nothing about the public one. */
  }

  const env = (process.env.NEXT_PUBLIC_VECTORBEA_ENV ?? "").trim().toLowerCase();
  return env === "prod" || env === "production" ? PUBLIC_API_PRODUCTION : PUBLIC_API_DEVELOPMENT;
}

/** Default per-request timeout. Overridable per call. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Retry budget for transport-layer faults. 3 attempts means 2 retries. */
export const MAX_ATTEMPTS = 3;
