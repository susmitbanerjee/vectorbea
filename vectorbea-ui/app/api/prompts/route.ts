import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";

import type { PromptListItem } from "@/lib/api";
import { PROMPTS_TAG, promptTag, workspaceTag } from "@/lib/dal/cache-tags";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import {
  getWorkspacePlanLimits,
  getWorkspacePromptCount,
} from "@/lib/server/workspace-limits";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json([] as PromptListItem[]);
    }

    // ── P0: Tenant isolation gate ──────────────────────────────────────────
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    // ──────────────────────────────────────────────────────────────────────

    const supabase = createVectorBeaAdminClient();

    const { data, error } = await supabase
      .from("prompts")
      .select("id, name, description, created_at, updated_at, prompt_versions(version_tag, is_published, created_at)")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false });

    if (error) throw new Error(error.message);

    const prompts: PromptListItem[] = (data ?? []).map((row) => {
      const versions = Array.isArray(row.prompt_versions) ? row.prompt_versions : [];
      const latest = versions.sort((a: { created_at: string }, b: { created_at: string }) =>
        b.created_at.localeCompare(a.created_at))[0];
      return {
        id: row.id,
        name: row.name,
        description: row.description ?? null,
        latestVersion: latest?.version_tag ?? "v0",
        isPublished: latest?.is_published ?? false,
        updatedAt: row.updated_at ?? row.created_at ?? null,
      };
    });

    return NextResponse.json(prompts);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load prompts" },
      { status: 500 },
    );
  }
}

// Zero-Trust: every incoming prompt creation payload is validated before any DB write.
const CreatePromptSchema = z.object({
  name:        z.string().min(1, "name is required").max(120, "name must be 120 characters or fewer").trim(),
  description: z.string().max(500, "description must be 500 characters or fewer").trim().nullable().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required." },
        { status: 400 },
      );
    }

    // ── P0: Tenant isolation gate ──────────────────────────────────────────
    // Verify the authenticated user is actually a member of this workspace
    // *before* touching plan limits or prompt counts.
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    // ──────────────────────────────────────────────────────────────────────

    // ── Zero-Trust payload validation (Zod) ────────────────────────────────
    const rawBody = await request.json().catch(() => null);
    const parsed = CreatePromptSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { name, description } = parsed.data;

    // ── Plan limit check ────────────────────────────────────────────────────
    const planLimits = await getWorkspacePlanLimits(workspaceId);
    const promptCount = await getWorkspacePromptCount(workspaceId);
    const promptLimit = Math.max(planLimits.maxPrompts ?? 5, 5);

    if (planLimits.planTier === "free" && promptCount >= promptLimit) {
      return NextResponse.json(
        {
          error: `Free plan limit reached (${promptLimit} prompts). Please upgrade to the Team plan.`,
        },
        { status: 429 },
      );
    }

    const supabase = createVectorBeaAdminClient();

    const { data, error: insertError } = await supabase
      .from("prompts")
      .insert({
        workspace_id: workspaceId,
        name,
        description: description?.trim() ? description.trim() : null,
      })
      .select("id, name, description, created_at")
      .single();

    if (insertError) throw new Error(insertError.message);

    revalidateTag(PROMPTS_TAG);
    revalidateTag(workspaceTag(workspaceId));
    revalidateTag(promptTag(data.id));

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create prompt" },
      { status: 500 },
    );
  }
}
