import { NextRequest, NextResponse } from "next/server";

import { runDueRegressionSchedules } from "@/lib/server/regression-schedules";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const configuredSecret = process.env.INTERNAL_API_SECRET;
    const providedSecret = request.headers.get("x-internal-secret");
    if (configuredSecret && providedSecret !== configuredSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await runDueRegressionSchedules("scheduler-endpoint");
    return NextResponse.json(result);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to run due regression schedules");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
