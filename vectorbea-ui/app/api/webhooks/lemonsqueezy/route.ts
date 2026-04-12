import { createHmac, timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { getLemonSqueezyConfig } from "@/lib/lemonsqueezy";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

type LemonSqueezyWebhookPayload = {
  meta?: {
    event_name?: string;
    custom_data?: JsonRecord;
  };
  data?: {
    attributes?: JsonRecord;
  };
};

function verifySignature(payload: string, signature: string, secret: string) {
  const digest = createHmac("sha256", secret).update(payload).digest("hex");
  const digestBuffer = Buffer.from(digest);
  const signatureBuffer = Buffer.from(signature);

  if (digestBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return timingSafeEqual(digestBuffer, signatureBuffer);
}

function getNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function getNestedRecord(value: unknown): JsonRecord | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }

  return null;
}

function extractQuantity(attributes: JsonRecord, meta?: JsonRecord): number {
  const firstSubscriptionItem = getNestedRecord(attributes.first_subscription_item);
  const variantQuantities = Array.isArray(attributes.variant_quantities)
    ? attributes.variant_quantities
    : Array.isArray(meta?.variant_quantities)
      ? meta?.variant_quantities
      : null;

  const quantity =
    getNumber(firstSubscriptionItem?.quantity) ??
    getNumber(attributes.quantity) ??
    getNumber(meta?.quantity) ??
    getNumber(
      getNestedRecord(variantQuantities?.[0])?.quantity,
    ) ??
    1;

  return Math.max(quantity, 1);
}

function extractWorkspaceId(payload: LemonSqueezyWebhookPayload): string | null {
  return (
    getString(payload.meta?.custom_data?.workspaceId) ??
    getString(payload.meta?.custom_data?.workspace_id) ??
    getString(payload.data?.attributes?.workspaceId) ??
    getString(payload.data?.attributes?.workspace_id) ??
    getString(getNestedRecord(payload.data?.attributes?.custom_data)?.workspaceId) ??
    getString(getNestedRecord(payload.data?.attributes?.custom_data)?.workspace_id)
  );
}

function extractCustomerId(attributes: JsonRecord): string | null {
  return (
    getString(attributes.customer_id) ??
    getString(attributes.customerId) ??
    getString(getNestedRecord(attributes.user)?.id)
  );
}

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get("x-signature");
    if (!signature) {
      return NextResponse.json({ error: "Missing Lemon Squeezy signature." }, { status: 400 });
    }

    const payloadText = await request.text();
    const { webhookSecret } = getLemonSqueezyConfig();

    if (!verifySignature(payloadText, signature, webhookSecret)) {
      return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
    }

    const payload = JSON.parse(payloadText) as LemonSqueezyWebhookPayload;
    const eventName = payload.meta?.event_name;

    if (eventName !== "subscription_created" && eventName !== "subscription_updated") {
      return NextResponse.json({ received: true, ignored: eventName ?? "unknown" });
    }

    const attributes = payload.data?.attributes ?? {};
    const workspaceId = extractWorkspaceId(payload);
    const customerId = extractCustomerId(attributes);
    const quantity = extractQuantity(attributes, payload.meta?.custom_data);

    if (!workspaceId) {
      return NextResponse.json(
        { error: "Missing workspaceId in Lemon Squeezy custom metadata." },
        { status: 400 },
      );
    }

    if (!customerId) {
      return NextResponse.json(
        { error: "Missing customer_id in Lemon Squeezy payload." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("organizations")
      .update({
        max_seats: quantity,
        plan_tier: "enterprise",
        billing_customer_id: customerId,
      })
      .eq("id", workspaceId);

    if (error) {
      throw new Error(`Failed to update organization billing state: ${error.message}`);
    }

    return NextResponse.json({
      received: true,
      event: eventName,
      workspaceId,
      customerId,
      quantity,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to process Lemon Squeezy webhook.",
      },
      { status: 400 },
    );
  }
}
