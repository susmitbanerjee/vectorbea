import type { contracts } from "@vectorbea/shared";

/**
 * Live run-event stream.
 *
 * WHAT THE SERVER ACTUALLY DOES — verified against
 * `RunRoutes.streamEvents`, not assumed:
 *
 *   1. Replays persisted events from Postgres, `ORDER BY sequence ASC`,
 *      **capped at the first 500**.
 *   2. Sends `run_complete` and closes if the run is already terminal.
 *   3. Subscribes to Redis pub/sub and relays live events.
 *   4. Heartbeat comment every ~20s.
 *   5. Emits `stream_unavailable` when Redis is absent.
 *
 * Three consequences the client has to absorb, because the server does not:
 *
 *   (a) NO RESUME. The endpoint accepts no `Last-Event-ID` and no
 *       `?afterSequence=`. Every reconnect replays from sequence 0. So the
 *       client de-duplicates on `sequence` — see `seen` below. This is the
 *       correctness backstop, not an optimisation.
 *
 *   (b) THE 500 CAP IS A HOLE, NOT A WINDOW. It takes the FIRST 500 ascending,
 *       so a run with 900 events streams 1–500 then jumps to live, and 501–900
 *       never arrive on the stream at all. `backfill` closes that hole using
 *       `GET /api/runs/:id/events?afterSequence=N`, which DOES support
 *       resumption. Without this a long run silently loses its middle.
 *
 *   (c) A RACE between the DB read and the Redis subscribe drops anything
 *       published in that window. The same `backfill` covers it, because it
 *       runs after the stream is established and asks for everything past the
 *       highest sequence actually received.
 *
 * The fix for (a) and (b) is small server-side — `listByRun` already takes
 * `afterSequence`. Until then this client compensates. See API-GAPS.md.
 */

export type RunEvent = contracts.RunEvent;

export type StreamStatus =
  | "connecting"
  | "open"
  /** Connection dropped; a retry is scheduled. `attempt` says which. */
  | "reconnecting"
  /** SSE gave up. Events now arrive by polling, and the UI must say so. */
  | "polling"
  /** Run reached a terminal state. Nothing further will arrive. */
  | "closed"
  /** Unrecoverable — neither SSE nor polling can proceed. */
  | "failed";

export interface RunStreamState {
  status: StreamStatus;
  /** Highest sequence received. The resume point. */
  lastSequence: number;
  attempt: number;
  error: Error | null;
}

export interface RunStreamCallbacks {
  /** Fired for each NEW event, in sequence order. Duplicates never reach this. */
  onEvent(event: RunEvent): void;
  onStatus(state: RunStreamState): void;
  /** Terminal status reported by the server. */
  onComplete(status: string): void;
}

export interface RunStreamOptions extends RunStreamCallbacks {
  runId: string;
  /** Absolute base URL of the API. */
  baseUrl: string;
  /** Bearer token provider. Re-read per connection so a refresh is picked up. */
  getToken(): Promise<string | null>;
  workspaceId?: string | null;
  environmentId?: string | null;
  /** Give up on SSE and fall back to polling after this many failed attempts. */
  maxSseAttempts?: number;
  /** Poll interval once SSE has been abandoned. */
  pollIntervalMs?: number;
  /** Injected for tests. Defaults to the platform EventSource. */
  eventSourceFactory?: (url: string) => EventSourceLike;
  /** Injected for tests. Defaults to `fetch`. */
  fetchImpl?: typeof fetch;
}

/** The slice of EventSource this client uses, so tests can supply a fake. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
  onerror: ((event: unknown) => void) | null;
  onopen: ((event: unknown) => void) | null;
}

const DEFAULT_MAX_SSE_ATTEMPTS = 5;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 15_000;

/**
 * Capped exponential backoff with full jitter.
 *
 * Jittered for the same reason the HTTP transport jitters: an API restart drops
 * every open stream at once, and identical backoff would reconverge them into a
 * synchronised reconnect storm against a service that is still starting.
 */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
  return Math.round(random() * ceiling);
}

export interface RunStream {
  /** Idempotent. Safe to call from a React cleanup that may run twice. */
  close(): void;
  getState(): RunStreamState;
}

