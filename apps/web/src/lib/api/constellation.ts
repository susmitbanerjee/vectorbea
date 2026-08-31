import type { Transport, RequestOptions } from "./transport";
import type {
  Constellation,
} from "~/components/app/debug/constellation-layout";

/* ══════════════════════════════════════════════════════════════════════════════
   The debugger v2 reads: constellation, burn-down, compare.

   On the app transport, like `./trace`, and for the same reason: the transport
   attaches the bearer token and `X-Workspace-Id`, and these endpoints are
   workspace-scoped and fail CLOSED. A hand-rolled `fetch` without the header
   does not return somebody else's data — it returns nothing, and the view
   renders an empty state that looks like a run with no team. That is the most
   confusing possible direction for the failure to point.
   ══════════════════════════════════════════════════════════════════════════ */

export type { Constellation };

export interface BurndownPoint {
  activationId: string | null;
  at: string | null;
  tokens: number;
  costCents: number;
  iterations: number;
  kind: string;
}

export interface Burndown {
  runId: string;
  points: BurndownPoint[];
  ceilings: { maxCostCents: number; maxTokens: number };
}

export interface CompareDelta {
  key: string;
  name: string;
  kind: string;
  deltas: Array<{ field: string; a: unknown; b: unknown }>;
}

export interface CompareSummary {
  key: string;
  name: string;
  kind: string;
  status: string;
  durationMs: number | null;
}

export interface Comparison {
  a: { runId: string; workflowVersionId: string | null; status: string | null };
  b: { runId: string; workflowVersionId: string | null; status: string | null };
  /** False means the two ran different versions — a legitimate comparison whose
   *  answer means something different, so the view has to say which it is. */
  sameVersion: boolean;
  /** The FIRST span present in one and not the other. Everything after it is
   *  downstream of it, which is why the view leads with this one fact. */
  divergenceKey: string | null;
  onlyInA: CompareSummary[];
  onlyInB: CompareSummary[];
  deltas: CompareDelta[];
}

export function createDebugApi(transport: Transport, workspaceId: string | null) {
  const req = (signal?: AbortSignal): RequestOptions => ({ workspaceId, signal });

  return {
    constellation: (runId: string, signal?: AbortSignal) =>
      transport.request<Constellation>(`/api/runs/${runId}/constellation`, req(signal)),

    burndown: (runId: string, signal?: AbortSignal) =>
      transport.request<Burndown>(`/api/runs/${runId}/burndown`, req(signal)),

    compare: (runId: string, otherId: string, signal?: AbortSignal) =>
      transport.request<Comparison>(`/api/runs/${runId}/compare/${otherId}`, req(signal)),
  };
}

export type DebugApi = ReturnType<typeof createDebugApi>;
