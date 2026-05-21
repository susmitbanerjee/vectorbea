import "server-only";

import { db } from "@/server/db";

// ─────────────────────────────────────────────────────────────────────────────
// MVP mock session
//
// Real auth (Supabase JWT → User lookup) is wired in the next milestone.
// For now every request resolves to the seeded "Acme Corp" org and its
// owner user so the API routes are fully functional end-to-end.
//
// The session shape intentionally mirrors what the real implementation will
// return, so route handlers need zero changes when real auth lands.
// ─────────────────────────────────────────────────────────────────────────────

export type Session = {
  userId: string;
  organizationId: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
};

let _cached: Session | null = null;

export async function getMockSession(): Promise<Session> {
  if (_cached) return _cached;

  // Look up the seeded org + owner so tests and local dev work without
  // hard-coded IDs in source.
  const org = await db.organization.findFirst({ where: { slug: "acme-corp" } });
  if (!org) {
    throw new Error(
      "Seed data not found. Run `npm run prisma:seed` to create the default organization.",
    );
  }

  const user = await db.user.findFirst({
    where: { organizationId: org.id, role: "OWNER" },
  });
  if (!user) {
    throw new Error("Seed owner user not found. Run `npm run prisma:seed`.");
  }

  _cached = { userId: user.id, organizationId: org.id, role: "OWNER" };
  return _cached;
}

// Exported for tests that need to inject a specific session without a DB.
export function setMockSession(s: Session) {
  _cached = s;
}

export function clearMockSession() {
  _cached = null;
}
