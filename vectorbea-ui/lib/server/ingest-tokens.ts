import "server-only";

import crypto from "crypto";

import { writeAuditEvent } from "@/lib/server/audit-events";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

// Keep vb_li_ as the generated prefix for now so existing SDK installs and
// operator runbooks do not break. Validation and docs should treat vb_li_ as
// the current supported ingest-token format, with room for future additive
// prefixes such as vb_ingest_live_.
const TOKEN_STATIC_PREFIX = "vb_li_";
const RANDOM_CHARS = 32;
const PREFIX_LENGTH = TOKEN_STATIC_PREFIX.length + 14;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export interface IngestTokenRow {
  id: string;
  workspace_id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  last_four: string;
  scopes: string[];
  environment: string | null;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  metadata: Record<string, unknown>;
}

export interface IngestTokenView {
  id: string;
  workspaceId: string;
  name: string;
  tokenPrefix: string;
  lastFour: string;
  maskedToken: string;
  scopes: string[];
  environment: string | null;
  createdBy: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  status: "active" | "expired" | "revoked";
}

export interface IngestAuthResult {
  workspaceId: string;
  tokenId: string;
  scopes: string[];
  environment: string | null;
  authType: "ingest_token";
}

function randomString(length: number) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function hashIngestToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function parseIngestTokenPrefix(rawToken: string): string | null {
  const normalized = rawToken.trim();
  if (!normalized || normalized.length < PREFIX_LENGTH) return null;
  return normalized.slice(0, PREFIX_LENGTH);
}

export function maskIngestToken(tokenPrefix: string, lastFour: string): string {
  return `${tokenPrefix}••••${lastFour}`;
}

export function generateIngestToken(): {
  rawToken: string;
  tokenHash: string;
  tokenPrefix: string;
  lastFour: string;
} {
  const rawToken = `${TOKEN_STATIC_PREFIX}${randomString(RANDOM_CHARS)}`;
  const tokenPrefix = rawToken.slice(0, PREFIX_LENGTH);
  const lastFour = rawToken.slice(-4);
  const tokenHash = hashIngestToken(rawToken);
  return { rawToken, tokenHash, tokenPrefix, lastFour };
}

function mapRow(row: IngestTokenRow): IngestTokenView {
  const now = Date.now();
  const expired = row.expires_at ? new Date(row.expires_at).getTime() < now : false;
  const status: IngestTokenView["status"] =
    row.revoked_at ? "revoked" : expired ? "expired" : "active";

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    lastFour: row.last_four,
    maskedToken: maskIngestToken(row.token_prefix, row.last_four),
    scopes: row.scopes,
    environment: row.environment,
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    status,
  };
}

export async function listIngestTokens(workspaceId: string): Promise<IngestTokenView[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("ingest_tokens")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    if (error.message.toLowerCase().includes("does not exist")) return [];
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapRow(row as IngestTokenRow));
}

