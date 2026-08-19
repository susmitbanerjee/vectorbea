# Handoff — Workflows list, overview, version history, publish flow

Written at the end of the session that delivered P09 (docs), Control, Runs, run detail,
Approvals and Incidents. This prompt was **not started** — context budget was exhausted and
starting would have produced unverified work. Everything below is what a fresh session needs.

## What the prompt asks for

Four surfaces, in dependency order:

1. **Workflows list** — table default + card toggle (persisted), 12 columns including a 30-run
   health heatstrip, filters, search across node contents, bulk actions, row actions incl. delete
   with a confirmation naming what breaks (schedules, endpoints).
2. **Workflow overview** — the landing page when you click a workflow (NOT the builder): heatstrip,
   recent runs, static graph preview, active triggers, connections/tools with health, spend trend,
   version banner.
3. **Version history** — timeline with author/timestamp/change summary/publish state, plus run count
   and success rate achieved per version. **Visual graph diff** (added verdant outline, removed
   signal, modified ember, unchanged dimmed; side-by-side and overlay), config diff per node, plain
   English summary, restore-as-new-draft, and reliability comparison between versions.
4. **Publish flow** — Draft → Validate → Simulate → Publish, each step guarded. Every publish
   creates an immutable version record.

## What already exists and should be reused

| Need | Reuse |
|---|---|
| 30-run health heatstrip | `~/components/charts/heatstrip` — already takes `statuses`, `runIds`, keyboard nav |
| Table with all 12 columns | `~/components/data/table/data-table` (`DataColumn<T>`, `useTablePreferences`, `useSelection`) |
| Search across name/description/nodes | `~/lib/query` — add fields to `RUN_FIELDS`-style schema, or make a workflow-specific one |
| Filters + saved views | `~/components/data/saved-views` (`QuickFilters`, `SavedViewsMenu`) |
| Static graph preview & diff canvas | `~/components/app/run-detail/canvas-mirror` + `buildGraph()` in `~/mocks/run-detail` |
| Spend trend | `~/components/charts/cost-trend` |
| Bulk action bar | `~/components/app/runs/bulk-bar` — pattern for confirm-with-exact-count |
| Step-by-step guarded flow | `~/components/app/onboarding/**` (P08) is the closest existing pattern |
| Cell geometry for diff nodes | `cellPath()` in `~/components/app/ribbon/geometry` |

`Workflow` in `~/mocks/domain` already has `last30: RunStatus[]`, `stepCount`, `version`, `owner`,
`environment`, `trigger`, `status`. **Missing and must be added**: description, tags, agent/tool
counts, paused/archived states, and the whole version record type.

## Fixture work needed first

New file `src/mocks/workflow-versions.ts`:

- `WorkflowVersion { id, workflowId, number, author, at, changeSummary, published, nodes, runCount, successRate }`
- Version graphs must genuinely differ node-by-node so the diff has something real to compute —
  derive v2 from v1 by adding/removing/modifying specific nodes rather than randomising, or the
  diff renders noise.
- `diffVersions(a, b)` returning `{ added, removed, modified, unchanged }` node id sets plus a
  per-node config diff. The plain-English summary is generated from that, not authored.
- Validation findings and simulate results for the publish flow.

## Traps this codebase has already hit

- **`z-*` utilities**: only the named layers from `layout.css` plus numeric `z-10` exist. Invented
  names compile to nothing silently. `check:tokens` now catches this.
- **Unscoped `:focus-visible`** in `app/globals.css:188` paints the legacy green ring on anything in
  `src/**` without its own. Every focusable needs `focus-visible:focus-ring` explicitly.
  See `/docs/audit/CURRENT-STATE.md` §9.9.
- **`useSearchParams` needs a Suspense boundary** or the whole route deopts to dynamic.
- **`getVisibleLeafColumns()` returns a fresh array每 render** — key memos on the joined ids, not the
  array identity, or every downstream memo invalidates per frame.
- **App routes are auth-gated** by `AUTH_PROTECTED_PREFIXES` in `middleware.ts`. Capture harnesses
  set a placeholder `vectorbea-access-token` cookie; see `tests/visual/capture-runs.mjs`.
- **Do not run `npm run build` while a dev server is up** — they share `.next` and it corrupts.

## Verification bar to hit

```bash
npm run typecheck && npm run lint && npm run check:tokens && npm run check:contrast && npm run check:boundaries && npm run build
```

Plus: keyboard-only pass (0 missing focus rings, 0 legacy-green), both themes reviewed visually
rather than inferred, and a capture script following `tests/visual/capture-governance.mjs`.

## Known debt carried in

- Reassign and Extend SLA on the Approvals gate card are inert handlers.
- Nested retry/loop display in the run-detail step timeline is flat.
- The run-detail scrubber has a frame sequence, not a video recording.
- `/api/bootstrap` 404s on every page (pre-existing; task chip raised).
