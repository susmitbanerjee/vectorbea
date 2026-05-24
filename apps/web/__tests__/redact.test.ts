/**
 * Redaction utility tests
 *
 * Verifies that secrets, credentials, and tokens are fully removed from
 * output strings and objects — never partially preserved or re-inserted.
 */

import { describe, it, expect } from "vitest";
import {
  redactString,
  redactConnectionString,
  redactErrorMessage,
  redactObject,
  redactHeaders,
  redactAuthHeader,
} from "../lib/server/redact";

// ─── redactString ─────────────────────────────────────────────────────────────

describe("redactString", () => {
  it("redacts postgres connection string", () => {
    const input  = "postgres://user:pass@db.example.com:5432/app";
    const output = redactString(input);
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("user");
    expect(output).not.toContain("pass");
    expect(output).toContain("db.example.com");
    expect(output).toContain("postgres://[REDACTED]@db.example.com");
  });

  it("redacts mysql connection string", () => {
    const input  = "mysql://admin:secret123@10.0.0.5:3306/prod";
    const output = redactString(input);
    expect(output).not.toContain("admin");
    expect(output).not.toContain("secret123");
    expect(output).toContain("[REDACTED]");
    expect(output).toContain("10.0.0.5");
  });

  it("redacts https URL with embedded credentials", () => {
    const input  = "https://user:password@example.com/path";
    const output = redactString(input);
    expect(output).not.toContain("user");
    expect(output).not.toContain("password");
    expect(output).toContain("[REDACTED]");
    expect(output).toContain("example.com");
    expect(output).toContain("https://[REDACTED]@example.com/path");
  });

  it("redacts mongodb+srv connection string", () => {
    const input  = "mongodb+srv://user:pass@cluster.example.com/db";
    const output = redactString(input);
    expect(output).not.toContain("user");
    expect(output).not.toContain("pass");
    expect(output).toContain("[REDACTED]");
    expect(output).toContain("cluster.example.com");
  });

  it("does not corrupt plain text with no credentials", () => {
    const input  = "Hello world. No secrets here.";
    const output = redactString(input);
    expect(output).toBe(input);
  });

  it("does not contain $1 in output (replacement bug guard)", () => {
    const input  = "postgres://user:pass@db.example.com/app";
    const output = redactString(input);
    expect(output).not.toContain("$1");
    expect(output).not.toMatch(/:\/{2}.*:.*@.*\[REDACTED\]/); // credentials still present before [REDACTED]
  });
});

// ─── redactConnectionString ───────────────────────────────────────────────────

describe("redactConnectionString", () => {
  it("removes username and password from postgres URL", () => {
    const r = redactConnectionString("postgres://myuser:mypassword@host.db.com/mydb");
    expect(r).not.toContain("myuser");
    expect(r).not.toContain("mypassword");
    expect(r).toContain("[REDACTED]");
    expect(r).toContain("host.db.com");
  });

  it("removes username and password from redis URL", () => {
    const r = redactConnectionString("redis://default:redispass@localhost:6379");
    expect(r).not.toContain("redispass");
    expect(r).toContain("[REDACTED]");
  });
});

// ─── redactErrorMessage ───────────────────────────────────────────────────────

describe("redactErrorMessage", () => {
  it("strips connection string credentials from error messages", () => {
    const msg = `Connection to postgres://dbuser:dbpass@prod-db.internal:5432/app failed.`;
    const out = redactErrorMessage(msg);
    expect(out).not.toContain("dbuser");
    expect(out).not.toContain("dbpass");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts very long tokens (>40 chars) from error messages", () => {
    const token = "sk-test-" + "a".repeat(60);
    const msg = `API request failed with key ${token}`;
    const out = redactErrorMessage(msg);
    expect(out).not.toContain(token);
    expect(out).toContain("[REDACTED]");
  });

  it("does not redact short words that are not tokens", () => {
    const msg = "Connection timed out after 10000ms.";
    const out = redactErrorMessage(msg);
    expect(out).toBe(msg);
  });
});

// ─── redactObject ─────────────────────────────────────────────────────────────