export async function createIngestToken(args: {
  workspaceId: string;
  name: string;
  scopes?: string[];
  environment?: string | null;
  expiresAt?: string | null;
  createdBy?: string | null;
}): Promise<{ token: IngestTokenView; rawToken: string }> {
  const supabase = createVectorBeaAdminClient();
  const { rawToken, tokenHash, tokenPrefix, lastFour } = generateIngestToken();

  const { data, error } = await supabase
    .from("ingest_tokens")
    .insert({
      workspace_id: args.workspaceId,
      name: args.name.trim(),
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      last_four: lastFour,
      scopes: args.scopes?.length ? args.scopes : ["traces:write"],
      environment: args.environment ?? null,
      expires_at: args.expiresAt ?? null,
      created_by: args.createdBy ?? null,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  await writeAuditEvent({
    workspaceId: args.workspaceId,
    actorUserId: args.createdBy ?? null,
    eventType: "ingest_token_created",
    entityType: "ingest_token",
    entityId: String((data as IngestTokenRow).id),
    entityName: args.name.trim(),
    metadata: {
      tokenPrefix,
      lastFour,
      scopes: args.scopes?.length ? args.scopes : ["traces:write"],
      environment: args.environment ?? null,
    },
  }).catch(() => {});

  return { token: mapRow(data as IngestTokenRow), rawToken };
}

export async function rotateIngestToken(args: {
  workspaceId: string;
  tokenId: string;
  rotatedBy?: string | null;
}): Promise<{ token: IngestTokenView; rawToken: string }> {
  const supabase = createVectorBeaAdminClient();
  const { data: existing, error: fetchError } = await supabase
    .from("ingest_tokens")
    .select("*")
    .eq("id", args.tokenId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();

  if (fetchError) throw new Error(fetchError.message);
  if (!existing) throw new Error("Token not found");

  const { rawToken, tokenHash, tokenPrefix, lastFour } = generateIngestToken();
  const existingRow = existing as IngestTokenRow;

  const { data, error } = await supabase
    .from("ingest_tokens")
    .update({
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      last_four: lastFour,
      last_used_at: null,
      revoked_at: null,
      revoked_by: null,
      metadata: {
        ...(existingRow.metadata ?? {}),
        last_rotated_at: new Date().toISOString(),
        last_rotated_by: args.rotatedBy ?? null,
      },
    })
    .eq("id", args.tokenId)
    .eq("workspace_id", args.workspaceId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  await writeAuditEvent({
    workspaceId: args.workspaceId,
    actorUserId: args.rotatedBy ?? null,
    eventType: "ingest_token_rotated",
    entityType: "ingest_token",
    entityId: args.tokenId,
    entityName: existingRow.name,
    metadata: { tokenPrefix, lastFour },
  }).catch(() => {});

  return { token: mapRow(data as IngestTokenRow), rawToken };
}

export async function revokeIngestToken(args: {
  workspaceId: string;
  tokenId: string;
  revokedBy?: string | null;
}): Promise<IngestTokenView> {
  const supabase = createVectorBeaAdminClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("ingest_tokens")
    .update({ revoked_at: now, revoked_by: args.revokedBy ?? null })
    .eq("id", args.tokenId)
    .eq("workspace_id", args.workspaceId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Token not found");

  await writeAuditEvent({
    workspaceId: args.workspaceId,
    actorUserId: args.revokedBy ?? null,
    eventType: "ingest_token_revoked",
    entityType: "ingest_token",
    entityId: args.tokenId,
    entityName: String((data as IngestTokenRow).name),
    metadata: {
      tokenPrefix: String((data as IngestTokenRow).token_prefix),
      lastFour: String((data as IngestTokenRow).last_four),
      revokedAt: now,
    },
  }).catch(() => {});

  return mapRow(data as IngestTokenRow);
}

export async function authenticateIngestToken(
  authHeader: string | null,
  ingestHeader: string | null,
  legacyHeader?: string | null,
): Promise<IngestAuthResult | null> {
  let rawToken: string | null = null;

  if (authHeader?.startsWith("Bearer ")) {
    rawToken = authHeader.slice(7).trim();
  } else if (ingestHeader?.trim()) {
    rawToken = ingestHeader.trim();
  } else if (legacyHeader?.trim()) {
    rawToken = legacyHeader.trim();
  }

  if (!rawToken) return null;

  const tokenPrefix = parseIngestTokenPrefix(rawToken);
  if (!tokenPrefix) {
    throw { status: 401, message: "Invalid ingest token" };
  }

  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("ingest_tokens")
    .select("*")
    .eq("token_prefix", tokenPrefix)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) {
    throw { status: 401, message: "Invalid ingest token" };
  }

  const row = data as IngestTokenRow;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    throw { status: 401, message: "Ingest token is no longer active" };
  }

  if (!verifyIngestToken(rawToken, row.token_hash)) {
    throw { status: 401, message: "Invalid ingest token" };
  }

  if (!row.scopes.includes("traces:write")) {
    throw { status: 403, message: "Ingest token does not have traces:write scope" };
  }

  void supabase
    .from("ingest_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(() => {});

  return {
    workspaceId: row.workspace_id,
    tokenId: row.id,
    scopes: row.scopes,
    environment: row.environment,
    authType: "ingest_token",
  };
}

export function verifyIngestToken(rawToken: string, storedHash: string): boolean {
  try {
    const candidateHash = hashIngestToken(rawToken);
    const storedBuffer = Buffer.from(storedHash, "hex");
    const candidateBuffer = Buffer.from(candidateHash, "hex");
    if (storedBuffer.length !== candidateBuffer.length) return false;
    return crypto.timingSafeEqual(storedBuffer, candidateBuffer);
  } catch {
    return false;
  }
}
