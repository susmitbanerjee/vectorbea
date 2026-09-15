vi.mock("@/lib/server/email", () => ({
  sendEmail: vi.fn(async () => ({ ok: true, provider: "test" })),
  emailConfigured: vi.fn(() => true),
}));

import { sendEmail } from "@/lib/server/email";
import {
  buildAdminCommentEmail, buildCustomerUpdateEmail, buildHelpdeskCommentEmail, notifyCustomer,
} from "@/lib/server/support-mail";
import type { SupportTicket } from "@/lib/server/support";

const ticket = {
  ticket_number: "VB-A83K2P",
  subject: "Run stuck",
  user_email: "ada@acme.com",
  user_name: "Ada Lovelace",
  helpdesk_ref: null,
} as SupportTicket;

describe("buildCustomerUpdateEmail", () => {
  it("threads on the VB number and links to the report in the app", () => {
    const mail = buildCustomerUpdateEmail(ticket, { kind: "comment", body: "Try <b>again</b>", authorName: "Grace" }, "https://dev.vectorbea.com");
    expect(mail.subject).toBe("Re: [VB-A83K2P] Run stuck");
    expect(mail.text).toContain("Hi Ada,");
    expect(mail.text).toContain("Grace replied to your report VB-A83K2P:");
    expect(mail.text).toContain("https://dev.vectorbea.com/control?support=VB-A83K2P");
    expect(mail.text).toContain("Reply to this email");
    expect(mail.html).toContain("&lt;b&gt;again&lt;/b&gt;");
  });

  it("does not invite an email reply when nothing receives it", () => {
    const mail = buildCustomerUpdateEmail(ticket, { kind: "status", status: "RESOLVED" }, "https://x.test", false);
    expect(mail.text).toContain("has been resolved");
    expect(mail.text).not.toContain("Reply to this email");
    expect(mail.html).not.toContain("Reply to this email");
  });
});

describe("notifyCustomer", () => {
  afterEach(() => { delete process.env.SUPPORT_INBOUND_ADDRESS; vi.mocked(sendEmail).mockClear(); });

  it("sends from the support mailbox with the loop header", async () => {
    process.env.SUPPORT_INBOUND_ADDRESS = "Support@Vectorbea.com";
    await notifyCustomer(ticket, { kind: "status", status: "OPEN" });
    const payload = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(payload.to).toBe("ada@acme.com");
    expect(payload.from).toBe("Vectorbea Support <support@vectorbea.com>");
    expect(payload.replyTo).toBe("support@vectorbea.com");
    expect(payload.headers).toEqual({ "X-Vectorbea-Support": "VB-A83K2P" });
  });
});

describe("help desk and admin comment emails", () => {
  it("adds the help desk's ticket number once it is known", () => {
    expect(buildHelpdeskCommentEmail(ticket, "hi").subject).toBe("Re: [VB-A83K2P] Run stuck");
    expect(buildHelpdeskCommentEmail({ ...ticket, helpdesk_ref: "412" }, "hi").subject).toBe("Re: [VB-A83K2P] Run stuck [Ticket #412]");
  });

  it("links admins to the portal", () => {
    const mail = buildAdminCommentEmail(ticket, "still broken", "https://dev.vectorbea.com");
    expect(mail.text).toContain("Comment from Ada Lovelace <ada@acme.com>:");
    expect(mail.text).toContain("https://dev.vectorbea.com/support?ticket=VB-A83K2P");
  });
});
