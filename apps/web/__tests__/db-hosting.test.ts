import { describe, expect, it } from "vitest";

import {
  DB_HOSTING,
  detectHosting,
  detectPoolingMode,
  hostingEntry,
  hostingFor,
  POOLING_LABEL,
  type PoolingMode,
} from "~/content/integrations";

/**
 * The connect dialog reads a pasted connection string so the user does not have
 * to answer questions their own clipboard already answered.
 *
 * Getting this wrong is not cosmetic. The mode decides whether the server sends
 * `prepareThreshold=0`, and a connection wrongly marked direct fails on its
 * FIFTH run with `prepared statement "S_1" already exists` — days after anyone
 * was looking at this screen.
 */
describe("hosting detection", () => {
  it("names the vendor from the hostname", () => {
    const cases: [string, "postgres" | "mysql", string][] = [
      ["postgresql://u:p@aws-0-eu-west-2.pooler.supabase.com:5432/postgres", "postgres", "supabase"],
      ["postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres", "postgres", "supabase"],
      ["postgresql://u:p@ep-cool-dawn-1.eu-central-1.aws.neon.tech/neondb", "postgres", "neon"],
      ["postgres://avnadmin:p@pg-1a2b.a.aivencloud.com:23861/defaultdb", "postgres", "aiven_postgresql"],
      ["mysql://avnadmin:p@mysql-1a2b.a.aivencloud.com:23861/defaultdb", "mysql", "aiven_mysql"],
      ["mysql://u:p@aws.connect.psdb.cloud/app", "mysql", "planetscale"],
      ["postgresql://u:p@shop.abc.eu-west-1.rds.amazonaws.com:5432/app", "postgres", "rds_postgresql"],
      ["mysql://u:p@shop.abc.eu-west-1.rds.amazonaws.com:3306/app", "mysql", "rds_mysql"],
      ["postgresql://u:p@srv.postgres.database.azure.com:5432/app", "postgres", "azure_postgresql"],
      ["mysql://u:p@srv.mysql.database.azure.com:3306/app", "mysql", "azure_mysql"],
      ["mysql://u:p@gateway01.eu-central-1.prod.aws.tidbcloud.com:4000/test", "mysql", "tidb"],
    ];
    for (const [url, wire, expected] of cases) {
      expect(detectHosting(url, wire)?.id, url).toBe(expected);
    }
  });

  it("survives a password containing the characters a URL parser chokes on", () => {
    /* `new URL()` returns a null host for several of these, which is exactly
       why the host is read by splitting on the LAST `@`. The same reasoning is
       written out at length in ConnectionUrl.kt on the server, where seven of
       nine realistic passwords failed to parse. */
    for (const password of ["p@ss/word", "p#ss", "p?ss", "pa ss", "p:ss", "[pass]"]) {
      const url = `postgresql://postgres.abc:${password}@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`;
      expect(detectHosting(url, "postgres")?.id, password).toBe("supabase");
    }
  });

  it("says nothing about an unrecognised host rather than guessing", () => {
    expect(detectHosting("postgresql://u:p@db.internal.acme.corp:5432/app", "postgres")).toBeNull();
    expect(detectHosting("", "postgres")).toBeNull();
    expect(detectHosting("not-a-url", "mysql")).toBeNull();
  });

  it("never returns a hosting option from the other wire protocol", () => {
    // `*.rds.amazonaws.com` matches both RDS entries. Returning the Postgres one
    // for a MySQL connection would offer the wrong port and the wrong guidance.
    expect(detectHosting("mysql://u:p@x.abc.eu-west-1.rds.amazonaws.com:3306/a", "mysql")?.wire).toBe("mysql");
    expect(detectHosting("postgresql://u:p@x.abc.eu-west-1.rds.amazonaws.com:5432/a", "postgres")?.wire)
      .toBe("postgres");
  });
});

describe("pooling mode detection", () => {
  it("reads Supabase's mode off the port", () => {
    const supabase = hostingEntry("supabase")!;
    expect(
      detectPoolingMode("postgresql://u:p@aws-0-eu-west-2.pooler.supabase.com:6543/postgres", supabase),
    ).toBe("transaction_pooler");
    expect(
      detectPoolingMode("postgresql://u:p@aws-0-eu-west-2.pooler.supabase.com:5432/postgres", supabase),
    ).toBe("session_pooler");
    expect(detectPoolingMode("postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres", supabase)).toBe("direct");
  });

  it("reads Neon's mode off the -pooler suffix", () => {
    const neon = hostingEntry("neon")!;
    expect(detectPoolingMode("postgresql://u:p@ep-a-1-pooler.eu-central-1.aws.neon.tech/db", neon))
      .toBe("transaction_pooler");
    expect(detectPoolingMode("postgresql://u:p@ep-a-1.eu-central-1.aws.neon.tech/db", neon)).toBe("direct");
  });

  it("recognises an RDS Proxy endpoint", () => {
    const rds = hostingEntry("rds_postgresql")!;
    expect(detectPoolingMode("postgresql://u:p@app.proxy-abc.eu-west-1.rds.amazonaws.com:5432/a", rds))
      .toBe("transaction_pooler");
    expect(detectPoolingMode("postgresql://u:p@app.abc.eu-west-1.rds.amazonaws.com:5432/a", rds)).toBe("direct");
  });

  it("returns null rather than guessing when the product does not say", () => {
    expect(detectPoolingMode("postgresql://u:p@db.acme.corp:5432/app", hostingEntry("postgresql")!)).toBeNull();
    expect(detectPoolingMode("postgresql://u:p@db.acme.corp:5432/app", null)).toBeNull();
  });
});

describe("the hosting catalogue itself", () => {
  it("offers at least one mode per entry, and every mode has a note", () => {
    // The note IS the feature. A mode picker with unexplained options makes the
    // user pick at random, which is worse than not asking.
    for (const entry of DB_HOSTING) {
      expect(entry.modes.length, entry.id).toBeGreaterThan(0);
      for (const mode of entry.modes) {
        expect(entry.modeNotes[mode], `${entry.id}/${mode}`).toBeTruthy();
      }
    }
  });

  it("has a generic self-hosted entry first for each wire, so enterprise is never a special case", () => {
    expect(hostingFor("postgres")[0].id).toBe("postgresql");
    expect(hostingFor("mysql")[0].id).toBe("mysql");
  });

  it("uses unique ids", () => {
    const ids = DB_HOSTING.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("labels every pooling mode", () => {
    const modes: PoolingMode[] = ["direct", "session_pooler", "transaction_pooler"];
    for (const mode of modes) expect(POOLING_LABEL[mode]).toBeTruthy();
  });
});
