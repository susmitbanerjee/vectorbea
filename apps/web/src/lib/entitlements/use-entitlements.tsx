"use client";

import * as React from "react";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import type { Entitlement, PlanSummary } from "~/lib/api/client";

/* ══════════════════════════════════════════════════════════════════════════════
   WHAT THIS WORKSPACE MAY DO — read from the API, never from a table here.

   ── ONE SOURCE, TWO READERS ─────────────────────────────────────────────────
   `GET /api/entitlements` resolves the workspace's BILLING ACCOUNT and returns
   the entitlements themselves, with each one's source. Both the API's guards and
   this hook read that same answer, which is what makes a disabled control in the
   UI agree with the refusal the API would have given.

   The alternative — a `PLAN_FEATURES` map in the web app — is wrong in a
   specific and expensive direction. Plans are DATA: an operator can raise
   `max_team_size` for one account with an override row, and no deploy follows.
   A local table would keep saying eight, and it would say it by disabling a
   control the customer has already paid to use.

   ── THE GOVERNING RULE ──────────────────────────────────────────────────────
   The subject is the WORKSPACE, not the reader. A Pro member acting inside a
   Free workspace sees Free here, because that is what every enforcement point
   will tell them. Nothing in this file takes a user.

   ── UNKNOWN IS PERMISSIVE, AND THAT IS DELIBERATE ───────────────────────────
   When the request has not resolved, fails, or 404s against an API that predates
   the endpoint, `has()` returns true and every limit returns null. Gating on an
   unknown answer would take the product away from people whose plan allows it,
   for a reason the screen cannot even name — and it would do so on exactly the
   deploys where the two services are skewed, which is a normal state here
   because the API and the web app ship independently.

   This is safe because NOTHING HERE IS ENFORCEMENT. `EntitlementGuard` in the
   API and `GraphPlanCheck` at the save boundary are. A permissive UI shows a
   control that the save then refuses with the real reason; a restrictive UI on a
   failed fetch hides a feature that was never restricted. Only one of those is
   recoverable by the person looking at the screen.
══════════════════════════════════════════════════════════════════════════════ */

/** Keys the canvas reads. Mirrors `EntitlementKeys` in the API. */
export const ENTITLEMENT = {
  TEAMS: "teams",
  DELEGATION: "delegation",
  MCP_TOOLS: "mcp_tools",
  REPLAY: "replay",
  OTEL_EXPORT: "otel_export",
  API_ACCESS: "api_access",
  MAX_TEAM_SIZE: "max_team_size",
  MAX_DELEGATION_DEPTH: "max_delegation_depth",
  MAX_AGENTS: "max_agents",
  MAX_ACTIVATIONS_PER_WORKSPACE: "max_activations_per_workspace",
  MAX_CONCURRENT_RUNS: "max_concurrent_runs",
} as const;

export interface Entitlements {
  /** False only while the first request is in flight. */
  loading: boolean;
  /**
   * True when the answer is not known — pending, failed, or an API without the
   * endpoint. Every accessor is permissive in this state; a caller that wants to
   * say "we could not check" rather than silently allowing reads this.
   */
  unknown: boolean;
  planCode: string | null;
  planName: string | null;
  /** The plan this one upgrades to, from the catalogue. Null on the top plan. */
  upgradeTo: PlanSummary | null;
  /** Where to send somebody who wants the upgrade. */
  upgradeUrl: string | null;
  /** Is this FEATURE on? Permissive when unknown. */
  has: (key: string) => boolean;
  /** A LIMIT's ceiling, or null when unknown or unlimited. */
  limit: (key: string) => number | null;
  /** Human wording for a key, from the API's own label. */
  label: (key: string) => string;
  /** The plan that would grant [key], for the upgrade sentence. Null if none does. */
  planGranting: (key: string) => PlanSummary | null;
  raw: Entitlement[];
  plans: PlanSummary[];
}

const EMPTY: Entitlements = {
  loading: false,
  unknown: true,
  planCode: null,
  planName: null,
  upgradeTo: null,
  upgradeUrl: null,
  has: () => true,
  limit: () => null,
  label: (key) => key.replace(/_/g, " "),
  planGranting: () => null,
  raw: [],
  plans: [],
};

const EntitlementContext = React.createContext<Entitlements>(EMPTY);

/**
 * One pair of queries for a whole screen.
 *
 * A provider rather than a hook per consumer for the same reason the builder's
 * registry is one: the canvas gates the palette, the inspector gates half a
 * dozen fields, and validation reads two limits. Separate subscriptions would
 * each re-render on their own cache event, and on the canvas that means every
 * node object being rebuilt mid-drag.
 */
