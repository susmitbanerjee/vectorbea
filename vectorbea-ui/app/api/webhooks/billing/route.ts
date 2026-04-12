import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getStripeClient() {
  return new Stripe(requireEnv("STRIPE_SECRET_KEY"));
}

function extractSeatQuantity(subscription: Stripe.Subscription): number {
  const quantities = subscription.items.data
    .map((item) => item.quantity ?? 0)
    .filter((quantity) => quantity > 0);

  if (quantities.length === 0) {
    return 1;
  }

  return quantities.reduce((total, quantity) => total + quantity, 0);
}

function isEnterpriseEvent(type: string): boolean {
  return (
    type === "subscription.created" ||
    type === "subscription.updated" ||
    type === "customer.subscription.created" ||
    type === "customer.subscription.updated"
  );
}

function isDowngradeEvent(type: string): boolean {
  return (
    type === "subscription.deleted" ||
    type === "payment_failed" ||
    type === "customer.subscription.deleted" ||
    type === "invoice.payment_failed"
  );
}

async function upgradeOrganization(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;

  if (!customerId) {
    throw new Error("Missing customer_id on subscription payload");
  }

  const quantity = extractSeatQuantity(subscription);
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase
    .from("organizations")
    .update({
      max_seats: quantity,
      plan_tier: "enterprise",
      stripe_subscription_id: subscription.id,
    })
    .eq("stripe_customer_id", customerId);

  if (error) {
    throw new Error(`Failed to upgrade organization seats: ${error.message}`);
  }

  return { customerId, quantity };
}

async function downgradeOrganizationByCustomerId(customerId: string) {
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase
    .from("organizations")
    .update({
      plan_tier: "free",
      max_seats: 1,
      stripe_subscription_id: null,
    })
    .eq("stripe_customer_id", customerId);

  if (error) {
    throw new Error(`Failed to downgrade organization: ${error.message}`);
  }

  return { customerId };
}

async function downgradeFromEvent(event: Stripe.Event) {
  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId =
      typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;

    if (!customerId) {
      throw new Error("Missing customer_id on failed invoice payload");
    }

    return downgradeOrganizationByCustomerId(customerId);
  }

  const subscription = event.data.object as Stripe.Subscription;
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;

  if (!customerId) {
    throw new Error("Missing customer_id on subscription payload");
  }

  return downgradeOrganizationByCustomerId(customerId);
}

export async function POST(request: NextRequest) {
  try {
    const stripe = getStripeClient();
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });
    }

    const payload = await request.text();
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      requireEnv("STRIPE_WEBHOOK_SECRET"),
    );

    if (isEnterpriseEvent(event.type)) {
      const result = await upgradeOrganization(event.data.object as Stripe.Subscription);
      return NextResponse.json({
        received: true,
        action: "upgraded",
        customerId: result.customerId,
        quantity: result.quantity,
      });
    }

    if (isDowngradeEvent(event.type)) {
      const result = await downgradeFromEvent(event);
      return NextResponse.json({
        received: true,
        action: "downgraded",
        customerId: result.customerId,
      });
    }

    return NextResponse.json({ received: true, ignored: event.type });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to process billing webhook";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
