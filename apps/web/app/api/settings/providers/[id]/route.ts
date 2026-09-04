import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/* ══════════════════════════════════════════════════════════════════════════════
   PATCH / DELETE /api/settings/providers/:id — retired

   These wrote `provider_configs`, a Supabase table that no deployment
   provisions and that nothing else in the product reads. A model provider is a
   CONNECTION: the credential lives in `encrypted_secrets`, and enabling,
   disabling, testing, rotating and deleting one are owned by the Kotlin API's
   `ConnectionRoutes`, which is also what the worker resolves a model call
   through.

   The handlers are kept, rather than deleted, so a client still calling them
   gets a sentence explaining where the control moved instead of a 404 that
   reads like an outage. 410 rather than 400: the endpoint existed, it is gone,
   and it is not coming back.
══════════════════════════════════════════════════════════════════════════════ */

const RETIRED = {
  error:
    "Model providers are managed as connections. Enable, disable, test or rotate one from " +
    "Connections — the runtime resolves model calls through that record, so it is the only " +
    "place a change takes effect.",
  code: "moved_to_connections",
  where: "/connections",
} as const;

export async function PATCH() {
  return NextResponse.json(RETIRED, { status: 410 });
}

export async function DELETE() {
  return NextResponse.json(RETIRED, { status: 410 });
}
