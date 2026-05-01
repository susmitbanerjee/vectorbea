import "server-only";

import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import type { PlanTier } from "@/lib/api";
import { normalizePlanTier } from "@/lib/server/plan-config";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BillingProvider = "stripe" | "lemonsqueezy";

export type SubscriptionSyncPayload = {
  provider:        BillingProvider;
  eventKey:        string;          // idempotency key: "stripe:evt_xxx" | "ls:uuid"
  eventName:       string;          // raw event name from provider
  subscriptionId:  string;          // provider's subscription identifier
  status:          SubscriptionStatus;
  workspaceId:     string | null;   // from checkout metadata/custom_data
  seatQuantity:    number;          // number of licensed seats
  currentPeriodEnd: Date | null;    // null = indefinite / unknown
  // Only populated for Stripe — used as fallback lookup when workspaceId is absent
  stripeCustomerId?: string | null;
  targetPlanTier?: PlanTier | null;
};

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "paused"
  | "expired";

// ── Idempotency ───────────────────────────────────────────────────────────────

/**
 * Attempts to claim the event_key in the idempotency table.
 * Returns `true` if the event was already processed (caller should 200 early).
 * Returns `false` when the key is new and the caller should proceed.
 *
 * We intentionally do NOT insert the full record here — the full insert happens
 * inside `syncSubscription` after the billing state mutation succeeds. This
 * means a crash between the two steps causes a retry rather than a silent skip.
 */
export async function isEventAlreadyProcessed(eventKey: string): Promise<boolean> {
  const supabase = createVectorBeaAdminClient();
  const { data } = await supabase
    .from("webhook_events")
    .select("event_key")
    .eq("event_key", eventKey)
    .maybeSingle();
  return data !== null;
}

// ── Organization resolver ─────────────────────────────────────────────────────

/**
 * Resolves the vectorbea.organizations row for a billing event.
 *
 * Resolution priority (first match wins):
 *   1. workspaceId → workspace.organization_id  (most reliable — set at checkout)
 *   2. subscriptionId → organization.subscription_id  (re-subscription scenario)
 *   3. stripeCustomerId → organization.stripe_customer_id  (Stripe legacy path)
 *
 * Returns null if no org can be resolved (caller logs and returns 400).
 */
export async function resolveOrganizationId(
  workspaceId:      string | null,
  subscriptionId:   string,
  stripeCustomerId: string | null | undefined,
): Promise<{ organizationId: string; resolvedWorkspaceId: string | null } | null> {
  const supabase = createVectorBeaAdminClient();

  // ── Path 1: workspaceId from checkout metadata ────────────────────────────
  if (workspaceId) {
    const { data: ws } = await supabase
      .from("workspaces")
      .select("id, organization_id")
      .eq("id", workspaceId)
      .maybeSingle();
    if (ws?.organization_id) {
      return { organizationId: ws.organization_id, resolvedWorkspaceId: ws.id };
    }
  }

  // ── Path 2: existing subscription_id on the org ───────────────────────────
  const { data: orgBySub } = await supabase
    .from("organizations")
    .select("id")
    .eq("subscription_id", subscriptionId)
    .maybeSingle();
  if (orgBySub) {
    return { organizationId: orgBySub.id, resolvedWorkspaceId: workspaceId };
  }

  // ── Path 3: Stripe customer ID fallback ───────────────────────────────────
  if (stripeCustomerId) {
    const { data: orgByCustomer } = await supabase
      .from("organizations")
      .select("id")
      .eq("stripe_customer_id", stripeCustomerId)
      .maybeSingle();
    if (orgByCustomer) {
      return { organizationId: orgByCustomer.id, resolvedWorkspaceId: workspaceId };
    }
  }

  return null;
}

// ── Core state machine ────────────────────────────────────────────────────────

