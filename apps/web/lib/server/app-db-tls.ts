import type { PoolConfig } from "pg";

/** Deployment configuration only: never select database trust from request headers. */
export function appDatabaseConnectionOptions(
  connectionString: string,
  env: Record<string, string | undefined> = process.env,
): Pick<PoolConfig, "connectionString" | "ssl"> {
  const unchanged = { connectionString };
  if (env.VERCEL_ENV === "production") return unchanged;
  if (env.VERCEL_GIT_COMMIT_REF && env.VERCEL_GIT_COMMIT_REF !== "dev") return unchanged;

  try {
    if (new URL(env.NEXT_PUBLIC_APP_URL ?? "").origin !== "https://dev.vectorbea.com") {
      return unchanged;
    }
  } catch {
    return unchanged;
  }

  const ca = env.DATABASE_SSL_CA?.trim().replace(/\\n/g, "\n");
  if (!ca) return unchanged;

  const url = new URL(connectionString);
  // pg's URL parser replaces explicit ssl options when these parameters exist.
  // Remove them only for staging with an explicitly supplied trust certificate.
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert", "ssl"]) {
    url.searchParams.delete(key);
  }
  return {
    connectionString: url.toString(),
    ssl: { ca, rejectUnauthorized: true },
  };
}
