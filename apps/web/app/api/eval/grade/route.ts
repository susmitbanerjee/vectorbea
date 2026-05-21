import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  getAuthenticatedUserFromCookies,
  loadOrganizationsForUser,
} from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ─── Types ────────────────────────────────────────────────────────────────────

type GradeRequest = {
  systemPrompt: string;
  userMessage: string;
  results: Array<{ modelId: string; output: string }>;
};

type GradeOutput = {
  score: number;       // 1–10
  reasoning: string;
};

// ─── Judge call (replace with real OpenAI SDK call) ───────────────────────────

async function judgeOutput(
  systemPrompt: string,
  userMessage: string,
  modelOutput: string,
): Promise<GradeOutput> {
  // Production implementation:
  //
  //   const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  //   const res = await openai.chat.completions.create({
  //     model: "gpt-4o-mini",
  //     response_format: { type: "json_object" },
  //     messages: [{ role: "user", content: evaluationPrompt }],
  //   });
  //   return JSON.parse(res.choices[0].message.content ?? "{}") as GradeOutput;
  //
  // The evaluation prompt is constructed below — wire it in when you add the key.

  const evaluationPrompt = `You are an impartial AI quality judge. Your only job is to evaluate how well an AI model's response fulfilled a given task.

## Original System Prompt
${systemPrompt}

## User Request
${userMessage}

## Model Response to Evaluate
${modelOutput}

## Scoring Criteria
- **Accuracy** (4 pts): Is the answer factually correct and complete?
- **Conciseness** (3 pts): Is it appropriately brief without sacrificing quality?
- **Instruction-following** (3 pts): Did the response obey the system prompt's style, tone, and format rules?

Return ONLY a JSON object with this exact shape — no markdown, no extra text:
{"score": <integer 1-10>, "reasoning": "<one or two sentences explaining the score>"}`;

  // ── Mock grader (deterministic, based on output length + keywords) ─────────
  // Remove this block and uncomment the OpenAI call above when API key is set.
  const words = modelOutput.split(/\s+/).length;
  const mentionsAttention = /attention|self-attention/i.test(modelOutput);
  const mentionsVanishing = /vanishing/i.test(modelOutput);
  const mentionsParallel = /parallel/i.test(modelOutput);
  const richness = [mentionsAttention, mentionsVanishing, mentionsParallel].filter(Boolean).length;

  let score = 5;
  if (words > 30 && words < 80) score += 1;  // concise but thorough
  if (words >= 80) score -= 1;               // slightly verbose
  score += richness;                          // technical depth
  score = Math.min(10, Math.max(1, score));

  const reasoning =
    `The response ${mentionsAttention ? "correctly references self-attention" : "does not mention attention"} ` +
    `and ${mentionsVanishing ? "addresses vanishing gradients" : "omits vanishing gradients"}. ` +
    `At ${words} words it is ${words < 40 ? "concise" : words < 80 ? "appropriately detailed" : "slightly verbose"}.` +
    ` Score: ${score}/10.`;

  // Simulate a small network delay so the UI shows "Grading…" visibly
  await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));

  return { score, reasoning };

  // Suppress unused variable warning for the production prompt
  void evaluationPrompt;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const user = await getAuthenticatedUserFromCookies(cookieStore);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  // ── Plan gate ─────────────────────────────────────────────────────────────
  const organizations = await loadOrganizationsForUser(user.id).catch(() => []);
  const planTier = organizations[0]?.planTier ?? "free";
  if (planTier === "free") {
    return NextResponse.json(
      { error: "Prompt evaluation is available on Plus, Pro, and Enterprise." },
      { status: 403 },
    );
  }

  // ── Validate body ─────────────────────────────────────────────────────────
  const body = (await request.json().catch(() => null)) as GradeRequest | null;
  if (!body?.systemPrompt || !body?.userMessage || !Array.isArray(body?.results)) {
    return NextResponse.json({ error: "systemPrompt, userMessage, and results are required" }, { status: 400 });
  }

  // ── Grade all outputs concurrently ────────────────────────────────────────
  const grades = await Promise.all(
    body.results.map(async ({ modelId, output }) => {
      try {
        const { score, reasoning } = await judgeOutput(
          body.systemPrompt,
          body.userMessage,
          output,
        );
        return { modelId, score, reasoning };
      } catch {
        return { modelId, score: 0, reasoning: "Grading failed for this model." };
      }
    }),
  );

  return NextResponse.json({ grades }, { status: 200 });
}
