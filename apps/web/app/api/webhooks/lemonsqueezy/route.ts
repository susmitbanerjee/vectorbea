/**
 * Legacy Lemon Squeezy webhook endpoint.
 *
 * All subscription lifecycle logic now lives in the unified billing handler:
 *   POST /api/webhooks/billing
 *
 * This route is kept for backwards compatibility with any existing webhook
 * registrations. Next.js requires runtime/dynamic to be literal exports in
 * the file itself — they cannot be re-exported from another module — so we
 * redeclare them here and delegate the handler body to the unified route.
 */

import type { NextRequest } from "next/server";
import { POST as billingPOST } from "@/app/api/webhooks/billing/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: NextRequest) {
  return billingPOST(request);
}
