vi.mock("@/lib/server/support-sync", () => ({
  processInboundEmail: vi.fn(async () => ({ outcome: "customer", ticketNumber: "VB-A83K2P" })),
}));
vi.mock("@/lib/server/support", () => ({ supportLog: vi.fn() }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/support/inbound/[token]/route";
import { processInboundEmail } from "@/lib/server/support-sync";

const TOKEN = "a".repeat(32);
const call = (token: string, body: unknown, type = "application/json") =>
  POST(
    new NextRequest(`http://localhost/api/support/inbound/${token}`, {
      method: "POST", headers: { "content-type": type }, body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) },
  );

afterEach(() => { delete process.env.SUPPORT_INBOUND_TOKEN; vi.mocked(processInboundEmail).mockClear(); });

describe("POST /api/support/inbound/{token}", () => {
  it("is off until a long enough token is configured", async () => {
    expect((await call(TOKEN, {})).status).toBe(503);
    process.env.SUPPORT_INBOUND_TOKEN = "short";
    expect((await call("short", {})).status).toBe(503);
  });

  it("answers 404 to a wrong token without processing anything", async () => {
    process.env.SUPPORT_INBOUND_TOKEN = TOKEN;
    expect((await call("b".repeat(32), { from: "ada@acme.com" })).status).toBe(404);
    expect((await call("a", { from: "ada@acme.com" })).status).toBe(404);
    expect(processInboundEmail).not.toHaveBeenCalled();
  });

  it("processes a message and answers 200", async () => {
    process.env.SUPPORT_INBOUND_TOKEN = TOKEN;
    const res = await call(TOKEN, { from: "Ada <ada@acme.com>", subject: "Re: [VB-A83K2P] hi", text: "Still broken" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: "customer", ticketNumber: "VB-A83K2P" });
    expect(vi.mocked(processInboundEmail).mock.calls[0]![0]).toMatchObject({ fromEmail: "ada@acme.com", text: "Still broken" });
  });

  it("answers 200 to mail with no usable sender, so the provider does not retry", async () => {
    process.env.SUPPORT_INBOUND_TOKEN = TOKEN;
    const res = await call(TOKEN, { subject: "x" });
    expect(res.status).toBe(200);
    expect(processInboundEmail).not.toHaveBeenCalled();
  });

  it("answers 500 when processing fails, so the provider retries", async () => {
    process.env.SUPPORT_INBOUND_TOKEN = TOKEN;
    vi.mocked(processInboundEmail).mockRejectedValueOnce(new Error("db down"));
    expect((await call(TOKEN, { from: "ada@acme.com" })).status).toBe(500);
  });
});
