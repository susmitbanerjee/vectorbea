import "server-only";

import type { PromptRolloutDistribution, PromptVersionRollout, RolloutStatus } from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { createHash } from "crypto";

type VersionRow = {
  id: string;
  version_tag: string;
  is_published: boolean;
  rollout_status: string;
  rollout_percentage: number;
};

/**
 * Deterministic traffic split: hash(seedKey + promptId) mod 100.
 * Returns the prompt version ID to serve, or null if no version matches.
 *
 * Algorithm:
 * 1. Sort candidate versions by version_tag ascending (stable order).
 * 2. Assign cumulative bucket ranges.
 * 3. Hash the seed key to get a 0-99 bucket number.
 * 4. Return the version whose range covers the bucket.
 * 5. If no candidate bucket matches, fall through to the active version.
 */
export function selectVersionByTrafficSplit(
  versions: PromptVersionRollout[],
  seedKey: string,
): string | null {
  const candidates = versions
    .filter((v) => v.rolloutStatus === "candidate" && v.rolloutPercentage > 0)
    .sort((a, b) => a.versionTag.localeCompare(b.versionTag));

  const active = versions.find((v) => v.rolloutStatus === "active");

  if (candidates.length === 0) {
    return active?.promptVersionId ?? null;
  }

  // Deterministic bucket 0-99
  const hash = createHash("sha256").update(seedKey).digest("hex");
  const bucket = parseInt(hash.slice(0, 8), 16) % 100;

  let cursor = 0;
  for (const candidate of candidates) {
    const start = cursor;
    const end = cursor + candidate.rolloutPercentage;
    if (bucket >= start && bucket < end) {
      return candidate.promptVersionId;
    }
    cursor = end;
  }

  // Bucket falls outside candidate ranges → use active version
  return active?.promptVersionId ?? null;
}

export async function getPromptRolloutDistribution(
  workspaceId: string,
  promptId: string,
): Promise<PromptRolloutDistribution> {
  const supabase = createVectorBeaAdminClient();

  const { data: promptData, error: promptError } = await supabase
    .from("prompts")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("id", promptId)
    .single();
  if (promptError) throw new Error(promptError.message);

  const { data, error } = await supabase
    .from("prompt_versions")
    .select("id, version_tag, is_published")
    .eq("prompt_id", promptId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  // Fetch rollout columns separately — they are ALTER TABLE additions that may
  // not exist on all schema versions. Missing columns return a Supabase error
  // which we catch and fall back to defaults rather than crashing the page.
  const rolloutById = new Map<string, { rollout_status: string; rollout_percentage: number }>();
  try {
    const { data: rolloutData } = await supabase
      .from("prompt_versions")
      .select("id, rollout_status, rollout_percentage")
      .eq("prompt_id", promptId);
    for (const row of rolloutData ?? []) {
      rolloutById.set(row.id, {
        rollout_status: row.rollout_status ?? "draft",
        rollout_percentage: row.rollout_percentage ?? 0,
      });
    }
  } catch {
    // Columns not yet migrated — all versions default to draft/0%.
  }

  const versions: PromptVersionRollout[] = (data ?? []).map((row) => ({
    promptVersionId: row.id,
    versionTag: row.version_tag,
    rolloutStatus: ((rolloutById.get(row.id)?.rollout_status) ?? "draft") as RolloutStatus,
    rolloutPercentage: rolloutById.get(row.id)?.rollout_percentage ?? 0,
    isPublished: row.is_published,
  }));

  const totalCandidatePercentage = versions
    .filter((v) => v.rolloutStatus === "candidate")
    .reduce((sum, v) => sum + v.rolloutPercentage, 0);

  const activeVersion = versions.find((v) => v.rolloutStatus === "active");

  return {
    promptId,
    promptName: promptData.name,
    versions,
    totalCandidatePercentage,
    activeVersionId: activeVersion?.promptVersionId ?? null,
  };
}

export async function updateVersionRollout(args: {
  workspaceId: string;
  promptId: string;
  promptVersionId: string;
  rolloutStatus: RolloutStatus;
  rolloutPercentage: number;
}): Promise<PromptVersionRollout> {
  if (args.rolloutPercentage < 0 || args.rolloutPercentage > 100) {
    throw new Error("rolloutPercentage must be between 0 and 100.");
  }

  const supabase = createVectorBeaAdminClient();

  // If setting to active, check that existing candidates + new percentage ≤ 100
  if (args.rolloutStatus === "candidate") {
    const { data: existing } = await supabase
      .from("prompt_versions")
      .select("id, rollout_status, rollout_percentage")
      .eq("prompt_id", args.promptId)
      .neq("id", args.promptVersionId);

    const otherCandidateTotal = ((existing ?? []) as VersionRow[])
      .filter((v) => v.rollout_status === "candidate")
      .reduce((sum, v) => sum + (v.rollout_percentage ?? 0), 0);

    if (otherCandidateTotal + args.rolloutPercentage > 100) {
      throw new Error(
        `Total candidate traffic would exceed 100% (current other candidates: ${otherCandidateTotal}%).`,
      );
    }
  }

  const { data, error } = await supabase
    .from("prompt_versions")
    .update({
      rollout_status: args.rolloutStatus,
      rollout_percentage: args.rolloutPercentage,
    })
    .eq("id", args.promptVersionId)
    .eq("prompt_id", args.promptId)
    .select("id, version_tag, is_published, rollout_status, rollout_percentage")
    .single();

  if (error) throw new Error(error.message);
  const row = data as VersionRow;
  return {
    promptVersionId: row.id,
    versionTag: row.version_tag,
    rolloutStatus: row.rollout_status as RolloutStatus,
    rolloutPercentage: row.rollout_percentage,
    isPublished: row.is_published,
  };
}
