# Screen verification harness

Proves a route renders **real data from the API**, not fixtures.

The failure this catches is a screen that looks finished and is quietly reading
`~/mocks/**`. A screenshot cannot catch it — fabricated data photographs exactly
as well as real data — so this asserts on the DOM, in both directions:

1. every value you name as real **must** appear, and
2. none of the four fixture markers may appear anywhere in the document.

Either assertion alone is defeatable. Together they are not: an empty page fails
(1), and a fixture-backed page fails (2).

## Usage

```bash
node scripts/verify/verify-screen.ts --route /runs --expect "wf_9c21" --expect "Succeeded"
```

Or via npm, from the repo root:

```bash
npm run verify:screen -- --route /runs --expect "wf_9c21"
```

| Flag | Meaning |
|---|---|
| `--route <path>` | Route to verify. Required. |
| `--expect <value>` | A real value that must appear. Repeatable. |
| `--expect-file <path>` | JSON array of expected values, merged with `--expect`. |
| `--base-url <url>` | Default `http://localhost:3000`, or `$VERIFY_BASE_URL`. |
| `--main-selector <sel>` | Content region to dump. Default `main, [role=main], #__next, body`. |
| `--wait-for <sel>` | Extra selector to await before asserting. |
| `--timeout <ms>` | Default 30000. |
| `--no-auth` | Skip session injection, for public routes. |
| `--quiet` | Suppress the DOM dump on success (always shown on failure). |

Exit code is 0 only if every assertion passed.

## Authentication

By default the harness injects a Supabase session cookie built from
`$E2E_SUPABASE_TOKEN`, named `sb-<project-ref>-auth-token` where the ref comes
from `$NEXT_PUBLIC_SUPABASE_URL`. Values over ~3180 bytes are chunked into
`.0`, `.1`, … exactly as `@supabase/ssr` does — an oversized unchunked cookie is
dropped by the browser and presents as "logged out" with nothing in the logs.

`$E2E_SUPABASE_REFRESH_TOKEN` is optional; without it the session cannot refresh,
which is fine for a short assertion run.

**Against a local dev API you usually do not need a token at all.** When
`JWT_SECRET` is unset, `apps/api-kotlin` logs `AuthMiddleware: disabled (dev
mode)` and trusts the `X-Workspace-Id` header. Use `--no-auth` and let the web
app talk to that API.

## Windows / Git Bash

Git Bash rewrites a leading-slash argument into a Windows path before node sees
it, so `--route /runs` arrives as `C:/Program Files/Git/runs` and every
assertion fails against a 404. The harness detects this and tells you the fix:

```bash
MSYS_NO_PATHCONV=1 node scripts/verify/verify-screen.ts --route /runs
```

## Related

`scripts/check-fixtures.mjs` checks the same four markers from the other end —
source-import debt, the local production bundle, and (with `--url`) the deployed
HTML plus every JS chunk it links:

```bash
node scripts/check-fixtures.mjs --url https://vectorbea.com
```

Keep `FIXTURE_MARKERS` identical in both files. If they drift, one of the two
guards is silently checking the wrong thing.
