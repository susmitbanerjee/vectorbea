import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { openRunStream, reconnectDelayMs, type EventSourceLike } from "~/lib/api/run-stream";

/**
 * Run-event stream: resume and de-duplication.
 *
 * The deliverable asked for this to be verified by killing the connection
 * mid-run. Doing that by hand against a live API proves it once, on one
 * timeline; doing it with a controllable fake proves it every commit, and lets
 * the awkward cases — a kill between two events, a duplicate replay, a server
 * with no Redis — be reproduced exactly.
 *
 * The behaviour under test is forced by a real server limitation:
 * `/api/runs/:id/stream` accepts no resume cursor and replays from sequence 0
 * on every connection, capped at the first 500 events. So the client MUST
 * de-duplicate, and MUST backfill over HTTP to cover what the cap and the
 * read-then-subscribe race drop.
 */

/** A controllable EventSource. Tests drive it; nothing is timing-dependent. */
class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  onerror: ((event: unknown) => void) | null = null;
  onopen: ((event: unknown) => void) | null = null;
  private listeners = new Map<string, ((event: MessageEvent) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  close(): void {
    this.closed = true;
  }

  /* ── test controls ─────────────────────────────────────────────────────── */

  open(): void {
    this.onopen?.({});
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }

  /** Kill the connection the way a dropped socket does. */
  kill(): void {
    this.onerror?.({});
  }
}

function runEvent(sequence: number, type = "STEP_COMPLETED") {
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    runId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    workspaceId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
    environmentId: "3f2504e0-4f89-41d3-9a0c-0305e82c3303",
    sequence,
    type,
    status: "ok",
    source: "worker",
    timestamp: new Date(1_700_000_000_000 + sequence * 1000).toISOString(),
    durationMs: 10,
  };
}

