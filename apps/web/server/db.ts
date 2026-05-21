import "server-only";

import { PrismaClient } from "@/lib/generated/prisma";

// Global singleton — prevents connection pool exhaustion during Next.js
// hot-reload in development. In production each process keeps one instance.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
