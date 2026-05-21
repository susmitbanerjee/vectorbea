import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

import {
  isEventAlreadyProcessed,
  syncSubscription,
  type BillingProvider,
  type SubscriptionSyncPayload,
  type SubscriptionStatus,
} from "@/lib/server/billing-sync";
import type { PlanTier } from "@/lib/api";
import { normalizePlanTier } from "@/lib/server/plan-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Env helpers ───────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name] ?? undefined;
}

function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function resolvePlanTier({
  productId,
  variantId,
  fallback = "plus",
}: {
  productId?: number | null;
  variantId?: number | null;
  fallback?: PlanTier;
}): PlanTier {
  const enterpriseVariant = toNumber(optionalEnv("LEMON_SQUEEZY_ENTERPRISE_VARIANT_ID"));
  const proVariant = toNumber(optionalEnv("LEMON_SQUEEZY_PRO_VARIANT_ID"));
  const teamVariant = toNumber(optionalEnv("LEMON_SQUEEZY_VARIANT_ID"));
  const enterpriseProduct = toNumber(optionalEnv("LEMON_SQUEEZY_ENTERPRISE_PRODUCT_ID"));
  const proProduct = toNumber(optionalEnv("LEMON_SQUEEZY_PRO_PRODUCT_ID"));
  const teamProduct = toNumber(optionalEnv("LEMON_SQUEEZY_PRODUCT_ID"));

  if ((enterpriseVariant && variantId === enterpriseVariant) || (enterpriseProduct && productId === enterpriseProduct)) {
    return "enterprise";
  }
  if ((proVariant && variantId === proVariant) || (proProduct && productId === proProduct)) {
    return "pro";
  }
  if ((teamVariant && variantId === teamVariant) || (teamProduct && productId === teamProduct)) {
    return "plus";
  }
  return normalizePlanTier(fallback);
}

// ── HMAC verification (Lemon Squeezy) ────────────────────────────────────────

function verifyLsSignature(rawBody: string, signature: string, secret: string): boolean {
  const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
  // Both buffers must be the same length for timingSafeEqual
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(signature.length === digest.length ? signature : digest, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Lemon Squeezy normalisation ───────────────────────────────────────────────

type LsPayload = {
  meta?: {
    event_name?: string;
    custom_data?: Record<string, unknown>;
  };
  data?: {
    id?: string | number;
    attributes?: Record<string, unknown>;
  };
};

/**
 * Lemon Squeezy uses numeric subscription IDs.  We prefix with "ls:" to keep
 * the subscription_id namespace distinct from Stripe's "sub_" prefix.
 */
function lsSubscriptionId(id: unknown): string {
  return `ls:${String(id)}`;
}

/**
 * Maps a Lemon Squeezy subscription status string to our normalised
 * SubscriptionStatus union.  Unmapped values default to "canceled".
 */
function normaliseLsStatus(raw: unknown): SubscriptionStatus {
  switch (String(raw).toLowerCase()) {
    case "active":     return "active";
    case "on_trial":   return "trialing";
    case "past_due":   return "past_due";
    case "unpaid":     return "unpaid";
    case "cancelled":
    case "canceled":   return "canceled";
    case "paused":     return "paused";
    case "expired":    return "expired";
    default:           return "canceled";
  }
}

function getString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function getNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function extractLsSeatQuantity(attrs: Record<string, unknown>): number {
  const item = attrs.first_subscription_item;
  const fromItem =
    item && typeof item === "object" && !Array.isArray(item)
      ? getNumber((item as Record<string, unknown>).quantity)
      : null;
  return Math.max(fromItem ?? getNumber(attrs.quantity) ?? 1, 1);
}

function extractLsWorkspaceId(payload: LsPayload): string | null {
  const cd = payload.meta?.custom_data ?? {};
  return (
    getString(cd.workspaceId) ??
    getString(cd.workspace_id) ??
    getString(payload.data?.attributes?.workspaceId) ??
    getString(payload.data?.attributes?.workspace_id)
  );
}

function extractLsPlanTier(payload: LsPayload): PlanTier {
  const attrs = payload.data?.attributes ?? {};
  const variantId = getNumber(attrs.variant_id);
  const productId = getNumber(attrs.product_id);
  return resolvePlanTier({ variantId, productId, fallback: "plus" });
}

// ── Stripe helpers ────────────────────────────────────────────────────────────

function stripeStatus(sub: Stripe.Subscription): SubscriptionStatus {
  switch (sub.status) {
    case "active":    return "active";
    case "trialing":  return "trialing";
    case "past_due":  return "past_due";
    case "unpaid":    return "unpaid";
    case "canceled":  return "canceled";
    case "paused":    return "paused";
    default:          return "canceled";
  }
}

function stripeSeatQuantity(sub: Stripe.Subscription): number {
  const total = sub.items.data.reduce((acc, item) => acc + (item.quantity ?? 0), 0);
  return Math.max(total, 1);
}

function stripeCustomerId(sub: Stripe.Subscription): string | null {
  return typeof sub.customer === "string" ? sub.customer : (sub.customer?.id ?? null);
}

/**
 * Stripe v18 moved `current_period_end` from the Subscription root to each
 * SubscriptionItem.  We take the maximum across all items so the grace period
 * reflects the latest-ending item (relevant for multi-price subscriptions).
 * Returns null when no items carry a period end (e.g. free-trial-only subs).
 */
function stripeCurrentPeriodEnd(sub: Stripe.Subscription): Date | null {
  const timestamps = sub.items.data
    .map((item) => item.current_period_end)
    .filter((ts): ts is number => typeof ts === "number" && ts > 0);
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps) * 1000);
}

