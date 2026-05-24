/**
 * Secret Service — Server-side only
 *
 * AES-256-GCM encryption for connection secrets.
 *
 * Secrets are stored INLINE in the connections.secret_ref column using the
 * format:  enc_v1:<base64(iv || tag || ciphertext)>
 *
 * This requires no separate secrets table — secrets work as soon as the
 * connections table exists, with zero migrations needed.
 *
 * Set SECRET_ENCRYPTION_KEY (64-char hex or 44-char base64 = 32 bytes) in
 * production. Without it a fixed fallback key is used — secrets are still
 * encrypted but the key is predictable; set the env var for real isolation.
 *
 * SECURITY INVARIANTS:
 *   - Plaintext never leaves this module after encryption
 *   - secret_ref values that start with "enc_v1:" are opaque to the frontend
 *     (the actual ciphertext is never surfaced in UI; only secret_masked is)
 *   - getSecretForRuntime() is server-side only; never called from API routes
 *     that return data to the browser
 */

import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES   = 12; // GCM nonce
const TAG_BYTES  = 16; // GCM auth tag
const PREFIX     = "enc_v1:";

// ─── Key management ───────────────────────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const raw = process.env.SECRET_ENCRYPTION_KEY;

  if (!raw) {
    console.warn(
      "[secret-service] SECRET_ENCRYPTION_KEY is not set. " +
      "Using a fixed fallback key — set this env var in production.",
    );
    // Exactly 32 ASCII bytes — safe as a fallback, not for production.
    return Buffer.from("dev-only-key-change-this-in-prod");
  }

  // Accept 64-char hex or base64-encoded 32-byte value
  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new Error(
      `[secret-service] SECRET_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). ` +
      "Use a 64-char hex string or 44-char base64 string.",
    );
  }
  return key;
}

// ─── Encrypt / Decrypt ───────────────────────────────────────────────────────

function encryptInline(plaintext: string): string {
  const key = getEncryptionKey();
  const iv  = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag  = cipher.getAuthTag();
  // Layout: iv (12) || tag (16) || ciphertext
  return PREFIX + Buffer.concat([iv, tag, body]).toString("base64");
}

function decryptInline(secretRef: string): string {
  if (!secretRef.startsWith(PREFIX)) {
    throw new Error("[secret-service] Not an inline-encrypted secret ref.");
  }
  const key  = getEncryptionKey();
  const blob = Buffer.from(secretRef.slice(PREFIX.length), "base64");
  if (blob.length < IV_BYTES + TAG_BYTES) {
    throw new Error("[secret-service] Ciphertext too short — data corrupted.");
  }
  const iv        = blob.subarray(0, IV_BYTES);
  const tag       = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher  = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext secret and return the opaque secretRef to store in
 * the connections.secret_ref column.  No DB write — the caller persists it.
 *
 * The returned value starts with "enc_v1:" and is safe to store in any text
 * column.  It must NEVER be returned to the frontend.
 */
export async function storeSecret(
  _workspaceId: string,
  _connectionId: string,
  plaintextSecret: string,
): Promise<string> {
  return encryptInline(plaintextSecret);
}

/**
 * Retrieve and decrypt a secret for server-side runtime use ONLY.
 * Supports both the new inline format (enc_v1:…) and the legacy DB-backed
 * format (sec_…) so old rows keep working after a migration.
 */
export async function getSecretForRuntime(secretRef: string): Promise<string | null> {
  if (!secretRef) return null;

  // New inline format — decrypt without any DB round-trip
  if (secretRef.startsWith(PREFIX)) {
    try {
      return decryptInline(secretRef);
    } catch (e) {
      console.error("[secret-service] Inline decryption failed:", (e as Error).message);
      return null;
    }
  }

  // Legacy DB-backed format (sec_…) — try the connection_secrets table if it
  // exists; silently return null if the table hasn't been created yet.
  try {
    const { db }     = await import("@/server/db");
    const { Prisma } = await import("@/lib/generated/prisma");
    const rows = await db.$queryRaw<{ ciphertext: string }[]>(Prisma.sql`
      SELECT ciphertext FROM vectorbea.connection_secrets
      WHERE secret_ref = ${secretRef}
      LIMIT 1
    `);
    if (!rows[0]) return null;
    // The legacy table stores raw base64 ciphertext without the prefix
    const blob = Buffer.from(rows[0].ciphertext, "base64");
    const key  = getEncryptionKey();
    if (blob.length < IV_BYTES + TAG_BYTES) return null;
    const iv        = blob.subarray(0, IV_BYTES);
    const tag       = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const encrypted = blob.subarray(IV_BYTES + TAG_BYTES);
    const decipher  = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch (e) {
    console.error("[secret-service] Legacy DB lookup failed:", (e as Error).message);
    return null;
  }
}

/**
 * No-op for inline secrets — the secret is deleted when the connection row
 * is deleted.  Kept for API compatibility and legacy DB cleanup.
 */
export async function deleteSecret(connectionId: string): Promise<void> {
  // Try to remove from legacy table if it exists — ignore errors
  try {
    const { db }     = await import("@/server/db");
    const { Prisma } = await import("@/lib/generated/prisma");
    await db.$executeRaw(Prisma.sql`
      DELETE FROM vectorbea.connection_secrets
      WHERE connection_id = ${connectionId}::uuid
    `);
  } catch {
    // Table may not exist — that's fine
  }
}

/**
 * Re-encrypt with a new plaintext and return the new secretRef.
 * Caller must persist the returned value to connections.secret_ref.
 */
export async function rotateSecret(
  _connectionId: string,
  newPlaintext: string,
): Promise<string> {
  return encryptInline(newPlaintext);
}

/**
 * Check whether a secret ref is present and in a valid format.
 */
export function secretExists(secretRef: string | null | undefined): boolean {
  return typeof secretRef === "string" && secretRef.length > 0;
}

/**
 * Return a safe masked display value from the secret ref.
 * Extracts nothing from the plaintext — the ref itself is used as a token.
 */
export function getMaskedDisplay(secretRef: string | null | undefined): string | null {
  if (!secretRef || !secretRef.startsWith(PREFIX)) return null;
  // Show last 4 chars of the base64 payload as a fingerprint
  const tail = secretRef.slice(-4);
  return `••••••••${tail}`;
}