export function openRunStream(options: RunStreamOptions): RunStream {
  const {
    runId,
    baseUrl,
    getToken,
    onEvent,
    onStatus,
    onComplete,
    maxSseAttempts = DEFAULT_MAX_SSE_ATTEMPTS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    eventSourceFactory,
    fetchImpl,
  } = options;

  const doFetch = fetchImpl ?? globalThis.fetch;

  /**
   * Sequences already delivered.
   *
   * A Set rather than "is this greater than lastSequence", because the server
   * replays from zero on every reconnect and events are not guaranteed to be
   * contiguous — a gap-then-catch-up would let a naive high-water mark drop
   * everything below it forever.
   */
  const seen = new Set<number>();

  let state: RunStreamState = {
    status: "connecting",
    lastSequence: 0,
    attempt: 0,
    error: null,
  };

  let source: EventSourceLike | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  function setState(patch: Partial<RunStreamState>): void {
    state = { ...state, ...patch };
    if (!disposed) onStatus(state);
  }

  /** Deliver an event if it is genuinely new. Returns true when delivered. */
  function deliver(event: RunEvent): boolean {
    if (seen.has(event.sequence)) return false;
    seen.add(event.sequence);
    if (event.sequence > state.lastSequence) state.lastSequence = event.sequence;
    onEvent(event);
    return true;
  }

  function scopeHeaders(token: string | null): Record<string, string> {
    return {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.workspaceId ? { "X-Workspace-Id": options.workspaceId } : {}),
    };
  }

  /**
   * Fetch everything past `lastSequence` over plain HTTP.
   *
   * Closes both server-side holes: the 500-event replay cap, and the
   * read-then-subscribe race. Runs after the stream opens, and again on every
   * successful reconnect, because both holes reopen each time.
   */
  async function backfill(): Promise<void> {
    if (disposed) return;
    try {
      const token = await getToken();
      const url = new URL(`${baseUrl}/api/runs/${runId}/events`);
      url.searchParams.set("afterSequence", String(state.lastSequence));
      url.searchParams.set("pageSize", "500");

      const response = await doFetch(url.toString(), {
        headers: scopeHeaders(token),
        credentials: "omit",
      });
      if (!response.ok) return;

      const body = (await response.json()) as { items?: RunEvent[] };
      for (const event of body.items ?? []) deliver(event);
    } catch {
      // Backfill is best-effort. A failure here means the stream is still the
      // primary path; it must not tear down a working connection.
    }
  }

  async function connect(): Promise<void> {
    if (disposed) return;

    const token = await getToken();
    if (disposed) return;

    // EventSource cannot set headers, so the token rides on the query string.
    // Acceptable here and nowhere else: it is same-site to our own API over
    // TLS, and the alternative is no live updates at all. Noted in API-GAPS.md
    // as an argument for a short-lived stream ticket instead.
    const url = new URL(`${baseUrl}/api/runs/${runId}/stream`);
    if (token) url.searchParams.set("access_token", token);
    if (options.workspaceId) url.searchParams.set("workspaceId", options.workspaceId);

    const factory =
      eventSourceFactory ??
      ((target: string) => new EventSource(target) as unknown as EventSourceLike);

    let es: EventSourceLike;
    try {
      es = factory(url.toString());
    } catch (cause) {
      handleFailure(cause instanceof Error ? cause : new Error(String(cause)));
      return;
    }
    source = es;

    es.onopen = () => {
      if (disposed) return;
      setState({ status: "open", attempt: 0, error: null });
      // Close the replay-cap and subscribe-race holes now the stream is live.
      void backfill();
    };

    es.addEventListener("run_event", (message) => {
      if (disposed) return;
      try {
        const event = JSON.parse(message.data) as RunEvent;
        deliver(event);
      } catch {
        // A single malformed frame must not kill the stream.
      }
    });

    es.addEventListener("run_complete", (message) => {
      if (disposed) return;
      let status = "completed";
      try {
        status = (JSON.parse(message.data) as { status?: string }).status ?? status;
      } catch {
        /* keep the default */
      }
      // Terminal: stop everything. Nothing further can arrive, and leaving the
      // socket open would hold a server thread for a run that is finished.
      teardownTransport();
      setState({ status: "closed" });
      onComplete(status);
    });

    /**
     * The server says Redis is down and live streaming is impossible.
     * Not a connection error — retrying SSE cannot help, so go straight to
     * polling rather than burning the retry budget first.
     */
    es.addEventListener("stream_unavailable", () => {
      if (disposed) return;
      teardownTransport();
      startPolling();
    });

    es.onerror = () => {
      if (disposed) return;
      handleFailure(new Error("The run event stream disconnected."));
    };
  }

  function handleFailure(error: Error): void {
    teardownTransport();
    if (disposed) return;

    const attempt = state.attempt + 1;

    if (attempt > maxSseAttempts) {
      // SSE has failed repeatedly. Degrade to polling and SAY SO — a silently
      // degraded stream looks identical to a stalled run.
      setState({ attempt, error });
      startPolling();
      return;
    }

    setState({ status: "reconnecting", attempt, error });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, reconnectDelayMs(attempt));
  }

  function startPolling(): void {
    if (disposed || pollTimer) return;
    setState({ status: "polling" });
    void backfill();
    pollTimer = setInterval(() => void backfill(), pollIntervalMs);
  }

  /** Drop the transport but keep `seen`/`lastSequence` — they survive reconnects. */
  function teardownTransport(): void {
    if (source) {
      source.onerror = null;
      source.onopen = null;
      try {
        source.close();
      } catch {
        /* already closed */
      }
      source = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  void connect();

  return {
    close() {
      if (disposed) return;
      disposed = true;
      teardownTransport();
    },
    getState: () => state,
  };
}
