import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";

import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { enforceJsonBodySize } from "@/lib/server/security";
import { getWorkspacePlanLimits } from "@/lib/server/workspace-limits";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COST_PER_1K: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 0.005, output: 0.015 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "claude-3-5-sonnet": { input: 0.003, output: 0.015 },
  "claude-3-haiku": { input: 0.00025, output: 0.00125 },
  "gemini-1.5-pro": { input: 0.00125, output: 0.005 },
  "gemini-1.5-flash": { input: 0.000075, output: 0.0003 },
};

const ALLOWED_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "claude-3-5-sonnet",
  "claude-3-haiku",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
] as const;

const EvalRunSchema = z.object({
  systemPrompt: z.string().min(1).max(32_000),
  userMessage: z.string().min(1).max(32_000),
  models: z.array(z.enum(ALLOWED_MODELS)).min(1).max(6),
});

async function callModel(
  modelId: string,
  systemPrompt: string,
  userMessage: string,
): Promise<{ output: string; inputTokens: number; outputTokens: number }> {
  const mockOutput = `[${modelId}] ${userMessage.slice(0, 240)}`;
  const inputTokens = Math.ceil((systemPrompt.length + userMessage.length) / 4);
  const outputTokens = Math.ceil(mockOutput.length / 4);
  return { output: mockOutput, inputTokens, outputTokens };
}

export async function POST(request: NextRequest) {
  const payloadTooLarge = enforceJsonBodySize(request, 256 * 1024);
  if (payloadTooLarge) return payloadTooLarge;

  const cookieStore = await cookies();
  const user = await getAuthenticatedUserFromCookies(cookieStore);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const auth = await assertWorkspaceMember(request, workspaceId);
  if (auth.error) return auth.error;

  const rate = consumeRateLimit(`eval:run:${workspaceId}:${user.id}`, 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded for model evaluations." }, { status: 429 });
  }

  const planTier = (await getWorkspacePlanLimits(workspaceId)).planTier;
  if (planTier === "free") {
    return NextResponse.json(
      { error: "Prompt evaluation is restricted to paid plans. Upgrade at /settings/billing." },
      { status: 403 },
    );
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = EvalRunSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request payload", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { systemPrompt, userMessage, models } = parsed.data;
  const results = await Promise.all(
    models.map(async (modelId) => {
      const started = Date.now();
      try {
        const { output, inputTokens, outputTokens } = await callModel(modelId, systemPrompt, userMessage);
        const latencyMs = Date.now() - started;
        const cost = COST_PER_1K[modelId] ?? { input: 0, output: 0 };
        const estimatedCostUsd = (inputTokens / 1000) * cost.input + (outputTokens / 1000) * cost.output;
        return {
          modelId,
          output,
          latencyMs,
          estimatedCostUsd: Math.max(estimatedCostUsd, 0.0001),
          score: null,
          scoreReasoning: null,
          error: null,
        };
      } catch (error) {
        return {
          modelId,
          output: "",
          latencyMs: Date.now() - started,
          estimatedCostUsd: 0,
          score: null,
          scoreReasoning: null,
          error: "Model call failed",
        };
      }
    }),
  );

  return NextResponse.json({ results }, { status: 200 });
}

