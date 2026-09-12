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
   turns our hosting provider and our internal service name into something they
   depend on and something an attacker can address directly — bypassing whatever
   sits in front of the vanity domain. It is also a promise we cannot keep: the
   day the API moves off that provider, every snippet anybody ever copied stops
   working.

   So there are two functions. Transport reads the first; anything a human is
   meant to copy reads [getPublicApiBaseUrl].

   ── AND WHEN IT IS NOT CONFIGURED, WE SAY SO RATHER THAN GUESS ──────────────
   `WebhookRoutes.urlFor` already made this decision on the API side: without
   `PUBLIC_API_BASE_URL` it returns the path alone, because a confidently
   incorrect absolute URL pasted into Stripe is worse than a relative one
   somebody has to complete. The same reasoning applies here, so the same answer
   is given — `null`, and the caller renders the path with a line naming the
   variable to set.

   localhost is the one exception, and it is not a leak: on a developer's own
   machine the internal origin IS the public one, and hiding it would make the
   card useless in the only environment where somebody is likely to try the
   snippet immediately.
══════════════════════════════════════════════════════════════════════════════ */

/** Hosts that are an implementation detail of where we happen to run today. */
const INTERNAL_HOST_PATTERNS = [
  /\.railway\.app$/i,
  /\.railway\.internal$/i,
  /\.onrender\.com$/i,
  /\.fly\.dev$/i,
  /\.herokuapp\.com$/i,
  /\.vercel\.app$/i,
  /\.internal$/i,
];

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "0.0.0.0";
}

/**
 * The origin a CUSTOMER should call, or null when nobody has configured one.
 *
 * Mirrors the API's own `PUBLIC_API_BASE_URL`, deliberately: an operator
 * setting one and not the other would get a webhook URL and a workflow endpoint
 * on two different hostnames, which reads as a bug in the product rather than a
 * gap in the deployment.
 */
export function getPublicApiBaseUrl(): string | null {
  const declared =
    process.env.NEXT_PUBLIC_PUBLIC_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_PUBLIC_URL;
  if (declared && declared.trim() !== "") return declared.trim().replace(/\/+$/, "");

  const internal = getApiBaseUrl();
  let host: string;
  try {
    host = new URL(internal).hostname;
  } catch {
    /* An unparseable value is not something to publish either. */
    return null;
  }

  if (isLoopback(host)) return internal;
  if (INTERNAL_HOST_PATTERNS.some((pattern) => pattern.test(host))) return null;

  /* A hostname nobody flagged as infrastructure — a vanity domain somebody
     pointed at the API — is publishable. This is the case an operator lands in
     once they put `api.<their domain>` in front of it and forget the variable,
     and refusing it there would be pedantry. */
  return internal;
}

/** Default per-request timeout. Overridable per call. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Retry budget for transport-layer faults. 3 attempts means 2 retries. */
export const MAX_ATTEMPTS = 3;
