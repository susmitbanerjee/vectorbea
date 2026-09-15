/**
 * Support API — authorization + orchestration tests for the route handlers.
 * DB and email are mocked; the real authorization helpers run against env.
 */

// ── Mocks (hoisted) ───────────────────────────────────────────────────────────
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/auth/server", () => ({ getAuthenticatedUserFromCookies: vi.fn() }));
vi.mock("@/lib/auth/neon-auth", () => ({
  getUserById: vi.fn(async () => ({ id: "u1", email: "user@acme.com", full_name: "Ada Lovelace", avatar_url: null })),
  getUserWorkspaces: vi.fn(async () => [{ id: "ws1", name: "Acme", slug: "acme", role: "owner" }]),
}));
vi.mock("@/lib/server/email", () => ({
  sendEmail: vi.fn(async () => ({ ok: true, provider: "test" })),
  emailConfigured: () => true,
}));
vi.mock("@/lib/server/support", async (orig) => {
  const actual = await orig<typeof import("@/lib/server/support")>();
  return {
    ...actual, // keep real isSupportAdmin, getSupportAdminEmails, builders, constants
    createTicket: vi.fn(),
    listTickets: vi.fn(),
    getTicketByNumber: vi.fn(),
    resolveTicket: vi.fn(),
    reopenTicket: vi.fn(),
    listTicketsForUser: vi.fn(),
    recordForward: vi.fn(async () => null),
    listMessages: vi.fn(async () => []),
    getTicketForUser: vi.fn(),
  };
});
vi.mock("@/lib/server/support-sync", () => ({
  portalStatusChanged: vi.fn(async () => undefined),
  customerComment: vi.fn(),
}));

import { NextRequest } from "next/server";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { sendEmail } from "@/lib/server/email";
import * as support from "@/lib/server/support";
import { POST as supportPOST } from "@/app/api/support/route";
import { GET as adminListGET } from "@/app/api/support/admin/tickets/route";
import { GET as adminDetailGET, PATCH as adminPATCH } from "@/app/api/support/admin/tickets/[ticketNumber]/route";
import { GET as ownTicketGET } from "@/app/api/support/tickets/[ticketNumber]/route";
import { POST as commentPOST } from "@/app/api/support/tickets/[ticketNumber]/messages/route";
import { customerComment, portalStatusChanged } from "@/lib/server/support-sync";

const ADMIN = { id: "admin-1", email: "admin@vectorbea.com" };
const NON_ADMIN = { id: "u1", email: "user@acme.com" };

const asUser = (u: typeof ADMIN | null) =>
  vi.mocked(getAuthenticatedUserFromCookies).mockResolvedValue(u as never);

function sampleTicket(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "t1", ticket_number: "VB-A83K2P", tenant_id: "ws1", tenant_name: "Acme",
    user_id: "u1", user_email: "user@acme.com", user_name: "Ada Lovelace",
    subject: "Workflow execution stuck", message: "Run stuck for 20 minutes.",
    status: "OPEN", priority: "NORMAL", category: "bug", admin_note: null,
    resolved_by: null, created_at: "2026-08-10T00:00:00Z", updated_at: "2026-08-10T00:00:00Z",
    resolved_at: null, ...over,
  };
}

beforeAll(() => { process.env.SUPPORT_ADMIN_EMAILS = "admin@vectorbea.com"; });
beforeEach(() => { vi.clearAllMocks(); });

