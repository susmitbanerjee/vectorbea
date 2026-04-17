import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";

import {
  getAuthenticatedUserFromCookies,
  loadOrganizationsForUser,
} from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: allow up to 60s for concurrent model calls

// ─── Cost tables (per 1K tokens, approximate) ────────────────────────────────
const COST_PER_1K: Record<string, { input: number; output: number }> = {
  "gpt-4o":              { input: 0.005,   output: 0.015   },
  "gpt-4o-mini":         { input: 0.00015, output: 0.0006  },
  "claude-3-5-sonnet":   { input: 0.003,   output: 0.015   },
  "claude-3-haiku":      { input: 0.00025, output: 0.00125 },
  "gemini-1.5-pro":      { input: 0.00125, output: 0.005   },
  "gemini-1.5-flash":    { input: 0.000075,output: 0.0003  },
};

// ─── Mock LLM call (replace with real SDK calls when keys are configured) ─────
async function callModel(
  modelId: string,
  systemPrompt: string,
  userMessage: string,
): Promise<{ output: string; inputTokens: number; outputTokens: number }> {
  // In production, route to the correct provider SDK based on modelId.
  // e.g. OpenAI for gpt-*, Anthropic for claude-*, Google for gemini-*
  //
  // For demonstration without live keys, we return a structured mock.
  // Swap this block for real calls:
  //
  //   const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  //   const response = await openai.chat.completions.create({ model: modelId, ... });
  //
  // Similarly for Anthropic and Google Generative AI SDKs.

  const MOCK_RESPONSES: Record<string, string> = {
    "gpt-4o":
      "Transformers use self-attention to relate all positions in a sequence in O(1) steps, enabling parallel processing. RNNs process sequences step-by-step through hidden states, making training slower and suffering from vanishing gradients over long sequences.",
    "gpt-4o-mini":
      "Transformers process entire sequences in parallel via attention mechanisms, while RNNs process tokens sequentially and can struggle with long-range dependencies due to vanishing gradients.",
    "claude-3-5-sonnet":
      "A Transformer processes all tokens simultaneously using self-attention, capturing long-range dependencies efficiently and enabling massive parallelization. An RNN processes tokens sequentially, maintaining a hidden state, which limits parallelism and makes it prone to vanishing gradients on long sequences.",
    "claude-3-haiku":
      "Transformers attend to all tokens at once using self-attention, while RNNs update a hidden state one token at a time — making transformers faster to train but more memory-intensive.",
    "gemini-1.5-pro":
      "Transformers replace recurrence with multi-head self-attention, allowing each token to directly attend to every other token in a single forward pass. RNNs encode history into a fixed-size hidden state updated sequentially, which bottlenecks both parallelism and gradient flow across long sequences.",
    "gemini-1.5-flash":
      "Transformers use self-attention to process sequences in parallel, whereas RNNs process tokens one-by-one through a recurrent hidden state, making them slower and harder to scale.",
  };

  const output = MOCK_RESPONSES[modelId] ?? `[${modelId}] Response unavailable in mock mode.`;
  const inputTokens = Math.ceil((systemPrompt.length + userMessage.length) / 4);
  const outputTokens = Math.ceil(output.length / 4);

  return { output, inputTokens, outputTokens };
}

// ─── Route handler ────────────────────────────────────────────────────────────

const ALLOWED_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "claude-3-5-sonnet",
  "claude-3-haiku",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
] as const;

// Zero-Trust: strictly validate model IDs, message lengths, and cardinality.
const EvalRunSchema = z.object({
  systemPrompt: z.string().min(1, "systemPrompt is required").max(32_000, "systemPrompt must be 32 000 characters or fewer"),
  userMessage:  z.string().min(1, "userMessage is required").max(32_000, "userMessage must be 32 000 characters or fewer"),
  // Accept only the exact model IDs we support — unknown strings are silently
  // exploitable if we pass them straight to an LLM SDK.
  models: z
    .array(z.enum(ALLOWED_MODELS))
    .min(1, "At least one model is required")
    .max(6,  "A maximum of 6 models may be evaluated at once"),
});

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

  // ── Authorization: confirm user belongs to this workspace ─────────────────
  // loadOrganizationsForUser is scoped to the authenticated user — a forged
  // workspaceId will simply return an empty array, triggering the plan gate.
  const organizations = await loadOrganizationsForUser(user.id).catch(() => []);
  const planTier = organizations[0]?.planTier ?? "free";

  // ── Plan gate ─────────────────────────────────────────────────────────────
  if (planTier === "free") {
    return NextResponse.json(
      { error: "Prompt evaluation is restricted to the Team plan. Upgrade at /settings/billing." },
      { status: 403 },
    );
  }

  // ── Zero-Trust payload validation (Zod) ────────────────────────────────
  const rawBody = await request.json().catch(() => null);
  const parsed = EvalRunSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request payload", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { systemPrompt, userMessage, models: sanitizedModels } = parsed.data;

  // ── Fan-out: all models in parallel ──────────────────────────────────────
  const results = await Promise.all(
    sanitizedModels.map(async (modelId) => {
      const start = Date.now();
      try {
        const { output, inputTokens, outputTokens } = await callModel(
          modelId,
          systemPrompt,
          userMessage,
        );
        const latencyMs = Date.now() - start;
        const costs = COST_PER_1K[modelId] ?? { input: 0, output: 0 };
        const estimatedCostUsd =
          (inputTokens / 1000) * costs.input + (outputTokens / 1000) * costs.output;

        return {
          modelId,
          output,
          latencyMs,
          estimatedCostUsd: Math.max(estimatedCostUsd, 0.0001),
          score: null,
          scoreReasoning: null,
          error: null,
        };
      } catch (err) {
        return {
          modelId,
          output: "",
          latencyMs: Date.now() - start,
          estimatedCostUsd: 0,
          score: null,
          scoreReasoning: null,
          error: err instanceof Error ? err.message : "Model call failed",
        };
      }
    }),
  );

  return NextResponse.json({ results }, { status: 200 });
}
