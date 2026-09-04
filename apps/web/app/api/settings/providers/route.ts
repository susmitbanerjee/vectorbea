import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { appQuery } from "@/lib/server/app-db";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

/* ══════════════════════════════════════════════════════════════════════════════
   GET /api/settings/providers

   THE MODEL PROVIDERS THIS WORKSPACE ACTUALLY CALLS.

   This read a Supabase table called `provider_configs` — a second credential
   store, with its own encrypted keys, in a project no deployment provisions. It
   was never written by anything: providers are registered as CONNECTIONS, with
   the secret in `encrypted_secrets` and the lifecycle owned by the Kotlin API's
   `ConnectionRoutes`. Two credential stores for one concept is how a key gets
   rotated in one place and kept live in the other.

   READ-ONLY, ON PURPOSE. Settings used to offer an enable/disable switch here.
   Nothing enforced it: the worker resolves a model call through `connections`,
   and a flag the runtime never reads is a kill switch that does not kill
   anything — the worst possible thing to hand somebody during an incident. The
   controls that do work live on Connections, and this panel links to them.
══════════════════════════════════════════════════════════════════════════════ */

export interface ProviderSummary {
  id: string;
  providerType: string;
  displayName: string;
  environmentId: string;
  status: string;
  networkStatus: string;
  defaultModel: string | null;
  maskedKey: string | null;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  updatedAt: string;
}

interface ProviderRow {
  id: string;
  provider: string;
  name: string;
  environment_id: string;
  status: string;
  network_status: string;
  default_model: string | null;
  masked_preview: string | null;
  last_tested_at: Date | string | null;
  last_test_status: string | null;
  updated_at: Date | string;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const rows = await appQuery<ProviderRow>(
      // `masked_preview` is the only part of a credential that leaves the
      // database. The ciphertext and the key version are not selected at all,
      // so this handler cannot leak them even by accident.
      `SELECT c.id, c.provider, c.name, c.environment_id, c.status, c.network_status,
              c.config_json->>'defaultModel' AS default_model,
              s.masked_preview,
              c.last_tested_at, c.last_test_status, c.updated_at
         FROM connections c
         LEFT JOIN encrypted_secrets s ON s.id::text = c.secret_ref
        WHERE c.workspace_id = $1::uuid AND c.type = 'llm'
        ORDER BY lower(c.name)`,
      [workspaceId],
    );

    const providers: ProviderSummary[] = rows.map((row) => ({
      id: row.id,
      providerType: row.provider,
      displayName: row.name,
      environmentId: row.environment_id,
      status: row.status,
      networkStatus: row.network_status,
      defaultModel: row.default_model,
      maskedKey: row.masked_preview,
      lastTestedAt: iso(row.last_tested_at),
      lastTestStatus: row.last_test_status,
      updatedAt: iso(row.updated_at)!,
    }));

    return NextResponse.json({ providers });
  } catch (error) {
    const safe = toSafeApiError(error, "Model providers could not be loaded");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
