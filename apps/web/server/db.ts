import "server-only";

import { PrismaClient } from "@/lib/generated/prisma";

// Global singleton — prevents connection pool exhaustion during Next.js
// hot-reload in development. In production each process keeps one instance.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const TARGET_SCHEMA = "vectorbea";

function withSchema(urlValue?: string | null) {
  if (!urlValue) return urlValue ?? undefined;
  try {
    const parsed = new URL(urlValue);
    if (!parsed.searchParams.get("schema")) {
      parsed.searchParams.set("schema", TARGET_SCHEMA);
    }
    return parsed.toString();
  } catch {
    return urlValue;
  }
}

const runtimeDatabaseUrl = withSchema(process.env.DATABASE_URL);

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: runtimeDatabaseUrl
      ? {
          db: {
            url: runtimeDatabaseUrl,
          },
        }
      : undefined,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
