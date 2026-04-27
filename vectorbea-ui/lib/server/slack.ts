import "server-only";

import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

// ─── Encryption helpers (AES-GCM via Web Crypto) ────────────────────────────

const ENC_KEY_ENV = "INTEGRATION_ENCRYPTION_KEY"; // 32-byte hex

function getKey(): string {
  const k = process.env[ENC_KEY_ENV];
  if (!k || k.length < 32) {
    // Derive a fixed key from app secret for dev convenience
    const fallback = process.env.NEXTAUTH_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "dev-key-not-secure";
    return fallback.slice(0, 32).padEnd(32, "0");
  }
  return k.slice(0, 32);
}

async function importKey(raw: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey("raw", enc.encode(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await importKey(getKey());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.length);
  return Buffer.from(combined).toString("base64");
}

export async function decryptSecret(ciphertext: string): Promise<string> {
  const key = await importKey(getKey());
  const combined = Buffer.from(ciphertext, "base64");
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, ct);
  return new TextDecoder().decode(plain);
}

// ─── Slack notification payload builder ──────────────────────────────────────

export interface SlackPayload {
  text: string;
  blocks?: unknown[];
}

function mkBlock(title: string, text: string, url?: string): unknown[] {
  const blocks: unknown[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${title}*\n${text}` },
    },
  ];
  if (url) {
    blocks.push({
      type: "actions",
      elements: [{ type: "button", text: { type: "plain_text", text: "View →" }, url }],
    });
  }
  return blocks;
}

export function slackEvaluationCompleted(args: {
  workspaceName: string;
  promptName: string;
  versionTag: string;
  recommendation: string;
  score: number | null;
  runUrl: string;
}): SlackPayload {
  const label = args.recommendation.replaceAll("_", " ");
  const scoreStr = args.score != null ? ` · Score: ${Math.round(args.score * 100)}%` : "";
  return {
    text: `Evaluation complete: ${args.promptName}@${args.versionTag} — ${label}${scoreStr}`,
    blocks: mkBlock(
      `✅ Evaluation complete`,
      `*Prompt:* ${args.promptName}@${args.versionTag}\n*Verdict:* ${label}${scoreStr}\n*Workspace:* ${args.workspaceName}`,
      args.runUrl,
    ),
  };
}

export function slackEvaluationFailed(args: {
  workspaceName: string;
  promptName: string;
  versionTag: string;
  reason: string;
  runUrl: string;
}): SlackPayload {
  return {
    text: `Evaluation failed: ${args.promptName}@${args.versionTag}`,
    blocks: mkBlock(
      `❌ Evaluation failed`,
      `*Prompt:* ${args.promptName}@${args.versionTag}\n*Reason:* ${args.reason}\n*Workspace:* ${args.workspaceName}`,
      args.runUrl,
    ),
  };
}

export function slackAlertTriggered(args: {
  workspaceName: string;
  ruleName: string;
  metricType: string;
  metricValue: number;
  threshold: number;
  alertsUrl: string;
}): SlackPayload {
  return {
    text: `Alert triggered: ${args.ruleName} in ${args.workspaceName}`,
    blocks: mkBlock(
      `🚨 Alert triggered`,
      `*Rule:* ${args.ruleName}\n*Metric:* ${args.metricType.replaceAll("_", " ")} = ${Math.round(args.metricValue * 100) / 100} (threshold: ${args.threshold})\n*Workspace:* ${args.workspaceName}`,
      args.alertsUrl,
    ),
  };
}

export function slackRegressionFailed(args: {
  workspaceName: string;
  scheduleName: string;
  reason: string;
  runUrl: string | null;
}): SlackPayload {
  return {
    text: `Regression failed: ${args.scheduleName} in ${args.workspaceName}`,
    blocks: mkBlock(
      `⚠️ Regression failed`,
      `*Schedule:* ${args.scheduleName}\n*Reason:* ${args.reason}\n*Workspace:* ${args.workspaceName}`,
      args.runUrl ?? undefined,
    ),
  };
}

export function slackRolloutBlocked(args: {
  workspaceName: string;
  promptName: string;
  versionTag: string;
  reasons: string[];
  promptUrl: string;
}): SlackPayload {
  return {
    text: `Rollout blocked: ${args.promptName}@${args.versionTag}`,
    blocks: mkBlock(
      `🚫 Rollout blocked`,
      `*Prompt:* ${args.promptName}@${args.versionTag}\n*Reasons:* ${args.reasons.join(", ")}\n*Workspace:* ${args.workspaceName}`,
      args.promptUrl,
    ),
  };
}

export function slackPromptPromoted(args: {
  workspaceName: string;
  promptName: string;
  versionTag: string;
  promotedBy: string;
  promptUrl: string;
}): SlackPayload {
  return {
    text: `Prompt promoted: ${args.promptName}@${args.versionTag}`,
    blocks: mkBlock(
      `🚀 Prompt promoted`,
      `*Prompt:* ${args.promptName}@${args.versionTag}\n*By:* ${args.promotedBy}\n*Workspace:* ${args.workspaceName}`,
      args.promptUrl,
    ),
  };
}

export function slackQuotaWarning(args: {
  workspaceName: string;
  usageType: string;
  pct: number;
  billingUrl: string;
}): SlackPayload {
  return {
    text: `Quota warning: ${args.usageType.replaceAll("_", " ")} at ${args.pct}%`,
    blocks: mkBlock(
      `📊 Quota warning`,
      `*Workspace:* ${args.workspaceName}\n*Usage:* ${args.usageType.replaceAll("_", " ")} at *${args.pct}%*`,
      args.billingUrl,
    ),
  };
}

// ─── Slack delivery ───────────────────────────────────────────────────────────

export interface SlackSendResult {
  ok: boolean;
  error?: string;
}

/**
 * Send a Slack message to the stored webhook URL for a workspace.
 * Never logs the webhook URL itself.
 */
export async function sendSlackNotification(
  workspaceId: string,
  payload: SlackPayload,
): Promise<SlackSendResult> {
  const supabase = createVectorBeaAdminClient();
  const { data } = await supabase
    .schema("vectorbea")
    .from("workspace_integrations")
    .select("slack_webhook_encrypted, slack_enabled")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!data?.slack_enabled || !data.slack_webhook_encrypted) {
    return { ok: false, error: "Slack not configured or disabled" };
  }

  let webhookUrl: string;
  try {
    webhookUrl = await decryptSecret(data.slack_webhook_encrypted as string);
  } catch {
    return { ok: false, error: "Failed to decrypt Slack webhook" };
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Slack HTTP ${res.status}: ${body.slice(0, 100)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Send to an explicit webhook URL (for test-send without DB lookup).
 * Never log the URL.
 */
export async function sendSlackDirect(webhookUrl: string, payload: SlackPayload): Promise<SlackSendResult> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Slack HTTP ${res.status}: ${body.slice(0, 100)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