describe("redactObject", () => {
  it("redacts known secret keys", () => {
    const obj = { apiKey: "sk-test-123", username: "alice", password: "hunter2" };
    const out = redactObject(obj) as Record<string, unknown>;
    expect(out.apiKey).toBe("[REDACTED]");
    expect(out.password).toBe("[REDACTED]");
    expect(out.username).toBe("alice"); // not a secret key
  });

  it("redacts nested secret keys", () => {
    const obj = { config: { token: "abc123", host: "db.example.com" } };
    const out = redactObject(obj) as { config: Record<string, unknown> };
    expect(out.config.token).toBe("[REDACTED]");
    expect(out.config.host).toBe("db.example.com");
  });

  it("redacts connection strings embedded in string values", () => {
    const obj = { dsn: "postgres://u:p@host/db", name: "my-connection" };
    const out = redactObject(obj) as Record<string, unknown>;
    // dsn key doesn't match SECRET_KEY_PATTERN, but string value should be redacted
    const dsn = String(out.dsn);
    expect(dsn).not.toContain(":p@");
    expect(out.name).toBe("my-connection");
  });

  it("handles arrays safely", () => {
    const arr = [{ apiKey: "secret" }, { name: "ok" }];
    const out = redactObject(arr) as Array<Record<string, unknown>>;
    expect(out[0]!.apiKey).toBe("[REDACTED]");
    expect(out[1]!.name).toBe("ok");
  });

  it("handles null/undefined gracefully", () => {
    expect(redactObject(null)).toBeNull();
    expect(redactObject(undefined)).toBeUndefined();
  });
});

// ─── redactHeaders ────────────────────────────────────────────────────────────

describe("redactHeaders", () => {
  it("redacts Authorization header", () => {
    const headers = { Authorization: "Bearer sk-test-abc123", "Content-Type": "application/json" };
    const out = redactHeaders(headers);
    expect(out["Authorization"]).toBe("[REDACTED]");
    expect(out["Content-Type"]).toBe("application/json");
  });

  it("redacts x-api-key header", () => {
    const headers = { "x-api-key": "mykey123", Accept: "application/json" };
    const out = redactHeaders(headers);
    expect(out["x-api-key"]).toBe("[REDACTED]");
    expect(out["Accept"]).toBe("application/json");
  });

  it("redacts x-goog-api-key header (Google)", () => {
    const headers = { "x-goog-api-key": "AIza...somekey", Host: "api.google.com" };
    const out = redactHeaders(headers);
    expect(out["x-goog-api-key"]).toBe("[REDACTED]");
    expect(out["Host"]).toBe("api.google.com");
  });

  it("redacts cookie header", () => {
    const headers = { cookie: "session=abc123; csrf=xyz" };
    const out = redactHeaders(headers);
    expect(out["cookie"]).toBe("[REDACTED]");
  });
});

// ─── redactAuthHeader ─────────────────────────────────────────────────────────

describe("redactAuthHeader", () => {
  it("redacts Bearer token", () => {
    expect(redactAuthHeader("Bearer sk-test-abc123")).toBe("[REDACTED]");
  });

  it("redacts Basic auth", () => {
    expect(redactAuthHeader("Basic dXNlcjpwYXNz")).toBe("[REDACTED]");
  });

  it("does not redact non-auth values", () => {
    expect(redactAuthHeader("application/json")).toBe("application/json");
  });
});

// ─── Security: output must not contain original credentials ──────────────────

describe("security: output never contains original credentials", () => {
  const cases = [
    "postgres://user:s3cr3t@db.prod.example.com:5432/mydb",
    "mysql://admin:P@ssw0rd!@10.0.0.5:3306/prod",
    "https://apiuser:apipassword@example.com/endpoint",
    "mongodb+srv://mongoUser:mongoPass@cluster0.example.net/testdb",
    "redis://default:redis_secret_pw@redis.internal:6379",
  ];

  const credentials = [
    "s3cr3t", "user", "P@ssw0rd!", "admin", "apipassword", "apiuser",
    "mongoPass", "mongoUser", "redis_secret_pw",
  ];

  for (const input of cases) {
    it(`does not expose credentials from: ${input.slice(0, 30)}...`, () => {
      const out = redactString(input);
      for (const cred of credentials) {
        expect(out).not.toContain(cred);
      }
    });

    it(`redactErrorMessage does not expose credentials from: ${input.slice(0, 30)}...`, () => {
      const msg = `Connection failed: ${input}`;
      const out = redactErrorMessage(msg);
      for (const cred of credentials) {
        expect(out).not.toContain(cred);
      }
    });
  }

  it("Google API key must not appear in output when passed through redactHeaders", () => {
    const key = "AIzaSyTestKeyThatShouldNeverAppear12345678";
    const out = redactHeaders({ "x-goog-api-key": key });
    expect(out["x-goog-api-key"]).not.toContain(key);
    expect(out["x-goog-api-key"]).toBe("[REDACTED]");
  });

  it("Bearer token must not appear in error message output", () => {
    const token = "Bearer sk-ant-api03-" + "X".repeat(50);
    const msg = `Request failed with Authorization: ${token}`;
    const out = redactErrorMessage(msg);
    expect(out).not.toContain("sk-ant-api03");
  });
});
