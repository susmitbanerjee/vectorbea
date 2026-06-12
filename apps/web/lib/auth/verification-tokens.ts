import "server-only";
import { createHash, randomBytes } from "crypto";
import { neon } from "@neondatabase/serverless";

/**
 * Opaque email-verification tokens.
 *
 * Why not a JWT in the mail: a JWT's payload is world-decodable (leaks user
 * id + email to anything that logs the URL) and stays replayable until expiry.
 * These tokens are 32 random bytes — no embedded data, stored only as a
 * SHA-256 hash (a DB leak exposes nothing usable), single-use, 24h expiry.
 */

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  return neon(url);
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  const sql = db();
  await sql`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      token_hash TEXT        NOT NULL PRIMARY KEY,
      subject    TEXT        NOT NULL,
      email      TEXT        NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_email_verif_subject ON email_verification_tokens (subject)`;
  tableReady = true;
}

/** Mints a fresh single-use token for the user; returns the RAW token for the mail link. */
export async function createVerificationToken(subject: string, email: string): Promise<string> {
  await ensureTable();
  const sql = db();
  const raw = randomBytes(32).toString("base64url");
  await sql`
    INSERT INTO email_verification_tokens (token_hash, subject, email, expires_at)
    VALUES (${hashToken(raw)}, ${subject}, ${email}, ${new Date(Date.now() + TOKEN_TTL_MS).toISOString()})`;
  // Opportunistic cleanup of this user's expired/used tokens
  await sql`
    DELETE FROM email_verification_tokens
    WHERE subject = ${subject} AND (expires_at < now() OR used_at IS NOT NULL)`;
  return raw;
}

/**
 * Validates and consumes a token (single-use). Returns the subject to mark
 * verified, or null. Atomic UPDATE…RETURNING prevents double-spend races.
 */
export async function consumeVerificationToken(raw: string): Promise<{ subject: string } | null> {
  // Shape check before touching the DB — 32 bytes base64url is 43 chars
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(raw)) return null;
  await ensureTable();
  const sql = db();
  const rows = await sql`
    UPDATE email_verification_tokens
    SET used_at = now()
    WHERE token_hash = ${hashToken(raw)} AND used_at IS NULL AND expires_at > now()
    RETURNING subject` as { subject: string }[];
  return rows[0] ? { subject: rows[0].subject } : null;
}