// ── Customer: POST /api/support ───────────────────────────────────────────────
describe("POST /api/support", () => {
  const post = (body: unknown) =>
    supportPOST(new NextRequest("http://localhost/api/support", { method: "POST", body: JSON.stringify(body) }));

  it("rejects unauthenticated requests with 401", async () => {
    asUser(null);
    const res = await post({ subject: "Something broke", message: "please help me out" });
    expect(res.status).toBe(401);
    expect(support.createTicket).not.toHaveBeenCalled();
  });

  it("creates a ticket, defaults to OPEN, and notifies the admin", async () => {
    asUser(NON_ADMIN);
    vi.mocked(support.createTicket).mockResolvedValue(sampleTicket() as never);

    const res = await post({ subject: "Workflow execution stuck", message: "Run has been running for 20 minutes.", severity: "high", category: "workflow_failure" });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.ticket.ticketNumber).toBe("VB-A83K2P");
    expect(json.ticket.status).toBe("OPEN");

    // Identity captured from the session; status left to the DB default.
    expect(support.createTicket).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(support.createTicket).mock.calls[0]![0];
    expect(arg).toMatchObject({ userEmail: "user@acme.com", userName: "Ada Lovelace", tenantId: "ws1", tenantName: "Acme", priority: "HIGH" });
    expect(arg).not.toHaveProperty("status");

    // Email notification invoked (best-effort, after persistence).
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(mail.to).toBe("admin@vectorbea.com");
    expect(mail.text).toContain("/support?ticket=VB-A83K2P");
    expect(mail.text).not.toContain("support.vectorbea.com");
  });

  it("forwards to Spiceworks instead of emailing admins when a help desk is configured", async () => {
    process.env.SPICEWORKS_HELPDESK_EMAIL = "help@acme.on.spiceworks.com";
    try {
      asUser(NON_ADMIN);
      vi.mocked(support.createTicket).mockResolvedValue(sampleTicket() as never);

      const res = await post({ subject: "Workflow execution stuck", message: "Run has been running for 20 minutes.", severity: "high" });
      expect(res.status).toBe(201);
      await vi.waitFor(() => expect(support.recordForward).toHaveBeenCalledTimes(1));

      expect(sendEmail).toHaveBeenCalledTimes(1);
      const mail = vi.mocked(sendEmail).mock.calls[0]![0];
      expect(mail.to).toBe("help@acme.on.spiceworks.com");
      expect(mail.replyTo).toBe("user@acme.com");
      expect(mail.subject).toBe("[VB-A83K2P] Workflow execution stuck");
      expect(mail.text).toContain("Requester: Ada Lovelace <user@acme.com>");
      expect(vi.mocked(support.recordForward).mock.calls[0]![1]).toMatchObject({ status: "sent", error: null });
    } finally {
      delete process.env.SPICEWORKS_HELPDESK_EMAIL;
    }
  });

  it("validates subject/message length", async () => {
    asUser(NON_ADMIN);
    const res = await post({ subject: "x", message: "short" });
    expect(res.status).toBe(400);
    expect(support.createTicket).not.toHaveBeenCalled();
  });
});

// ── Admin: GET /api/support/admin/tickets ─────────────────────────────────────
describe("GET /api/support/admin/tickets", () => {
  const list = () => adminListGET(new NextRequest("http://localhost/api/support/admin/tickets?filter=all"));

  it("returns 401 when unauthenticated", async () => {
    asUser(null);
    expect((await list()).status).toBe(401);
    expect(support.listTickets).not.toHaveBeenCalled();
  });

  it("returns 403 for an authenticated non-admin", async () => {
    asUser(NON_ADMIN);
    expect((await list()).status).toBe(403);
    expect(support.listTickets).not.toHaveBeenCalled();
  });

  it("returns tickets for a support admin", async () => {
    asUser(ADMIN);
    vi.mocked(support.listTickets).mockResolvedValue({ tickets: [sampleTicket() as never], total: 1, openCount: 1 });
    const res = await list();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.tickets).toHaveLength(1);
    expect(json.openCount).toBe(1);
  });
});

// ── Admin: GET /api/support/admin/tickets/{ticketNumber} ──────────────────────
describe("GET /api/support/admin/tickets/{ticketNumber}", () => {
  const detail = () =>
    adminDetailGET(new NextRequest("http://localhost/api/support/admin/tickets/VB-A83K2P"), { params: Promise.resolve({ ticketNumber: "VB-A83K2P" }) });

  it("returns 403 for a non-admin", async () => {
    asUser(NON_ADMIN);
    expect((await detail()).status).toBe(403);
    expect(support.getTicketByNumber).not.toHaveBeenCalled();
  });

  it("returns the ticket for an admin", async () => {
    asUser(ADMIN);
    vi.mocked(support.getTicketByNumber).mockResolvedValue(sampleTicket() as never);
    const res = await detail();
    expect(res.status).toBe(200);
    expect((await res.json()).ticket.ticket_number).toBe("VB-A83K2P");
  });

  it("returns 404 when the ticket is missing", async () => {
    asUser(ADMIN);
    vi.mocked(support.getTicketByNumber).mockResolvedValue(null);
    expect((await detail()).status).toBe(404);
  });
});

