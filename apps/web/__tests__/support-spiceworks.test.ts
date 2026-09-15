vi.mock("@/lib/server/email", () => ({
  sendEmail: vi.fn(async () => ({ ok: true, provider: "test" })),
  emailConfigured: vi.fn(() => true),
}));

import { emailConfigured } from "@/lib/server/email";
import { buildSpiceworksEmail, spiceworksStatus } from "@/lib/server/support-spiceworks";

const ticket = {
  ticket_number: "VB-A83K2P",
  subject: "Run stuck at approval gate",
  message: "It says <script>alert(1)</script> and never moves.",
  priority: "HIGH" as const,
  category: "workflow_failure",
  user_email: "ada@acme.com",
  user_name: "Ada Lovelace",
  tenant_name: "Acme",
  created_at: "2026-09-15T10:00:00Z",
};

describe("buildSpiceworksEmail", () => {
  it("leads with the Vectorbea ticket number and names the requester", () => {
    const mail = buildSpiceworksEmail(ticket, "https://dev.vectorbea.com");
    expect(mail.subject).toBe("[VB-A83K2P] Run stuck at approval gate");
    expect(mail.replyTo).toBe("ada@acme.com");
    expect(mail.text).toContain("Requester: Ada Lovelace <ada@acme.com>");
    expect(mail.text).toContain("Priority: High");
    expect(mail.text).toContain("Category: workflow failure");
    expect(mail.text).toContain("https://dev.vectorbea.com/support?ticket=VB-A83K2P");
  });

  it("escapes the customer's text in the HTML part", () => {
    const mail = buildSpiceworksEmail(ticket, "https://dev.vectorbea.com");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});

describe("spiceworksStatus", () => {
  afterEach(() => { delete process.env.SPICEWORKS_HELPDESK_EMAIL; });

  it("is off, with the fix, when no address is set", () => {
    const status = spiceworksStatus();
    expect(status.enabled).toBe(false);
    expect(status.problem).toContain("SPICEWORKS_HELPDESK_EMAIL");
  });

  it("refuses an address that is not an email, and needs an email provider", () => {
    process.env.SPICEWORKS_HELPDESK_EMAIL = "not-an-address";
    expect(spiceworksStatus().problem).toContain("not a valid email");

    process.env.SPICEWORKS_HELPDESK_EMAIL = "help@acme.on.spiceworks.com";
    vi.mocked(emailConfigured).mockReturnValueOnce(false);
    expect(spiceworksStatus()).toMatchObject({ enabled: false, address: "help@acme.on.spiceworks.com" });
    expect(spiceworksStatus()).toMatchObject({ enabled: true, problem: null });
  });
});
