import { describe, expect, it, afterEach, vi } from "vitest";

/**
 * The origin we PRINT is not the origin we CALL.
 *
 * `getApiBaseUrl()` is transport: on a deployed environment it is whatever
 * hostname our platform provider happens to have given the API today, and the
 * browser reaching it there is nobody's business. `getPublicApiBaseUrl()` is
 * what goes into a curl snippet a customer pastes into their own backend, their
 * CI and a third party's console — so it must never carry that hostname.
 *
 * These read the module fresh per case because `process.env.NEXT_PUBLIC_*` is
 * read at module scope by Next's inliner in a real build; `vi.resetModules()`
 * keeps each case honest about which value it is testing.
 */

const ENV_KEYS = [
  "NEXT_PUBLIC_PUBLIC_API_BASE_URL",
  "NEXT_PUBLIC_API_PUBLIC_URL",
  "NEXT_PUBLIC_VECTORBEA_API_URL",
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_VECTORBEA_ENV",
] as const;

const saved = new Map<string, string | undefined>();
for (const key of ENV_KEYS) saved.set(key, process.env[key]);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
});

async function load(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  vi.resetModules();
  return import("~/lib/api/config");
}

const RAILWAY = "https://vectorbea-api-production.up.railway.app";

describe("getPublicApiBaseUrl", () => {
  it("prints api.vectorbea.com in production, never the hosting origin", async () => {
    const { getPublicApiBaseUrl, getApiBaseUrl } = await load({
      NEXT_PUBLIC_VECTORBEA_API_URL: RAILWAY,
      NEXT_PUBLIC_VECTORBEA_ENV: "prod",
    });
    // Transport still uses it — the browser has to reach something.
    expect(getApiBaseUrl()).toBe(RAILWAY);
    expect(getPublicApiBaseUrl()).toBe("https://api.vectorbea.com");
  });

  it.each(["dev", "staging", "stage", ""])("prints devapi.vectorbea.com for env %j", async (env) => {
    const { getPublicApiBaseUrl } = await load({
      NEXT_PUBLIC_VECTORBEA_API_URL: "https://vectorbea-api-staging.up.railway.app",
      NEXT_PUBLIC_VECTORBEA_ENV: env,
    });
    expect(getPublicApiBaseUrl()).toBe("https://devapi.vectorbea.com");
  });

  it("never prints a railway host, whatever the environment says", async () => {
    for (const env of ["prod", "dev", "production", "anything"]) {
      const { getPublicApiBaseUrl } = await load({ NEXT_PUBLIC_VECTORBEA_API_URL: RAILWAY, NEXT_PUBLIC_VECTORBEA_ENV: env });
      expect(getPublicApiBaseUrl()).not.toMatch(/railway/);
    }
  });

  it("uses an explicitly configured public origin over the environment", async () => {
    const { getPublicApiBaseUrl } = await load({
      NEXT_PUBLIC_VECTORBEA_API_URL: RAILWAY,
      NEXT_PUBLIC_VECTORBEA_ENV: "prod",
      NEXT_PUBLIC_PUBLIC_API_BASE_URL: "https://api.customer.example/",
    });
    // Trailing slash trimmed, so callers can append a path without doubling it.
    expect(getPublicApiBaseUrl()).toBe("https://api.customer.example");
  });

  it("publishes localhost, because on a developer's machine it is the public origin", async () => {
    const { getPublicApiBaseUrl } = await load({ NEXT_PUBLIC_API_URL: "http://localhost:8080" });
    expect(getPublicApiBaseUrl()).toBe("http://localhost:8080");
  });

  it("falls back to the environment when the transport origin is not a URL", async () => {
    const { getPublicApiBaseUrl } = await load({ NEXT_PUBLIC_VECTORBEA_API_URL: "not a url", NEXT_PUBLIC_VECTORBEA_ENV: "prod" });
    expect(getPublicApiBaseUrl()).toBe("https://api.vectorbea.com");
  });
});