export function EntitlementProvider({ children }: { children: React.ReactNode }) {
  const api = useApi();
  const { workspaceId } = useScope();
  const enabled = Boolean(workspaceId);

  const entitlements = useApiQuery({
    queryKey: queryKeys.entitlements.all(workspaceId),
    queryFn: () => api.entitlements.get({ workspaceId, environmentId: null }),
    enabled,
    // Plans change on a billing event, not on a page view. A minute of
    // staleness here is invisible and takes the request off every navigation.
    staleTime: 60_000,
    retry: false,
  });

  const plans = useApiQuery({
    queryKey: queryKeys.entitlements.plans(),
    queryFn: () => api.entitlements.plans(),
    staleTime: 300_000,
    retry: false,
  });

  const value = React.useMemo<Entitlements>(() => {
    const rows = entitlements.data?.entitlements ?? [];
    const catalogue = [...(plans.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    const resolved = rows.length > 0;
    const byKey = new Map(rows.map((e) => [e.key, e]));

    const plan = entitlements.data?.plan ?? null;
    const planCode = plan?.code ?? null;

    /* The catalogue row for the plan we are ON, used only for the sort order —
       everything else about the current plan comes from the resolved response,
       which is the answer the API's own guards will give. */
    const currentRow = catalogue.find((p) => p.code === planCode) ?? null;
    const upgradeTo =
      (plan?.upgradeTo ? catalogue.find((p) => p.code === plan.upgradeTo) : null)
      // No `upgrade_to_code` on the row: fall back to the next plan in sort
      // order. A missing pointer in the plan table is a data gap, not a reason
      // to show somebody a dead end.
      ?? (currentRow ? catalogue.find((p) => p.sortOrder > currentRow.sortOrder) ?? null : null);

    /** The cheapest catalogue plan that grants [key], other than this one. */
    const planGranting = (key: string): PlanSummary | null => {
      for (const candidate of catalogue) {
        if (candidate.code === planCode) continue;
        const row = candidate.entitlements.find((e) => e.key === key);
        if (!row) continue;
        const grants = row.kind === "feature"
          ? row.value === true
          // -1 is the catalogue's unlimited; any positive ceiling grants it too.
          : typeof row.value === "number" && row.value !== 0;
        if (grants) return candidate;
      }
      return null;
    };

    /* Labels come off the catalogue, which is the only surface that carries
       them (`EntitlementKeys.label` is applied in the `/api/plans` query and not
       in `Entitlement.toMap`). Falling back to the key with its underscores
       stripped keeps a gate readable even when the catalogue has not loaded. */
    const labels = new Map<string, string>();
    for (const candidate of catalogue) {
      for (const row of candidate.entitlements) {
        if (row.label) labels.set(row.key, row.label);
      }
    }

    return {
      loading: enabled && entitlements.isPending,
      unknown: !resolved,
      planCode,
      planName: plan?.name ?? null,
      upgradeTo,
      upgradeUrl: plan?.upgradeUrl || upgradeTo?.upgradeUrl || null,
      has: (key) => {
        if (!resolved) return true;
        const row = byKey.get(key);
        // A key absent from the resolved set is NOT granted. That is the API's
        // rule too — `Effective.feature` reads `boolValue == true` and a missing
        // key is therefore off — and it is why `EntitlementKeys.ALL` is asserted
        // against every plan's seed rows: absence must mean "off", so absence
        // caused by a forgotten seed row has to be caught in a test rather than
        // discovered as a tenant with a free upgrade.
        if (!row) return false;
        if (row.kind === "feature") return row.value === true;
        if (row.unlimited) return true;
        return typeof row.value === "number" && row.value > 0;
      },
      limit: (key) => {
        if (!resolved) return null;
        const row = byKey.get(key);
        if (!row) return null;
        // Unlimited and "no opinion" both mean "do not draw a ceiling", but a
        // value of ZERO is a real ceiling of zero and must survive: a plan that
        // grants no teams says so with a zero, and reading that as unlimited is
        // the free upgrade this distinction exists to prevent.
        if (row.unlimited) return null;
        return typeof row.value === "number" ? row.value : null;
      },
      label: (key) => labels.get(key) ?? key.replace(/_/g, " "),
      planGranting,
      raw: rows,
      plans: catalogue,
    };
  }, [entitlements.data, entitlements.isPending, plans.data, enabled]);

  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

export function useEntitlements(): Entitlements {
  return React.useContext(EntitlementContext);
}

/**
 * The sentence a disabled control shows.
 *
 * Written here rather than at each call site so every gate in the product says
 * the same thing in the same order: what is unavailable, on which plan, and what
 * to do. "Upgrade to unlock" on its own tells somebody neither what they are on
 * nor what they would get.
 */
export function upgradeReason(ent: Entitlements, key: string): string {
  const what = ent.label(key);
  const plan = ent.planGranting(key) ?? ent.upgradeTo;
  const on = ent.planName ? `The ${ent.planName} plan` : "This workspace's plan";
  if (!plan) return `${on} does not include ${what}.`;
  return `${on} does not include ${what}. ${plan.name} does.`;
}
