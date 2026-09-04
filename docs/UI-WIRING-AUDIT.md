# UI wiring audit

Controls that looked like they worked and did not, and the live-log path that
was not live. Found by scanning every `<Button>` in `apps/web/src/components`
and `apps/web/app` for one that carries no handler, no `href`, no `asChild`
parent, no `type="submit"` and no `disabled` — a control that renders as an
affordance and does nothing when pressed.

The scan is reproducible; the method is in §4.

---

## 1. What was broken

| Control | Where | What happened when pressed | Endpoint it needed |
|---|---|---|---|
| Retry failed step | Run header | Nothing — no handler at all | `POST /api/runs/:id/retry-node` |
| Retry from start | Run header | Nothing — no handler at all | `POST /api/runs/:id/retry` |
| Retry from here | Debug root-cause banner | Navigated to `/runs/{id}?action=retry`, which nothing reads | `POST /api/runs/:id/retry-node` |
| Export run | Run header | Nothing | — (client-side) |
| Copy link to this run | Run header | Nothing | — (client-side) |
| Cancel | Run header | Worked, but was not offered on `awaiting-approval` | `POST /api/runs/:id/cancel` |

Every endpoint already existed. Nothing here needed new API surface — the
buttons had simply never been connected.

### Cancel was NOT broken

Worth stating, because it was reported as broken and the first look agreed. The
path is whole: the API sets `cancellation_requested`, `WorkflowRuntime` calls
`cancellationCheck()` every fifth DAG iteration, and `RunProcessor` writes the
terminal `cancelled` row. What was wrong was narrower — the button only appeared
for `running` and `queued`, so a run parked on an approval, which is the state
most likely to need cancelling because it can sit for days, had no way to stop
from this screen. `CANCELLABLE_STATUSES` on the API has always included
`waiting_for_approval`.

The first version of that fix compared `run.status === "waiting_for_approval"`,
the API's spelling. The UI's `RunStatus` normalises it to `awaiting-approval`,
so that comparison was a constant false — a widened gate that never opens is
worse than the narrow one. TypeScript caught it; it would not have been visible
by reading.

### The retry from the debug banner was pointed at the wrong id

`onRetryFromHere` was handed the root cause's **span** id. A span is one
execution of one step, and `retry-node` is keyed on the workflow **node**, which
is `span.stepId`. Even with a handler attached, the old wiring would have failed
at the API.

---

## 2. The log was not a delay, it was a ceiling

Reported as "the terminal logs are coming in a delay, like it's not real time".
Half true, and the other half was worse.

`useRunDetailData` polled every three seconds:

```ts
queryFn: () => api.runs.events(runId, { ...scope, page: 1, pageSize: 200 })
```

`RunEventRepository.listByRun` orders `sequence ASC`. So every poll re-fetched
the **oldest two hundred events**. On a run that emits more than two hundred, the
newest events never arrived at all. Short runs merely felt slow; long ones
silently stopped updating, and nothing said so.

### The fix was already written

`apps/web/src/lib/api/run-stream.ts` is a complete SSE client for
`GET /api/runs/:id/stream`: reconnect with jittered backoff, de-duplication on
`sequence`, a backfill through `?afterSequence=` that closes the server's
500-event replay cap, and a polling fallback for when Redis is absent and the
server answers `stream_unavailable`. It has its own tests
(`__tests__/run-stream.test.ts`, 8 passing).

Nothing imported it. The run page is now its first caller.

The run RECORD is still polled, deliberately, and now at ten seconds rather than
three: status, cost and token totals live on `agent_runs` and are not published
as events, so no stream would move them. The log no longer rides on that timer.

### The pane says how it is updating

A quiet log and a stalled one look identical, and telling them apart is the whole
question a reader has while watching one. `LogStream` now shows the transport
state — and shows nothing while the stream is open, because a permanent "Live"
badge is a thing people stop seeing. `polling` reads "Refreshing on a timer",
not "unavailable": lines are still arriving and the log is the same log.

---

## 3. Still unwired, deliberately

These are missing FEATURES, not missing wiring. Each would need an endpoint that
does not exist, and inventing one from a button label is how a product grows a
half-built feature nobody asked for.

| Control | Where | What it would need |
|---|---|---|
| Allow writes / Restrict to reads | `connections-view.tsx:683` | A connection-update endpoint carrying `readOnly`. This is a permission change and wants an audit row. |
| Request an integration | `integrations-view.tsx:366` | Somewhere for the request to go. |
| Import from OpenAPI | `tools-view.tsx:502` | A spec parser and a tool-creation path from it. |

`shell/placeholder.tsx` also reports two, and they are correct as they are: it is
the scaffold page for routes that have not been built, and its buttons point at
design documents rather than at the product.

---

## 4. Running the scan again

```python
# A <Button> is live if it carries a handler itself, OR a Radix-style parent
# passes one down via `asChild` (Dialog.Close, Popover.Trigger, ...).
SELF_ACTIVE = re.compile(
    r'\bonClick\b|\bhref\b|\basChild\b|type\s*=\s*["\']submit["\']'
    r'|\bonSubmit\b|\bdisabled\b|\bonPress\b|\bonChange\b')
PARENT_SLOT = re.compile(r'<[A-Z][\w.]*\s[^<>]*\basChild\b[^<>]*>\s*$', re.S)
```

The first pass omitted `PARENT_SLOT` and reported twenty-six, most of them every
dialog's Cancel button. The `asChild` slot pattern is the difference between a
list somebody acts on and a list somebody learns to ignore.

Attribute scanning has to respect braces and quotes — `className={cn(...)}`
contains `>` characters, and a naive search for the closing bracket of the open
tag stops inside one.
