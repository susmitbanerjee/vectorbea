import "server-only";

import { createHash, randomBytes } from "crypto";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { sendEmail } from "@/lib/server/email";
import { teamInvitationEmail } from "@/lib/server/email-templates";

const INVITE_TTL_HOURS = 72;
const ALLOWED_ROLES = ["admin", "editor", "viewer"] as const;
type InviteRole = (typeof ALLOWED_ROLES)[number];

export interface Invitation {
  id: string;
  workspaceId: string;
  email: string;
  role: InviteRole;
  invitedBy: string;
  inviterName: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function expiresAt(): string {
  return new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

export async function createInvitation(args: {
  workspaceId: string;
  email: string;
  role: InviteRole;
  invitedBy: string;
  inviterName: string;
  workspaceName: string;
}): Promise<{ invitation: Invitation; token: string }> {
  if (!ALLOWED_ROLES.includes(args.role)) throw new Error(`Invalid role. Allowed: ${ALLOWED_ROLES.join(", ")}`);
  const email = args.email.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("Invalid email address");

  const supabase = createVectorBeaAdminClient();

  // Check for active pending invite
  const exp = new Date().toISOString();
  const { data: existing } = await supabase
    .schema("vectorbea")
    .from("workspace_invitations")
    .select("id")
    .eq("workspace_id", args.workspaceId)
    .eq("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", exp)
    .maybeSingle();

  if (existing) throw new Error("A pending invitation already exists for this email");

  // Generate token
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expires = expiresAt();
  const id = crypto.randomUUID();

  const { data, error } = await supabase
    .schema("vectorbea")
    .from("workspace_invitations")
    .insert({
      id,
      workspace_id: args.workspaceId,
      email,
      role: args.role,
      invited_by: args.invitedBy,
      inviter_name: args.inviterName,
      token_hash: tokenHash,
      expires_at: expires,
      accepted_at: null,
      revoked_at: null,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  const invitation = toInvitationView(data);
  const appUrl = process.env.APP_URL ?? "https://app.vectorbea.app";
  const acceptUrl = `${appUrl}/auth/accept-invite?token=${rawToken}`;

  // Send email (non-blocking, errors logged not thrown)
  const tmpl = teamInvitationEmail({
    inviterName: args.inviterName,
    workspaceName: args.workspaceName,
    role: args.role,
    acceptUrl,
    expiresAt: expires,
  });
  sendEmail({ ...tmpl, to: email }).catch((err) => {
    console.warn("[invitations] Failed to send invitation email:", err instanceof Error ? err.message : err);
  });

  return { invitation, token: rawToken };
}

export async function listInvitations(workspaceId: string): Promise<Invitation[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .schema("vectorbea")
    .from("workspace_invitations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toInvitationView);
}

export async function revokeInvitation(workspaceId: string, invitationId: string): Promise<void> {
  const supabase = createVectorBeaAdminClient();
  const { error } = await supabase
    .schema("vectorbea")
    .from("workspace_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", invitationId)
    .is("accepted_at", null);
  if (error) throw new Error(error.message);
}

export async function acceptInvitation(token: string, userId: string): Promise<{ workspaceId: string; role: InviteRole }> {
  const tokenHash = hashToken(token);
  const supabase = createVectorBeaAdminClient();
  const now = new Date().toISOString();

  const { data: inv, error: invErr } = await supabase
    .schema("vectorbea")
    .from("workspace_invitations")
    .select("*")
    .eq("token_hash", tokenHash)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", now)
    .maybeSingle();

  if (invErr) throw new Error(invErr.message);
  if (!inv) throw new Error("Invitation not found or expired");

  // Add workspace member
  const { error: memberErr } = await supabase
    .from("workspace_members")
    .upsert({
      workspace_id: inv.workspace_id,
      user_id: userId,
      role: inv.role,
      granted_at: now,
    }, { onConflict: "workspace_id,user_id" });
  if (memberErr) throw new Error(memberErr.message);

  // Mark accepted
  await supabase
    .schema("vectorbea")
    .from("workspace_invitations")
    .update({ accepted_at: now })
    .eq("id", inv.id);

  return { workspaceId: inv.workspace_id as string, role: inv.role as InviteRole };
}

// eslint-disable-next-line
function toInvitationView(row: any): Invitation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    role: row.role,
    invitedBy: row.invited_by,
    inviterName: row.inviter_name ?? row.invited_by,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at ?? null,
    revokedAt: row.revoked_at ?? null,
    createdAt: row.created_at,
  };
}
