/**
 * Support portal — authorization, ticket-number, priority, and email tests.
 * Pure functions from lib/server/support.ts; no DB calls.
 */
import {
  isSupportAdmin, getSupportAdminEmails, generateTicketNumber,
  mapSeverityToPriority, buildAdminNotificationEmail, LIMITS,
} from "../lib/server/support";

const ENV_KEYS = ["SUPPORT_ADMIN_EMAILS", "SUPPORT_EMAIL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("support-admin allow-list", () => {
  it("parses SUPPORT_ADMIN_EMAILS (comma-separated, normalized, deduped)", () => {
    process.env.SUPPORT_ADMIN_EMAILS = "  Admin@Vectorbea.com , second@x.com, admin@vectorbea.com ";
    expect(getSupportAdminEmails()).toEqual(["admin@vectorbea.com", "second@x.com"]);
  });

  it("falls back to legacy SUPPORT_EMAIL when the list is unset", () => {
    process.env.SUPPORT_EMAIL = "Legacy@Vectorbea.com";
    expect(getSupportAdminEmails()).toEqual(["legacy@vectorbea.com"]);
  });

  it("defaults to the initial support admins when nothing is configured", () => {
    expect(getSupportAdminEmails()).toEqual(["susmit.b1@gmail.com", "susmit@vectorbea.com"]);
  });
});

describe("isSupportAdmin", () => {
  beforeEach(() => { process.env.SUPPORT_ADMIN_EMAILS = "susmit.b1@gmail.com,susmit@vectorbea.com"; });

  it("authorizes configured admins case-insensitively", () => {
    expect(isSupportAdmin("susmit.b1@gmail.com")).toBe(true);
    expect(isSupportAdmin("SUSMIT@VECTORBEA.COM")).toBe(true);
    expect(isSupportAdmin("  susmit@vectorbea.com  ")).toBe(true);
  });

  it("rejects non-admins and empty/nullish emails", () => {
    expect(isSupportAdmin("someone@acme.com")).toBe(false);
    expect(isSupportAdmin("")).toBe(false);
    expect(isSupportAdmin(null)).toBe(false);
    expect(isSupportAdmin(undefined)).toBe(false);
  });
});

describe("generateTicketNumber", () => {
  it("matches the VB-XXXXXX format with an unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const n = generateTicketNumber();
      expect(n).toMatch(/^VB-[A-HJ-NP-Z2-9]{6}$/); // no 0,1,I,O
    }
  });

  it("is effectively unique across a large sample", () => {
    const sample = 500;
    const seen = new Set<string>();
    for (let i = 0; i < sample; i++) seen.add(generateTicketNumber());
    expect(seen.size).toBeGreaterThanOrEqual(sample - 2);
  });
});

describe("mapSeverityToPriority", () => {
  it("maps widget severities onto LOW/NORMAL/HIGH", () => {
    expect(mapSeverityToPriority("low")).toBe("LOW");
    expect(mapSeverityToPriority("medium")).toBe("NORMAL");
    expect(mapSeverityToPriority("high")).toBe("HIGH");
    expect(mapSeverityToPriority("critical")).toBe("HIGH");
    expect(mapSeverityToPriority(undefined)).toBe("NORMAL");
    expect(mapSeverityToPriority("nonsense")).toBe("NORMAL");
  });
});

describe("buildAdminNotificationEmail", () => {
  const ticket = {
    ticket_number: "VB-A83K2P",
    user_email: "user@example.com",
    user_name: "Ada Lovelace",
    tenant_name: "Acme",
    priority: "HIGH" as const,
    subject: "Workflow execution stuck",
    message: "Run has been in running state for 20 minutes.",
  };

  it("deep-links to /support?ticket=<number> using the given base URL", () => {
    const mail = buildAdminNotificationEmail(ticket, "https://app.vectorbea.com");
    const link = "https://app.vectorbea.com/support?ticket=VB-A83K2P";
    expect(mail.html).toContain(link);
    expect(mail.text).toContain(link);
  });

  it("no longer references support.vectorbea.com", () => {
    const mail = buildAdminNotificationEmail(ticket, "https://app.vectorbea.com");
    expect(mail.html).not.toContain("support.vectorbea.com");
    expect(mail.text).not.toContain("support.vectorbea.com");
    expect(mail.subject).not.toContain("support.vectorbea.com");
  });

  it("carries ticket, subject and priority; escapes customer HTML", () => {
    const mail = buildAdminNotificationEmail(
      { ...ticket, subject: "<script>alert(1)</script>", message: "1 < 2 & 3 > 2" },
      "https://app.vectorbea.com",
    );
    expect(mail.subject).toContain("VB".length ? "HIGH" : ""); // priority present
    expect(mail.text).toContain("VB-A83K2P");
    expect(mail.html).not.toContain("<script>alert(1)</script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("1 &lt; 2 &amp; 3 &gt; 2");
  });
});

describe("input limits", () => {
  it("enforces the documented boundaries", () => {
    expect(LIMITS.SUBJECT_MAX).toBe(200);
    expect(LIMITS.MESSAGE_MAX).toBe(10_000);
    expect(LIMITS.ADMIN_NOTE_MAX).toBe(10_000);
  });
});
