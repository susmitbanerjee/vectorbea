import { describe, expect, it } from "vitest";
import { appDatabaseConnectionOptions } from "../lib/server/app-db-tls";

const connectionString = "postgresql://user:password@35.202.7.246:5432/staging?sslmode=require&application_name=web";
const staging = {
  NEXT_PUBLIC_APP_URL: "https://dev.vectorbea.com",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "dev",
  DATABASE_SSL_CA: "-----BEGIN CERTIFICATE-----\\nexample\\n-----END CERTIFICATE-----",
};

describe("staging database certificate trust", () => {
  it("enables verified TLS and preserves non-TLS connection settings", () => {
    const options = appDatabaseConnectionOptions(connectionString, staging);
    expect(options.ssl).toEqual({
      ca: staging.DATABASE_SSL_CA.replace(/\\n/g, "\n"),
      rejectUnauthorized: true,
    });
    const url = new URL(options.connectionString!);
    expect(url.searchParams.has("sslmode")).toBe(false);
    expect(url.searchParams.get("application_name")).toBe("web");
    expect(url.hostname).toBe("35.202.7.246");
  });

  it.each([
    { NEXT_PUBLIC_APP_URL: "https://vectorbea.com" },
    { NEXT_PUBLIC_APP_URL: "https://dev.vectorbea.com.attacker.example" },
    { NEXT_PUBLIC_APP_URL: "http://dev.vectorbea.com" },
    { NEXT_PUBLIC_APP_URL: undefined },
    { NEXT_PUBLIC_APP_URL: "invalid" },
    { VERCEL_ENV: "production" },
    { VERCEL_GIT_COMMIT_REF: "master" },
    { DATABASE_SSL_CA: " " },
  ])("leaves connection configuration unchanged for %j", (override) => {
    expect(appDatabaseConnectionOptions(connectionString, { ...staging, ...override }))
      .toEqual({ connectionString });
  });

  it("removes conflicting URL TLS settings while retaining certificate verification", () => {
    const options = appDatabaseConnectionOptions(
      connectionString + "&ssl=false&sslcert=client.pem&sslkey=key.pem&sslrootcert=old.pem",
      staging,
    );
    expect([...new URL(options.connectionString!).searchParams.keys()]).toEqual(["application_name"]);
    expect(options.ssl).toMatchObject({ rejectUnauthorized: true });
  });

  it("accepts a multiline PEM without changing its contents", () => {
    const ca = staging.DATABASE_SSL_CA.replace(/\\n/g, "\n");
    expect(appDatabaseConnectionOptions(connectionString, { ...staging, DATABASE_SSL_CA: ca }).ssl)
      .toMatchObject({ ca });
  });
});
