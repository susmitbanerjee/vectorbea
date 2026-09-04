#!/usr/bin/env node
/**
 * Screen verifier — proves a route renders REAL data, not fixtures.
 *
 * The failure this exists to catch is specific: a screen that looks finished,
 * renders plausible rows, and is actually reading `~/mocks/**`. Screenshots do
 * not catch it — fabricated data photographs exactly as well as real data. So
 * this asserts on the DOM only, and asserts in both directions:
 *
 *   1. every value the caller says is REAL must be present, and
 *   2. none of the four fixture markers may appear anywhere.
 *
 * (1) alone is not enough — a screen can show one real value beside fixture
 * rows. (2) alone is not enough — an empty page passes it trivially.
 *
 * DOM assertions only, deliberately. No screenshots: the browser surface in
 * this environment cannot composite frames, and an image is the wrong evidence
 * for this question regardless.
 *
 * Usage:
 *   node scripts/verify/verify-screen.ts --route /runs --expect "wf_9c21" --expect "Succeeded"
 *   node scripts/verify/verify-screen.ts --route /workflows --expect-file expected.json
 *
 * Options:
 *   --route <path>          Route to verify, e.g. /runs           (required)
 *   --expect <value>        A real value that MUST appear. Repeatable.
 *   --expect-file <path>    JSON array of expected values, merged with --expect.
 *   --base-url <url>        Default http://localhost:3000
 *   --main-selector <sel>   Content region to dump. Default: main, [role=main], #__next
 *   --wait-for <sel>        Extra selector to await before asserting.
 *   --timeout <ms>          Navigation/selector timeout. Default 30000.
 *   --settle <ms>           Best-effort quiet-network window after load. Default 5000.
 *   --no-auth               Skip cookie injection (public routes).
 *   --quiet                 Suppress the DOM dump on success.
 *
 * Exit codes: 0 all assertions passed · 1 any assertion failed or the page errored.
 */

import { chromium, type BrowserContext, type Cookie } from "playwright";
import { readFileSync } from "node:fs";

/* ── The four markers that must never reach a user ────────────────────────── */
// Kept identical to scripts/check-fixtures.mjs. If these ever diverge, one of
// the two guards is silently checking the wrong thing.
const FIXTURE_MARKERS = ["Acme Platform", "ws_acme_eu", "run_01JBQZ8XK4", "inc_7c2f18ab90de"];

/* ── Argument parsing ─────────────────────────────────────────────────────── */