// ── Admin: PATCH resolve / reopen ─────────────────────────────────────────────
describe("PATCH /api/support/admin/tickets/{ticketNumber}", () => {
  const patch = (body: unknown) =>
    adminPATCH(
      new NextRequest("http://localhost/api/support/admin/tickets/VB-A83K2P", { method: "PATCH", body: JSON.stringify(body) }),
      { params: Promise.resolve({ ticketNumber: "VB-A83K2P" }) },
    );

  it("rejects unauthenticated with 401", async () => {
    asUser(null);
    expect((await patch({ action: "resolve" })).status).toBe(401);
    expect(support.resolveTicket).not.toHaveBeenCalled();
  });

  it("rejects a non-admin with 403", async () => {
    asUser(NON_ADMIN);
    expect((await patch({ action: "resolve" })).status).toBe(403);
    expect(support.resolveTicket).not.toHaveBeenCalled();
  });

  it("resolves a ticket, recording the admin identity", async () => {
    asUser(ADMIN);
    vi.mocked(support.getTicketByNumber).mockResolvedValue(sampleTicket({ status: "OPEN" }) as never);
    vi.mocked(support.resolveTicket).mockResolvedValue(
      sampleTicket({ status: "RESOLVED", resolved_by: "admin@vectorbea.com", resolved_at: "2026-08-10T01:00:00Z", admin_note: "Fixed the connection." }) as never,
    );
    const res = await patch({ action: "resolve", adminNote: "Fixed the connection." });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(support.resolveTicket).toHaveBeenCalledWith("VB-A83K2P", { resolvedBy: "admin@vectorbea.com", adminNote: "Fixed the connection." });
    expect(json.ticket.status).toBe("RESOLVED");
    expect(json.ticket.resolved_by).toBe("admin@vectorbea.com");
    expect(json.ticket.resolved_at).toBeTruthy();
    await vi.waitFor(() => expect(portalStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ status: "RESOLVED" }), "RESOLVED", "Fixed the connection.",
    ));
  });

  it("reopens a resolved ticket", async () => {
    asUser(ADMIN);
    vi.mocked(support.getTicketByNumber).mockResolvedValue(sampleTicket({ status: "RESOLVED" }) as never);
    vi.mocked(support.reopenTicket).mockResolvedValue(sampleTicket({ status: "OPEN" }) as never);
    const res = await patch({ action: "reopen" });
    expect(res.status).toBe(200);
    expect(support.reopenTicket).toHaveBeenCalledWith("VB-A83K2P", { adminNote: undefined });
    expect((await res.json()).ticket.status).toBe("OPEN");
  });

  it("does not email the customer when the status did not change", async () => {
    asUser(ADMIN);
    vi.mocked(portalStatusChanged).mockClear();
    vi.mocked(support.getTicketByNumber).mockResolvedValue(sampleTicket({ status: "RESOLVED" }) as never);
    vi.mocked(support.resolveTicket).mockResolvedValue(sampleTicket({ status: "RESOLVED" }) as never);
    expect((await patch({ action: "resolve" })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(portalStatusChanged).not.toHaveBeenCalled();
  });

  it("rejects an invalid action with 400", async () => {
    asUser(ADMIN);
    expect((await patch({ action: "delete" })).status).toBe(400);
  });
});

// ── Customer: own ticket and comments ─────────────────────────────────────────
describe("customer ticket routes", () => {
  const params = { params: Promise.resolve({ ticketNumber: "VB-A83K2P" }) };
  const view = () => ownTicketGET(new NextRequest("http://localhost/api/support/tickets/VB-A83K2P"), params);
  const comment = (body: unknown) =>
    commentPOST(new NextRequest("http://localhost/api/support/tickets/VB-A83K2P/messages", { method: "POST", body: JSON.stringify(body) }), params);

  it("only shows a report to the user who filed it", async () => {
    asUser(NON_ADMIN);
    vi.mocked(support.getTicketForUser).mockResolvedValue(null);
    expect((await view()).status).toBe(404);
    expect(vi.mocked(support.getTicketForUser).mock.calls.at(-1)).toEqual(["VB-A83K2P", NON_ADMIN.id]);
  });

  it("returns the report and its conversation without internal fields", async () => {
    asUser(NON_ADMIN);
    vi.mocked(support.getTicketForUser).mockResolvedValue(sampleTicket() as never);
    vi.mocked(support.listMessages).mockResolvedValue([
      { id: "m1", ticket_id: "t", author_type: "support", author_name: "Grace", author_email: "grace@it.com", body: "On it", source: "helpdesk", external_message_id: "<x>", created_at: "2026-08-10T01:00:00Z" },
    ]);
    const json = await (await view()).json();
    expect(json.ticket.ticket_number).toBe("VB-A83K2P");
    expect(json.ticket).not.toHaveProperty("forward_error");
    expect(json.messages[0]).toEqual({ id: "m1", author_type: "support", author_name: "Grace", body: "On it", created_at: "2026-08-10T01:00:00Z" });
  });

  it("saves a comment and returns the new status", async () => {
    asUser(NON_ADMIN);
    vi.mocked(support.getTicketForUser).mockResolvedValue(sampleTicket({ status: "RESOLVED" }) as never);
    const deliver = vi.fn(async () => undefined);
    vi.mocked(customerComment).mockResolvedValue({
      message: { id: "m2", author_type: "customer", author_name: "Ada", body: "Still broken", created_at: "now" },
      ticket: sampleTicket({ status: "OPEN" }),
      deliver,
    } as never);
    const res = await comment({ body: "Still broken" });
    expect(res.status).toBe(201);
    expect((await res.json()).status).toBe("OPEN");
    await vi.waitFor(() => expect(deliver).toHaveBeenCalled());
  });

  it("rejects an empty comment", async () => {
    asUser(NON_ADMIN);
    expect((await comment({ body: " " })).status).toBe(400);
  });
});
