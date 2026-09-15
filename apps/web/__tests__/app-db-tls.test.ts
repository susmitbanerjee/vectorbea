import { describe, expect, it } from "vitest";
import { checkServerIdentity, type ConnectionOptions, type PeerCertificate } from "node:tls";
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
      checkServerIdentity: expect.any(Function),
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

  it("verifies the database IP even when the socket upgrade supplies localhost", () => {
    const cert = { subject: { CN: "vectorbea-staging" }, subjectaltname: "IP Address:35.202.7.246" } as PeerCertificate;
    // Reproduce the identity failure reported by Vercel before our override.
    expect(checkServerIdentity("localhost", cert)).toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    const ssl = appDatabaseConnectionOptions(connectionString, staging).ssl as ConnectionOptions;
    expect(ssl.checkServerIdentity!("localhost", cert)).toBeUndefined();
  });

  it.each(["IP Address:35.202.7.247", "DNS:localhost", "DNS:vectorbea-us-central1.internal"])(
    "rejects a certificate for the wrong identity: %s", (subjectaltname) => {
      const ssl = appDatabaseConnectionOptions(connectionString, staging).ssl as ConnectionOptions;
      const cert = { subject: { CN: "vectorbea-staging" }, subjectaltname } as PeerCertificate;
      expect(ssl.checkServerIdentity!("localhost", cert)).toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    },
  );

  it("retains DNS hostname verification for a staging database URL", () => {
    const ssl = appDatabaseConnectionOptions(connectionString.replace("35.202.7.246", "db.example.com"), staging).ssl as ConnectionOptions;
    expect(ssl.checkServerIdentity!("localhost", { subjectaltname: "DNS:db.example.com" } as PeerCertificate)).toBeUndefined();
    expect(ssl.checkServerIdentity!("localhost", { subjectaltname: "DNS:other.example.com" } as PeerCertificate)).toBeInstanceOf(Error);
  });
});
