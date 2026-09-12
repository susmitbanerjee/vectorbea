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

describe("getPublicApiBaseUrl", () => {
  it("refuses to publish the platform's own hosting origin", async () => {
    const { getPublicApiBaseUrl, getApiBaseUrl } = await load({
      NEXT_PUBLIC_VECTORBEA_API_URL: "https://vectorbea-api-production.up.railway.app",
    });

    // Transport still uses it — the browser has to reach something.
    expect(getApiBaseUrl()).toBe("https://vectorbea-api-production.up.railway.app");
    // Nothing a customer copies may carry it.
    expect(getPublicApiBaseUrl()).toBeNull();
  });

  it.each([
    "https://api.up.railway.app",
    "https://api.railway.internal",
    "https://vectorbea.onrender.com",
    "https://vectorbea.fly.dev",
    "https://vectorbea.herokuapp.com",
    "https://vectorbea-api.vercel.app",
    "https://api.internal",
  ])("treats %s as infrastructure, not an address", async (url) => {
    const { getPublicApiBaseUrl } = await load({ NEXT_PUBLIC_VECTORBEA_API_URL: url });
    expect(getPublicApiBaseUrl()).toBeNull();
  });

  it("uses the configured public origin when there is one, even on a provider host", async () => {
    const { getPublicApiBaseUrl } = await load({
      NEXT_PUBLIC_VECTORBEA_API_URL: "https://vectorbea-api-production.up.railway.app",
      NEXT_PUBLIC_PUBLIC_API_BASE_URL: "https://api.vectorbea.com/",
    });
    // Trailing slash trimmed, so callers can append a path without doubling it.
    expect(getPublicApiBaseUrl()).toBe("https://api.vectorbea.com");
  });

  it("publishes localhost, because on a developer's machine it is the public origin", async () => {
    const { getPublicApiBaseUrl } = await load({
      NEXT_PUBLIC_API_URL: "http://localhost:8080",
    });
    expect(getPublicApiBaseUrl()).toBe("http://localhost:8080");
  });

  it("publishes a vanity domain somebody pointed at the API", async () => {
    const { getPublicApiBaseUrl } = await load({
      NEXT_PUBLIC_VECTORBEA_API_URL: "https://api.example.com",
    });
    expect(getPublicApiBaseUrl()).toBe("https://api.example.com");
  });

  it("publishes nothing when the configured value is not a URL at all", async () => {
    const { getPublicApiBaseUrl } = await load({
      NEXT_PUBLIC_VECTORBEA_API_URL: "not a url",
    });
    expect(getPublicApiBaseUrl()).toBeNull();
  });
});
