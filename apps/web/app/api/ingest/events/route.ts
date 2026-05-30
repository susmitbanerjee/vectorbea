/**
 * POST /api/ingest/events
 *
 * SDK event ingestion endpoint.
 * Accepts a batch of Vectorbea RunEvents from external agent code instrumented
 * with the Vectorbea SDK.
 *
 * Production: authenticate with API key, persist to event store, fan-out to
 * subscribers (WebSocket / SSE for live run updates).
 *
 * Current state: placeholder — validates shape, returns accepted IDs.
 */

import { NextRequest, NextResponse } from "next/server";

interface IngestEvent {
  runId: string;
  type: string;
  status?: string;
  timestamp?: string;
  agentName?: string;
  agentId?: string;
  toolName?: string;
  toolId?: string;
  modelName?: string;
  tokens?: number;
  cost?: number;
  durationMs?: number;
  stepId?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  metadata?: unknown;
}

interface IngestBody {
  workflowId?: string;
  workflowVersion?: string;
  events: IngestEvent[];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Auth: expect Bearer token matching VECTORBEE_INGEST_SECRET
  const authHeader = req.headers.get("authorization") ?? "";
  const ingestSecret = process.env.VECTORBEE_INGEST_SECRET;
  if (ingestSecret && authHeader !== `Bearer ${ingestSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { events = [] } = body;

  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: "events array is required and must be non-empty" }, { status: 422 });
  }

  // Validate required fields
  const invalid = events.filter((e) => !e.runId || !e.type);
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: "Each event must have runId and type", invalidCount: invalid.length },
      { status: 422 },
    );
  }

  // TODO: persist events to the event store
  // For now: return accepted IDs (generated server-side)
  const accepted = events.map((_, i) => `evt-ingest-${Date.now()}-${i}`);

  return NextResponse.json(
    {
      accepted: accepted.length,
      ids: accepted,
      message: "Events received. Persistence is a placeholder — connect to the event store to enable.",
    },
    { status: 202 },
  );
}

// GET: describe the endpoint
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    endpoint: "POST /api/ingest/events",
    description: "Accepts a batch of Vectorbea run events from SDK-instrumented agent code.",
    auth: "Bearer token via Authorization header (VECTORBEE_INGEST_SECRET env var).",
    body: {
      workflowId: "string (optional)",
      workflowVersion: "string (optional)",
      events: [
        {
          runId: "string (required)",
          type: "RunEventType (required)",
          status: "'ok' | 'error' | 'pending'",
          timestamp: "ISO 8601 string",
          agentName: "string",
          modelName: "string",
          toolName: "string",
          tokens: "number",
          cost: "number",
          durationMs: "number",
          stepId: "string",
          input: "any",
          output: "any",
          error: "string",
          metadata: "any",
        },
      ],
    },
    sdkInstall: {
      npm: "npm install @vectorbee/sdk",
      pip: "pip install vectorbee-sdk",
    },
  });
}
