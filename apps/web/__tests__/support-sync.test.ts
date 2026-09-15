const ticket = {
  id: "t1",
  ticket_number: "VB-A83K2P",
  subject: "Run stuck",
  message: "It never moves.",
  status: "OPEN",
  user_email: "ada@acme.com",
  user_name: "Ada",
  helpdesk_ref: null,
};

vi.mock("@/lib/server/email", () => ({
  sendEmail: vi.fn(async () => ({ ok: true, provider: "test" })),
  emailConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/server/support", () => ({
  addMessage: vi.fn(async (input: { body: string; authorType: string }) => ({ id: "m1", ...input, created_at: "now" })),
  getSupportAdminEmails: vi.fn(() => ["ops@vectorbea.com"]),
  getTicketByHelpdeskRef: vi.fn(async () => null),
  getTicketByNumber: vi.fn(async (n: string) => (n === "VB-A83K2P" ? { ...ticket } : null)),
  listMessages: vi.fn(async () => []),
  setHelpdeskRef: vi.fn(async () => undefined),
  setTicketStatus: vi.fn(async (_id: string, status: string) => ({ ...ticket, status })),
  supportLog: vi.fn(),
  appBaseUrl: () => "https://x.test",
}));

vi.mock("@/lib/server/support-mail", () => ({
  notifyCustomer: vi.fn(async () => undefined),
  supportInboundAddress: () => "support@vectorbea.com",
  buildAdminCommentEmail: () => ({ subject: "s", text: "t", html: "h" }),
}));

vi.mock("@/lib/server/support-spiceworks", () => ({
  spiceworksAddress: () => "help@acme.on.spiceworks.com",
  spiceworksStatus: vi.fn(() => ({ enabled: true })),
  forwardCommentToSpiceworks: vi.fn(async () => true),
}));

import { sendEmail } from "@/lib/server/email";
import { addMessage, listMessages, setHelpdeskRef, setTicketStatus } from "@/lib/server/support";
import { notifyCustomer } from "@/lib/server/support-mail";
import { forwardCommentToSpiceworks, spiceworksStatus } from "@/lib/server/support-spiceworks";
import { customerComment, processInboundEmail } from "@/lib/server/support-sync";
import type { InboundEmail } from "@/lib/server/support-inbound";
import type { SupportTicket } from "@/lib/server/support";

function mail(over: Partial<InboundEmail>): InboundEmail {
  return {
    fromEmail: "help@acme.on.spiceworks.com", fromName: "Grace", subject: "[Ticket #412] [VB-A83K2P] Run stuck",
    text: "", stripped: false, messageId: "<m@x>", headers: {}, ...over,
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("processInboundEmail", () => {
  it("closes the ticket and sends the customer one email for comment and status", async () => {
    const result = await processInboundEmail(mail({ text: "Ticket #412 has been closed.\n\nWe rotated the token." }));
    expect(result).toEqual({ outcome: "support", ticketNumber: "VB-A83K2P" });
    expect(setHelpdeskRef).toHaveBeenCalledWith("t1", "412");
    expect(setTicketStatus).toHaveBeenCalledWith("t1", "RESOLVED", "Spiceworks");
    expect(notifyCustomer).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyCustomer).mock.calls[0]![1]).toEqual({
      kind: "comment", body: "We rotated the token.\n\nThis report is now marked resolved.", authorName: "Grace",
    });
  });

  it("records a status-only change as a system line", async () => {
    await processInboundEmail(mail({ text: "Your ticket #412 has been closed." }));
    expect(vi.mocked(addMessage).mock.calls[0]![0]).toMatchObject({ authorType: "system", body: "Marked resolved." });
    expect(vi.mocked(notifyCustomer).mock.calls[0]![1]).toEqual({ kind: "status", status: "RESOLVED" });
  });

  it("learns the reference from a creation notice without telling the customer", async () => {
    const result = await processInboundEmail(mail({ text: "Your ticket #412 has been created.\n\nIt never moves." }));
    expect(result.outcome).toBe("ignored");
    expect(setHelpdeskRef).toHaveBeenCalledWith("t1", "412");
    expect(addMessage).not.toHaveBeenCalled();
    expect(notifyCustomer).not.toHaveBeenCalled();
  });

  it("does not send the customer their own forwarded comment back", async () => {
    vi.mocked(listMessages).mockResolvedValueOnce([{ author_type: "customer", body: "Still  stuck." }] as never);
    const result = await processInboundEmail(mail({ text: "Comment from Ada <ada@acme.com>:\n\nStill stuck." }));
    expect(result.outcome).toBe("ignored");
    expect(notifyCustomer).not.toHaveBeenCalled();
  });

  it("does nothing twice for a redelivered message", async () => {
    vi.mocked(addMessage).mockResolvedValueOnce(null);
    const result = await processInboundEmail(mail({ text: "Looking now." }));
    expect(result.outcome).toBe("duplicate");
    expect(setTicketStatus).not.toHaveBeenCalled();
    expect(notifyCustomer).not.toHaveBeenCalled();
  });

  it("passes a customer's emailed reply to the help desk", async () => {
    const result = await processInboundEmail(mail({ fromEmail: "ada@acme.com", subject: "Re: [VB-A83K2P] Run stuck", text: "Still stuck." }));
    expect(result.outcome).toBe("customer");
    expect(forwardCommentToSpiceworks).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), "Still stuck.");
  });
});

describe("customerComment", () => {
  it("reopens a resolved ticket and delivers later", async () => {
    const saved = await customerComment({ ...ticket, status: "RESOLVED" } as SupportTicket, "Back again", "app");
    expect(setTicketStatus).toHaveBeenCalledWith("t1", "OPEN", null);
    expect(saved?.ticket.status).toBe("OPEN");
    expect(forwardCommentToSpiceworks).not.toHaveBeenCalled();
    await saved!.deliver();
    expect(forwardCommentToSpiceworks).toHaveBeenCalledTimes(1);
  });

  it("emails the support admins when no help desk is connected", async () => {
    vi.mocked(spiceworksStatus).mockReturnValueOnce({ enabled: false } as ReturnType<typeof spiceworksStatus>);
    const saved = await customerComment(ticket as SupportTicket, "Hello", "app");
    await saved!.deliver();
    expect(forwardCommentToSpiceworks).not.toHaveBeenCalled();
    expect(vi.mocked(sendEmail).mock.calls[0]![0]).toMatchObject({ to: "ops@vectorbea.com" });
  });
});