/**
 * Applies a billing event to the database transactionally:
 *   1. Resolves the org.
 *   2. Determines whether this is an upgrade or a downgrade/cancellation.
 *   3. Updates vectorbea.organizations with the new billing state.
 *   4. Marks the event as processed in the idempotency table.
 *
 * Returns a structured result for the webhook handler's response body.
 * Throws on unrecoverable DB errors (caller maps to 500).
 */
export async function syncSubscription(payload: SubscriptionSyncPayload): Promise<SyncResult> {
  const supabase = createVectorBeaAdminClient();

  // ── 1. Resolve org ────────────────────────────────────────────────────────
  const resolved = await resolveOrganizationId(
    payload.workspaceId,
    payload.subscriptionId,
    payload.stripeCustomerId,
  );

  if (!resolved) {
    return {
      ok: false,
      reason: `Cannot resolve organization from workspaceId=${payload.workspaceId ?? "null"} / subscriptionId=${payload.subscriptionId}`,
    };
  }

  const { organizationId, resolvedWorkspaceId } = resolved;

  // ── 2. Determine action ───────────────────────────────────────────────────
  const isActive = payload.status === "active" || payload.status === "trialing";
  const resolvedPlanTier: PlanTier = payload.targetPlanTier && payload.targetPlanTier !== "free"
    ? normalizePlanTier(payload.targetPlanTier)
    : "plus";

  const orgUpdate: Record<string, unknown> = {
    subscription_id:     payload.subscriptionId,
    subscription_status: payload.status,
    current_period_end:  payload.currentPeriodEnd?.toISOString() ?? null,
  };

  if (isActive) {
    orgUpdate.plan_tier  = resolvedPlanTier;
    orgUpdate.max_seats  = Math.max(payload.seatQuantity, 1);
    // Preserve stripe_customer_id when provided
    if (payload.stripeCustomerId) {
      orgUpdate.stripe_customer_id = payload.stripeCustomerId;
    }
  } else {
    // Canceled, past_due, expired, unpaid, paused → revoke team access.
    // We intentionally keep subscription_id so future re-activation can
    // match the org without the user needing to re-enter metadata.
    orgUpdate.plan_tier  = "free";
    orgUpdate.max_seats  = 1;
  }

  // ── 3. Write billing state ────────────────────────────────────────────────
  const { error: updateError } = await supabase
    .from("organizations")
    .update(orgUpdate)
    .eq("id", organizationId);

  if (updateError) {
    throw new Error(`Failed to update organization ${organizationId}: ${updateError.message}`);
  }

  // ── 4. Mark event as processed (idempotency) ──────────────────────────────
  // If this insert fails with a unique-key conflict it means a concurrent
  // request already completed the mutation — that's fine; we swallow it.
  const { error: idempotencyError } = await supabase
    .from("webhook_events")
    .insert({
      event_key:       payload.eventKey,
      provider:        payload.provider,
      event_name:      payload.eventName,
      organization_id: organizationId,
      workspace_id:    resolvedWorkspaceId ?? payload.workspaceId ?? null,
    });

  if (idempotencyError && !idempotencyError.message.includes("duplicate")) {
    // Non-conflict insert error — log but don't fail the webhook response.
    console.error("[billing-sync] idempotency insert error:", idempotencyError.message);
  }

  return {
    ok:              true,
    organizationId,
    workspaceId:     resolvedWorkspaceId ?? payload.workspaceId,
    action:          isActive ? "upgraded" : "downgraded",
    planTier:        isActive ? resolvedPlanTier : "free",
    subscriptionId:  payload.subscriptionId,
    status:          payload.status,
  };
}

// ── Return types ──────────────────────────────────────────────────────────────

export type SyncResult =
  | { ok: false; reason: string }
  | {
      ok:             true;
      organizationId: string;
      workspaceId:    string | null;
      action:         "upgraded" | "downgraded";
      planTier:       PlanTier;
      subscriptionId: string;
      status:         SubscriptionStatus;
    };