interface Args {
  route: string;
  expect: string[];
  baseUrl: string;
  mainSelector: string | null;
  waitFor: string | null;
  timeout: number;
  settleMs: number;
  auth: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const expect: string[] = [];
  let route = "";
  let baseUrl = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
  let mainSelector: string | null = null;
  let waitFor: string | null = null;
  let timeout = 30_000;
  let settleMs = 5_000;
  let auth = true;
  let quiet = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${arg} requires a value`);
      return v;
    };
    switch (arg) {
      case "--route": route = next(); break;
      case "--expect": expect.push(next()); break;
      case "--expect-file": {
        const raw = readFileSync(next(), "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) fail("--expect-file must contain a JSON array of strings");
        for (const v of parsed as unknown[]) expect.push(String(v));
        break;
      }
      case "--base-url": baseUrl = next(); break;
      case "--main-selector": mainSelector = next(); break;
      case "--wait-for": waitFor = next(); break;
      case "--timeout": timeout = Number(next()); break;
      case "--settle": settleMs = Number(next()); break;
      case "--no-auth": auth = false; break;
      case "--quiet": quiet = true; break;
      case "--help":
      case "-h": usage(); process.exit(0);
      // eslint-disable-next-line no-fallthrough
      default: fail(`Unknown argument: ${arg}`);
    }
  }

  if (!route) fail("--route is required");
  // Git Bash on Windows rewrites a leading-slash argument into a Windows path
  // before node ever sees it, so `--route /runs` arrives as
  // `C:/Program Files/Git/runs` and every assertion then fails against a 404.
  // The symptom looks like a broken screen, so name the real cause instead of
  // silently guessing what the route was meant to be.
  if (/^\/?[A-Za-z]:[\\/]/.test(route)) {
    fail(
      `--route was rewritten to a filesystem path (${route}).\n` +
        "  Git Bash converted it. Re-run with MSYS_NO_PATHCONV=1, e.g.\n" +
        "    MSYS_NO_PATHCONV=1 node scripts/verify/verify-screen.ts --route /runs …",
    );
  }
  if (!route.startsWith("/")) route = `/${route}`;
  return {
    route,
    expect,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    mainSelector,
    waitFor,
    timeout,
    settleMs,
    auth,
    quiet,
  };
}

function usage(): void {
  const self = readFileSync(new URL(import.meta.url), "utf8");
  console.log(self.slice(0, self.indexOf("*/") + 2).replace(/^#!.*\n/, ""));
}

function fail(message: string): never {
  console.error(`verify-screen: ${message}`);
  process.exit(1);
}

/* ── Supabase session cookie ──────────────────────────────────────────────── */

interface JwtClaims {
  exp?: number;
  sub?: string;
  aud?: string;
  role?: string;
  email?: string;
}

function decodeJwtPayload(token: string): JwtClaims | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}

/**
 * Build the cookie @supabase/ssr expects.
 *
 * The name is derived from the project ref in NEXT_PUBLIC_SUPABASE_URL, and the
 * value is the base64-prefixed session JSON that @supabase/ssr v0.10 writes.
 * Values above ~3180 bytes are chunked into `.0`, `.1`, … exactly as the library
 * does — a JWT with any real claim set routinely crosses that line, and an
 * unchunked oversized cookie is silently dropped by the browser, which presents
 * as "logged out" with no error to read.
 */
function sessionCookies(token: string, supabaseUrl: string, appUrl: string): Cookie[] {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  if (!ref) fail(`Could not derive a Supabase project ref from ${supabaseUrl}`);

  // Mirrors the session shape @supabase/ssr persists. expires_at is read by the
  // client to decide whether to refresh; a past value triggers an immediate
  // refresh against Supabase and the injected session is discarded.
  const claims = decodeJwtPayload(token);
  const session = {
    access_token: token,
    token_type: "bearer",
    expires_at: claims?.exp ?? Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    refresh_token: process.env.E2E_SUPABASE_REFRESH_TOKEN ?? "",
    user: {
      id: claims?.sub ?? "",
      aud: claims?.aud ?? "authenticated",
      role: claims?.role ?? "authenticated",
      email: claims?.email ?? "",
      app_metadata: {},
      user_metadata: {},
      created_at: new Date(0).toISOString(),
    },
  };

  const encoded = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64")}`;
  const { hostname } = new URL(appUrl);
  const base = {
    domain: hostname,
    path: "/",
    expires: Math.floor(Date.now() / 1000) + 3600,
    httpOnly: false,
    secure: appUrl.startsWith("https://"),
    sameSite: "Lax" as const,
  };

  const CHUNK = 3180;
  if (encoded.length <= CHUNK) {
    return [{ name: `sb-${ref}-auth-token`, value: encoded, ...base }];
  }
  const chunks: Cookie[] = [];
  for (let i = 0; i * CHUNK < encoded.length; i++) {
    chunks.push({
      name: `sb-${ref}-auth-token.${i}`,
      value: encoded.slice(i * CHUNK, (i + 1) * CHUNK),
      ...base,
    });
  }
  return chunks;
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const target = `${args.baseUrl}${args.route}`;