// ── Provider detection ────────────────────────────────────────────────────────

function detectProvider(req: NextRequest): BillingProvider | null {
  if (req.headers.has("stripe-signature"))  return "stripe";
  if (req.headers.has("x-signature"))       return "lemonsqueezy";
  return null;
}

// ── Stripe webhook handler ────────────────────────────────────────────────────

async function handleStripe(
  rawBody: string,
  signature: string,
): Promise<NextResponse> {
  const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"));

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      requireEnv("STRIPE_WEBHOOK_SECRET"),
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Stripe signature verification failed: ${(err as Error).message}` },
      { status: 401 },
    );
  }

  const eventKey = `stripe:${event.id}`;

  // ── Idempotency pre-check ────────────────────────────────────────────────
  if (await isEventAlreadyProcessed(eventKey)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // ── Event normalisation ──────────────────────────────────────────────────
  let payload: SubscriptionSyncPayload | null = null;

  // subscription.created / subscription.updated
  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated"
  ) {
    const sub = event.data.object as Stripe.Subscription;
    payload = {
      provider:         "stripe",
      eventKey,
      eventName:        event.type,
      subscriptionId:   sub.id,
      status:           stripeStatus(sub),
      workspaceId:      (sub.metadata?.workspaceId ?? sub.metadata?.workspace_id) || null,
      seatQuantity:     stripeSeatQuantity(sub),
      currentPeriodEnd: stripeCurrentPeriodEnd(sub),
      stripeCustomerId: stripeCustomerId(sub),
      targetPlanTier: resolvePlanTier({ fallback: "plus" }),
    };
  }

  // subscription.deleted (immediate cancellation)
  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    payload = {
      provider:         "stripe",
      eventKey,
      eventName:        event.type,
      subscriptionId:   sub.id,
      status:           "canceled",
      workspaceId:      (sub.metadata?.workspaceId ?? sub.metadata?.workspace_id) || null,
      seatQuantity:     1,
      currentPeriodEnd: stripeCurrentPeriodEnd(sub),
      stripeCustomerId: stripeCustomerId(sub),
      targetPlanTier: resolvePlanTier({ fallback: "plus" }),
    };
  }

  // invoice.payment_failed → past_due
  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    // Stripe v18: subscription moved from invoice.subscription to
    // invoice.parent.subscription_details.subscription
    const subRef = invoice.parent?.type === "subscription_details"
      ? invoice.parent.subscription_details?.subscription
      : undefined;
    const subId =
      typeof subRef === "string" ? subRef : (subRef?.id ?? null);
    const custId =
      typeof invoice.customer === "string"
        ? invoice.customer
        : (invoice.customer?.id ?? null);

    if (subId) {
      payload = {
        provider:         "stripe",
        eventKey,
        eventName:        event.type,
        subscriptionId:   subId,
        status:           "past_due",
        workspaceId:      null,
        seatQuantity:     1,
        currentPeriodEnd: null,
        stripeCustomerId: custId,
        targetPlanTier: resolvePlanTier({ fallback: "plus" }),
      };
    }
  }

  if (!payload) {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  // ── Sync to DB ───────────────────────────────────────────────────────────
  const result = await syncSubscription(payload);

  if (!result.ok) {
    console.error("[webhook/billing] Stripe sync failed:", result.reason);
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  return NextResponse.json({ received: true, ...result });
}

// ── Lemon Squeezy webhook handler ─────────────────────────────────────────────

async function handleLemonSqueezy(
  rawBody: string,
  signature: string,
): Promise<NextResponse> {
  const webhookSecret = requireEnv("LEMON_SQUEEZY_WEBHOOK_SECRET");

  if (!verifyLsSignature(rawBody, signature, webhookSecret)) {
    return NextResponse.json(
      { error: "Lemon Squeezy signature verification failed." },
      { status: 401 },
    );
  }

  const lsPayload = JSON.parse(rawBody) as LsPayload;
  const eventName = lsPayload.meta?.event_name ?? "unknown";
  const attrs = lsPayload.data?.attributes ?? {};

  // Only handle subscription lifecycle events
  const handled = new Set([
    "subscription_created",
    "subscription_updated",
    "subscription_cancelled",   // LS spelling
    "subscription_resumed",
    "subscription_expired",
    "subscription_paused",
    "subscription_payment_failed",
    "subscription_payment_success",
  ]);

  if (!handled.has(eventName)) {
    return NextResponse.json({ received: true, ignored: eventName });
  }

  // Derive a stable idempotency key from the subscription ID + event name
  const rawSubId = lsPayload.data?.id ?? getString(attrs.id);
  if (!rawSubId) {
    return NextResponse.json(
      { error: "Missing subscription id in Lemon Squeezy payload." },
      { status: 400 },
    );
  }
  const subscriptionId = lsSubscriptionId(rawSubId);
  const eventKey       = `ls:${String(rawSubId)}:${eventName}`;

  // ── Idempotency pre-check ────────────────────────────────────────────────
  if (await isEventAlreadyProcessed(eventKey)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // ── Derive status ────────────────────────────────────────────────────────
  let status: SubscriptionStatus;
  if (
    eventName === "subscription_created" ||
    eventName === "subscription_updated" ||
    eventName === "subscription_resumed"
  ) {
    status = normaliseLsStatus(attrs.status);
  } else if (eventName === "subscription_payment_success") {
    status = "active";
  } else if (eventName === "subscription_payment_failed") {
    status = "past_due";
  } else if (eventName === "subscription_paused") {
    status = "paused";
  } else if (eventName === "subscription_expired") {
    status = "expired";
  } else {
    // subscription_cancelled
    status = "canceled";
  }

  const currentPeriodEndRaw = getString(attrs.renews_at) ?? getString(attrs.ends_at);
  const currentPeriodEnd = currentPeriodEndRaw ? new Date(currentPeriodEndRaw) : null;

  const payload: SubscriptionSyncPayload = {
    provider:         "lemonsqueezy",
    eventKey,
    eventName,
    subscriptionId,
    status,
    workspaceId:      extractLsWorkspaceId(lsPayload),
    seatQuantity:     extractLsSeatQuantity(attrs),
    targetPlanTier:   extractLsPlanTier(lsPayload),
    currentPeriodEnd: currentPeriodEnd && !isNaN(currentPeriodEnd.getTime())
      ? currentPeriodEnd
      : null,
  };

  // ── Sync to DB ───────────────────────────────────────────────────────────
  const result = await syncSubscription(payload);

  if (!result.ok) {
    console.error("[webhook/billing] Lemon Squeezy sync failed:", result.reason);
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  return NextResponse.json({ received: true, ...result });
}

// ── Route entry point ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Read the raw body once — both providers need it for signature verification
  const rawBody = await request.text();

  const provider = detectProvider(request);

  if (provider === "stripe") {
    const signature = request.headers.get("stripe-signature")!;
    return handleStripe(rawBody, signature);
  }

  if (provider === "lemonsqueezy") {
    const signature = request.headers.get("x-signature")!;
    return handleLemonSqueezy(rawBody, signature);
  }

  // Unknown provider — return 400 so the sender knows the request was rejected
  return NextResponse.json(
    { error: "Unknown billing provider. Expected 'stripe-signature' or 'x-signature' header." },
    { status: 400 },
  );
}
