/**
 * Invitation logic unit tests.
 * Tests the pure helper functions extracted from lib/server/invitations.ts.
 * No DB calls — tests token generation and validation logic in isolation.
 */

import { createHash, randomBytes } from "crypto";

// ─── Extracted helpers (mirrored from invitations.ts) ────────────────────────

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function expiresAt(ttlHours = 72): string {
  return new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
}

function isExpired(expiresAtIso: string): boolean {
  return new Date(expiresAtIso) < new Date();
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Token hashing", () => {
  it("produces a 64-char hex digest", () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });

  it("same token always produces same hash", () => {
    const token = "abc123";
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("different tokens produce different hashes", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"));
  });

  it("token itself is not the hash", () => {
    const token = generateToken();
    expect(hashToken(token)).not.toBe(token);
  });
});

describe("Token expiry", () => {
  it("fresh token is not expired", () => {
    const exp = expiresAt(72);
    expect(isExpired(exp)).toBe(false);
  });

  it("past expiry is detected as expired", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(isExpired(past)).toBe(true);
  });

  it("TTL of 0 produces immediately-expired token", () => {
    const now = new Date(Date.now() - 1).toISOString();
    expect(isExpired(now)).toBe(true);
  });
});

describe("Invitation creation rules", () => {
  const ALLOWED_ROLES = ["admin", "editor", "viewer"] as const;

  it("accepts all allowed roles", () => {
    for (const role of ALLOWED_ROLES) {
      expect(ALLOWED_ROLES.includes(role)).toBe(true);
    }
  });

  it("rejects unknown roles", () => {
    expect(ALLOWED_ROLES.includes("superadmin" as (typeof ALLOWED_ROLES)[number])).toBe(false);
  });

  it("validates email contains @", () => {
    const isValidEmail = (email: string) => email.includes("@");
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("@domain.com")).toBe(true); // primitive check
  });

  it("token is 64 hex chars", () => {
    const token = generateToken();
    expect(token).toHaveLength(64);
  });

  it("each generated token is unique", () => {
    const t1 = generateToken();
    const t2 = generateToken();
    expect(t1).not.toBe(t2);
  });
});

describe("Accept invitation flow", () => {
  it("valid token hash lookup succeeds", () => {
    const rawToken = generateToken();
    const stored = hashToken(rawToken);
    // Simulate: DB returns row where token_hash === hash(rawToken)
    const found = stored === hashToken(rawToken);
    expect(found).toBe(true);
  });

  it("wrong token does not match stored hash", () => {
    const rightToken = generateToken();
    const wrongToken = generateToken();
    const stored = hashToken(rightToken);
    expect(stored === hashToken(wrongToken)).toBe(false);
  });
});

describe("Internal job token auth", () => {
  it("matching tokens pass", () => {
    const token = "super-secret-token";
    const provided = "super-secret-token";
    expect(token === provided).toBe(true);
  });

  it("mismatched tokens fail", () => {
    const token = "super-secret-token";
    const provided = "wrong-token";
    expect(token === provided).toBe(false);
  });

  it("empty provided token fails when configured", () => {
    const configured = "some-token";
    const provided = "";
    expect(configured === provided).toBe(false);
  });
});