  const browser = await chromium.launch({ headless: true });
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  if (args.auth) {
    const token = process.env.E2E_SUPABASE_TOKEN;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!token) {
      await browser.close();
      fail("E2E_SUPABASE_TOKEN is not set. Export it, or pass --no-auth for a public route.");
    }
    if (!supabaseUrl) {
      await browser.close();
      fail("NEXT_PUBLIC_SUPABASE_URL is not set — it is needed to name the session cookie.");
    }
    await context.addCookies(sessionCookies(token, supabaseUrl, args.baseUrl));
  }

  // Console and network errors are collected rather than thrown on: a screen can
  // render correctly while something unrelated warns, and the assertions below
  // are the actual verdict. They are reported because they usually explain a
  // missing value faster than the DOM dump does.
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("requestfailed", (r) =>
    failedRequests.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText ?? "failed"}`),
  );
  page.on("response", (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });

  let failed = false;
  let mainText = "";
  let pageHtml = "";

  try {
    // `networkidle` is the obvious choice and the wrong one here: a Next dev
    // server holds an HMR socket open, so the network never goes idle and every
    // run fails as a timeout with an empty DOM — which reads exactly like a
    // broken screen. Get the document, then give client-side fetches a bounded
    // window to settle, and treat that settle as best-effort.
    const response = await page.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: args.timeout,
    });
    await page.waitForLoadState("networkidle", { timeout: args.settleMs }).catch(() => {
      /* HMR or polling keeps the socket busy — assert on what rendered anyway */
    });
    const status = response?.status() ?? 0;
    console.log(`→ ${target}  (HTTP ${status})`);
    if (status >= 400) {
      console.error(`  ✗ Route returned HTTP ${status}`);
      failed = true;
    }

    if (args.waitFor) {
      try {
        await page.waitForSelector(args.waitFor, { timeout: args.timeout });
      } catch {
        console.error(`  ✗ --wait-for selector never appeared: ${args.waitFor}`);
        failed = true;
      }
    }

    const selector = args.mainSelector ?? "main, [role='main'], #__next, body";
    const region = page.locator(selector).first();
    mainText = (await region.count()) > 0 ? (await region.innerText().catch(() => "")) || "" : "";
    // The forbidden-marker check reads the whole document, not just the content
    // region: a fixture id leaking into a sidebar, a title or a script tag is
    // still fabricated data reaching a user.
    pageHtml = await page.content();
  } catch (err) {
    console.error(`  ✗ Navigation failed: ${(err as Error).message}`);
    failed = true;
  }

  /* ── Assertion 1: every expected real value is present ──────────────────── */
  if (args.expect.length === 0) {
    console.log("\n  ! No --expect values given — only the fixture-marker check ran.");
  } else {
    console.log(`\nExpected real values (${args.expect.length}):`);
    for (const value of args.expect) {
      const present = mainText.includes(value) || pageHtml.includes(value);
      console.log(`  ${present ? "✓" : "✗"} ${value}`);
      if (!present) failed = true;
    }
  }

  /* ── Assertion 2: zero fixture markers ──────────────────────────────────── */
  console.log("\nFixture markers (must be absent):");
  for (const marker of FIXTURE_MARKERS) {
    const present = pageHtml.includes(marker);
    console.log(`  ${present ? "✗ FOUND" : "✓ absent"}  ${marker}`);
    if (present) failed = true;
  }

  /* ── Evidence ───────────────────────────────────────────────────────────── */
  if (!args.quiet || failed) {
    console.log("\n── DOM text of main content region ──────────────────────────");
    console.log(mainText.trim() || "(empty — the content region rendered nothing)");
    console.log("─────────────────────────────────────────────────────────────");
  }

  if (failedRequests.length > 0) {
    console.log(`\nFailed/4xx+ requests (${failedRequests.length}):`);
    for (const r of failedRequests.slice(0, 15)) console.log(`  ${r}`);
  }
  if (consoleErrors.length > 0) {
    console.log(`\nConsole errors (${consoleErrors.length}):`);
    for (const e of consoleErrors.slice(0, 10)) console.log(`  ${e}`);
  }

  await browser.close();

  console.log(`\n${failed ? "FAIL" : "PASS"}  ${args.route}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`verify-screen: unexpected error — ${(err as Error).stack ?? err}`);
  process.exit(1);
});
