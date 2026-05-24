/**
 * Secret Service — Server-side only
 *
 * Handles encryption/decryption of connection secrets.
 * Uses AES-256-GCM authenticated encryption.
 *
 * The encryption key is loaded from SECRET_ENCRYPTION_KEY env var.
 * In production, this MUST be set. In local dev, a warning is emitted
 * and a fallback dev-only key is used (never commit the fallback key).
 *
 * Plaintext secrets NEVER leave this module except for server-side
 * runtime use (connection testing, tool execution).
 * They are NEVER returned to the frontend.
 */

import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";
import { db } from "@/server/db";
import { Prisma } from "@/lib/generated/prisma";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES  = 12; // GCM standard
const TAG_BYTES = 16;
const KEY_VERSION = 1;

// ─── Key management ───────────────────────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const raw = process.env.SECRET_ENCRYPTION_KEY;

  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[secret-service] SECRET_ENCRYPTION_KEY is required in production. " +
        "Set it to a 32-byte base64 or hex string.",
      );
    }
    // Dev-only fallback — never use in production
    console.warn(
      "[secret-service] WARNING: SECRET_ENCRYPTION_KEY not set. " +
      "Using insecure dev fallback key. This MUST be set in production.",
    );
    return Buffer.from("dev-only-key-change-this-in-prod!"); // 32 bytes
  }

  // Accept hex (64 chars) or base64 (44 chars for 32 bytes)
  let key: Buffer;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }

  if (key.length !== 32) {
    throw new Error(
      `[secret-service] SECRET_ENCRYPTION_KEY must be 32 bytes (got ${key.length}). ` +
      "Provide a 64-char hex string or 44-char base64 string.",
    );
  }
  return key;
}

// ─── Encrypt / Decrypt ───────────────────────────────────────────────────────

function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv  = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv || tag || ciphertext)
  const blob = Buffer.concat([iv, tag, encrypted]);
  return blob.toString("base64");
}

function decrypt(ciphertext: string): string {
  const key  = getEncryptionKey();
  const blob = Buffer.from(ciphertext, "base64");
  if (blob.length < IV_BYTES + TAG_BYTES) {
    throw new Error("[secret-service] Ciphertext is too short — data may be corrupted.");
  }
  const iv        = blob.subarray(0, IV_BYTES);
  const tag       = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher  = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function generateSecretRef(workspaceId: string, connectionId: string): string {
  // Deterministic but opaque reference
  const hash = createHash("sha256")
    .update(`${workspaceId}:${connectionId}:${Date.now()}`)
    .digest("hex")
    .slice(0, 24);
  return `sec_${hash}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Store an encrypted secret for a connection.
 * Returns the secretRef that should be stored in the connections table.
 * Plaintext is immediately discarded after encryption.
 */
export async function storeSecret(
  workspaceId: string,
  connectionId: string,
  plaintextSecret: string,
): Promise<string> {
  const ciphertext = encrypt(plaintextSecret);
  const secretRef  = generateSecretRef(workspaceId, connectionId);

  await db.$executeRaw(Prisma.sql`
    INSERT INTO connection_secrets (workspace_id, connection_id, secret_ref, ciphertext, key_version)
    VALUES (${workspaceId}::uuid, ${connectionId}::uuid, ${secretRef}, ${ciphertext}, ${KEY_VERSION})
    ON CONFLICT (connection_id)
    DO UPDATE SET
      secret_ref   = EXCLUDED.secret_ref,
      ciphertext   = EXCLUDED.ciphertext,
      key_version  = EXCLUDED.key_version,
      updated_at   = now()
  `);

  return secretRef;
}

/**
 * Retrieve and decrypt a secret for server-side runtime use ONLY.
 * This function MUST NOT be called from client components or API handlers
 * that return data to the frontend.
 */
export async function getSecretForRuntime(secretRef: string): Promise<string | null> {
  const rows = await db.$queryRaw<{ ciphertext: string }[]>(Prisma.sql`
    SELECT ciphertext FROM connection_secrets WHERE secret_ref = ${secretRef} LIMIT 1
  `);
  if (!rows[0]) return null;
  try {
    return decrypt(rows[0].ciphertext);
  } catch (e) {
    console.error("[secret-service] Decryption failed for secretRef:", secretRef, (e as Error).message);
    return null;
  }
}

/**
 * Delete a secret when a connection is removed.
 */
export async function deleteSecret(connectionId: string): Promise<void> {
  await db.$executeRaw(Prisma.sql`
    DELETE FROM connection_secrets WHERE connection_id = ${connectionId}::uuid
  `);
}

/**
 * Rotate — overwrite ciphertext with new encryption of a new plaintext.
 */
export async function rotateSecret(
  connectionId: string,
  newPlaintext: string,
): Promise<void> {
  const ciphertext = encrypt(newPlaintext);
  await db.$executeRaw(Prisma.sql`
    UPDATE connection_secrets
    SET ciphertext = ${ciphertext}, key_version = ${KEY_VERSION}, updated_at = now()
    WHERE connection_id = ${connectionId}::uuid
  `);
}

/**
 * Check whether a secret exists without decrypting it.
 */
export async function secretExists(connectionId: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ exists: boolean }[]>(Prisma.sql`
    SELECT EXISTS(SELECT 1 FROM connection_secrets WHERE connection_id = ${connectionId}::uuid) AS exists
  `);
  return rows[0]?.exists ?? false;
}

/**
 * Return the masked display value for a secret.
 * The last 4 chars of a hash — never anything from the plaintext.
 */
export async function getMaskedPreview(connectionId: string): Promise<string | null> {
  const rows = await db.$queryRaw<{ secret_ref: string; updated_at: string }[]>(Prisma.sql`
    SELECT secret_ref, updated_at::text FROM connection_secrets
    WHERE connection_id = ${connectionId}::uuid LIMIT 1
  `);
  if (!rows[0]) return null;
  return `[configured · updated ${new Date(rows[0].updated_at).toLocaleDateString()}]`;
}
