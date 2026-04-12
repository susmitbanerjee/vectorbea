import { NextRequest, NextResponse } from "next/server";

import { getLemonSqueezyClient } from "@/lib/lemonsqueezy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutRequest = {
  quantity?: number;
  workspaceId?: string;
};

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as CheckoutRequest;
    const quantity = Number(payload.quantity);
    const workspaceId = payload.workspaceId?.trim();

    if (!Number.isFinite(quantity) || quantity < 1) {
      return NextResponse.json(
        { error: "A valid seat quantity is required." },
        { status: 400 },
      );
    }

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required." },
        { status: 400 },
      );
    }

    const { createCheckout, storeId, variantId } = getLemonSqueezyClient();
    const response = await createCheckout(storeId, variantId, {
      checkoutData: {
        custom: {
          workspaceId,
        },
        variantQuantities: [
          {
            variantId,
            quantity,
          },
        ],
      },
      productOptions: {
        redirectUrl: `${request.nextUrl.origin}/settings/billing?checkout=success`,
      },
    });

    if (response.error || !response.data) {
      throw response.error ?? new Error("Failed to create Lemon Squeezy checkout.");
    }

    return NextResponse.json({
      url: response.data.data.attributes.url,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create Lemon Squeezy checkout.",
      },
      { status: 500 },
    );
  }
}