/** A fetch stub for the backfill endpoint, recording the afterSequence asked for. */
function backfillStub(byAfterSequence: Record<number, number[]>) {
  const asked: number[] = [];
  const impl = vi.fn(async (url: string | URL) => {
    const parsed = new URL(String(url));
    const after = Number(parsed.searchParams.get("afterSequence") ?? 0);
    asked.push(after);
    const items = (byAfterSequence[after] ?? []).map((s) => runEvent(s));
    return new Response(JSON.stringify({ items, total: items.length, page: 1, pageSize: 500 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { impl: impl as unknown as typeof fetch, asked };
}

const BASE = "https://api.test";

function harness(overrides: Partial<Parameters<typeof openRunStream>[0]> = {}) {
  const events: number[] = [];
  const statuses: string[] = [];
  const completions: string[] = [];
  const { impl } = backfillStub({});

  const stream = openRunStream({
    runId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    baseUrl: BASE,
    getToken: async () => "tok",
    onEvent: (event) => events.push(event.sequence),
    onStatus: (state) => statuses.push(state.status),
    onComplete: (status) => completions.push(status),
    eventSourceFactory: (url) => new FakeEventSource(url),
    fetchImpl: impl,
    ...overrides,
  });

  return { stream, events, statuses, completions };
}

/** The fake is created inside an async tick, so wait for it. */
async function latestSource(): Promise<FakeEventSource> {
  for (let i = 0; i < 50; i += 1) {
    if (FakeEventSource.instances.length > 0) {
      return FakeEventSource.instances[FakeEventSource.instances.length - 1];
    }
    await Promise.resolve();
  }
  throw new Error("no EventSource was created");
}

async function nextSourceAfter(count: number): Promise<FakeEventSource> {
  for (let i = 0; i < 200; i += 1) {
    if (FakeEventSource.instances.length > count) {
      return FakeEventSource.instances[FakeEventSource.instances.length - 1];
    }
    await vi.advanceTimersByTimeAsync(250);
  }
  throw new Error(`expected more than ${count} EventSource instances`);
}

describe("run stream", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers events in order", async () => {
    const { events, stream } = harness();
    const source = await latestSource();
    source.open();
    source.emit("run_event", runEvent(1));
    source.emit("run_event", runEvent(2));

    expect(events).toEqual([1, 2]);
    stream.close();
  });

  /**
   * The headline case. The connection dies mid-run, the server replays from
   * sequence 0 because it has no resume cursor, and the client must not
   * re-deliver what the UI already rendered.
   */
  it("resumes after a mid-run kill and de-duplicates the replay", async () => {
    vi.useFakeTimers();
    const { events, stream } = harness();

    const first = await latestSource();
    first.open();
    first.emit("run_event", runEvent(1));
    first.emit("run_event", runEvent(2));
    first.emit("run_event", runEvent(3));
    expect(events).toEqual([1, 2, 3]);

    // Kill it mid-run.
    first.kill();
    expect(first.closed).toBe(true);

    const second = await nextSourceAfter(1);
    second.open();

    // The server replays from the beginning — 1..3 again — then continues.
    second.emit("run_event", runEvent(1));
    second.emit("run_event", runEvent(2));
    second.emit("run_event", runEvent(3));
    second.emit("run_event", runEvent(4));
    second.emit("run_event", runEvent(5));

    // Each event delivered exactly once, in order, across the disconnect.
    expect(events).toEqual([1, 2, 3, 4, 5]);
    stream.close();
  });

  it("backfills from the last received sequence, closing the 500-cap hole", async () => {
    const { impl, asked } = backfillStub({ 3: [4, 5] });
    const events: number[] = [];

    const stream = openRunStream({
      runId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      baseUrl: BASE,
      getToken: async () => "tok",
      onEvent: (event) => events.push(event.sequence),
      onStatus: () => {},
      onComplete: () => {},
      eventSourceFactory: (url) => new FakeEventSource(url),
      fetchImpl: impl,
    });

    const source = await latestSource();
    // Events arrive BEFORE open fires, mirroring the server's replay-then-live
    // ordering, so the backfill asks for everything past the highest seen.
    source.emit("run_event", runEvent(1));
    source.emit("run_event", runEvent(2));
    source.emit("run_event", runEvent(3));
    source.open();

    await vi.waitFor(() => expect(events).toContain(5));

    expect(asked).toContain(3);
    expect(events).toEqual([1, 2, 3, 4, 5]);
    stream.close();
  });

  it("reports reconnecting, and gives up to polling after the attempt budget", async () => {
    vi.useFakeTimers();
    const { statuses, stream } = harness({ maxSseAttempts: 2 });

    let source = await latestSource();
    source.open();
    source.kill();

    source = await nextSourceAfter(1);
    source.kill();

    source = await nextSourceAfter(2);
    source.kill();

    await vi.advanceTimersByTimeAsync(100);

    expect(statuses).toContain("reconnecting");
    // Degraded, and visibly so — the UI can say "live updates unavailable".
    expect(statuses).toContain("polling");
    stream.close();
  });

  it("goes straight to polling when the server says Redis is unavailable", async () => {
    // Retrying SSE cannot fix a missing Redis, so the retry budget is skipped.
    const { statuses, stream } = harness();
    const source = await latestSource();
    source.open();
    source.emit("stream_unavailable", { message: "Real-time streaming requires Redis" });

    expect(statuses).toContain("polling");
    expect(source.closed).toBe(true);
    stream.close();
  });

  it("closes the transport on a terminal run and stops reconnecting", async () => {
    vi.useFakeTimers();
    const { completions, statuses, stream } = harness();
    const source = await latestSource();
    source.open();
    source.emit("run_complete", { status: "failed", final: true });

    expect(completions).toEqual(["failed"]);
    expect(statuses).toContain("closed");
    expect(source.closed).toBe(true);

    // A terminal run must not spawn another connection.
    const countAtClose = FakeEventSource.instances.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeEventSource.instances).toHaveLength(countAtClose);
    stream.close();
  });

  it("stops delivering after close, and close is idempotent", async () => {
    const { events, stream } = harness();
    const source = await latestSource();
    source.open();
    source.emit("run_event", runEvent(1));

    stream.close();
    stream.close(); // React cleanup can fire twice under StrictMode.

    source.emit("run_event", runEvent(2));
    expect(events).toEqual([1]);
  });

  it("caps and jitters the reconnect delay", () => {
    // Always below the cap, and monotonic in expectation.
    expect(reconnectDelayMs(1, () => 1)).toBe(500);
    expect(reconnectDelayMs(3, () => 1)).toBe(2000);
    expect(reconnectDelayMs(20, () => 1)).toBe(15_000);
    // Jittered, not fixed — this is what prevents a synchronised retry storm.
    expect(reconnectDelayMs(5, () => 0)).toBe(0);
  });
});
