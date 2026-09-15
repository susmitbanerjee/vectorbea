import {
  decideInbound, helpdeskBody, helpdeskRefIn, helpdeskStatus, normaliseInbound, parseAddress,
  replyText, subjectRemainder, type InboundEmail, type SenderRules,
} from "@/lib/server/support-inbound";
import type { SupportTicket } from "@/lib/server/support";

const ticket = {
  id: "7d0c7c43-5d3b-4d7e-9c55-2a7c2f0e1a11",
  ticket_number: "VB-A83K2P",
  subject: "Connection closed unexpectedly",
  message: "The Slack connection closed and the run failed.",
  status: "OPEN",
  user_email: "ada@acme.com",
  user_name: "Ada Lovelace",
} as SupportTicket;

const rules: SenderRules = {
  helpdeskAddress: "help@acme.on.spiceworks.com",
  extraHelpdeskSenders: [],
  inboundAddress: "support@vectorbea.com",
  supportAdmins: ["ops@vectorbea.com"],
};

const lookup = {
  byNumber: async (n: string) => (n === ticket.ticket_number ? ticket : null),
  byHelpdeskRef: async (ref: string) => (ref === "412" ? ticket : null),
};

function mail(over: Partial<InboundEmail>): InboundEmail {
  return {
    fromEmail: "ada@acme.com", fromName: "Ada Lovelace", subject: `Re: [${ticket.ticket_number}] ${ticket.subject}`,
    text: "", stripped: false, messageId: "<m1@example.com>", headers: {}, ...over,
  };
}

describe("normaliseInbound", () => {
  it("reads a SendGrid Inbound Parse form post", () => {
    const form = new FormData();
    form.set("from", "Ada Lovelace <Ada@Acme.com>");
    form.set("subject", "Re: [VB-A83K2P] Connection closed unexpectedly");
    form.set("text", "Still failing.\n\nOn Mon, 14 Sep 2026 Support wrote:\n> We are looking");
    form.set("headers", "Message-ID: <abc@mail>\r\nAuto-Submitted: no\r\nX-Long: one\r\n two");
    const email = normaliseInbound({ form })!;
    expect(email.fromEmail).toBe("ada@acme.com");
    expect(email.fromName).toBe("Ada Lovelace");
    expect(email.messageId).toBe("<abc@mail>");
    expect(email.headers["x-long"]).toBe("one two");
    expect(email.stripped).toBe(false);
  });

  it("prefers Mailgun's stripped text and reads its header pairs", () => {
    const form = new FormData();
    form.set("sender", "ada@acme.com");
    form.set("subject", "Re: [VB-A83K2P] hi");
    form.set("body-plain", "Long\n> quoted");
    form.set("stripped-text", "Long");
    form.set("message-headers", JSON.stringify([["Message-Id", "<mg@mail>"]]));
    const email = normaliseInbound({ form })!;
    expect(email.text).toBe("Long");
    expect(email.stripped).toBe(true);
    expect(email.messageId).toBe("<mg@mail>");
  });

  it("reads Postmark inbound JSON", () => {
    const email = normaliseInbound({
      json: {
        From: "ada@acme.com",
        FromFull: { Email: "ada@acme.com", Name: "Ada" },
        Subject: "Re: [VB-A83K2P] hi",
        TextBody: "full",
        StrippedTextReply: "short",
        MessageID: "pm-1",
        Headers: [{ Name: "Auto-Submitted", Value: "auto-replied" }],
      },
    })!;
    expect(email.fromName).toBe("Ada");
    expect(email.text).toBe("short");
    expect(email.messageId).toBe("pm-1");
    expect(email.headers["auto-submitted"]).toBe("auto-replied");
  });

  it("reads plain JSON, falling back to HTML", () => {
    const email = normaliseInbound({
      json: { from: { email: "ada@acme.com" }, subject: "x", html: "<p>Hello&nbsp;there</p><br>Bye", message_id: "j1" },
    })!;
    expect(email.text).toBe("Hello there\n\nBye");
    expect(email.messageId).toBe("j1");
  });

  it("returns null without a usable sender", () => {
    expect(normaliseInbound({ json: { subject: "x", text: "y" } })).toBeNull();
    expect(parseAddress("not an address")).toBeNull();
  });
});

describe("replyText", () => {
  it("keeps only the new part of a reply", () => {
    expect(replyText("Still broken.\n\nOn Mon, 14 Sep 2026 at 10:00, Support <s@x.com> wrote:\n> Try again")).toBe("Still broken.");
    expect(replyText("Thanks\n-----Original Message-----\nFrom: x")).toBe("Thanks");
    expect(replyText("Done\nSent from my iPhone")).toBe("Done");
    expect(replyText("Top\nOn Mon, 14 Sep 2026 Support\n<s@x.com> wrote:\n> old")).toBe("Top");
  });
});

describe("help desk status and body", () => {
  it("ignores status words in the customer's own subject", () => {
    const rest = subjectRemainder("[Ticket #412] Re: [VB-A83K2P] Connection closed unexpectedly", ticket.subject);
    expect(rest).toBe("");
    expect(helpdeskStatus(rest, "We restarted the worker.")).toBeNull();
  });

  it("reads the status from what the help desk added to the subject", () => {
    const rest = subjectRemainder("Ticket #412 resolved: [VB-A83K2P] Connection closed unexpectedly", ticket.subject);
    expect(helpdeskStatus(rest, "")).toBe("RESOLVED");
    expect(helpdeskStatus("reopened", "")).toBe("OPEN");
  });

  it("only counts sentences about the ticket in the body", () => {
    expect(helpdeskStatus("", "Your ticket #412 has been closed.")).toBe("RESOLVED");
    expect(helpdeskStatus("", "Status: resolved")).toBe("RESOLVED");
    expect(helpdeskStatus("", "Ticket #412 has been reopened.")).toBe("OPEN");
    expect(helpdeskStatus("", "I closed the old connection and resolved the DNS issue.")).toBeNull();
    expect(helpdeskStatus("", "Status: your connection closed")).toBeNull();
  });

  it("strips the announcement and footer, and drops a quoted original", () => {
    expect(helpdeskBody(
      "Ticket #412 has been closed.\n\nWe rotated the token.\n\nView ticket\nhttps://acme.on.spiceworks.com/tickets/412\nPowered by Spiceworks",
      ticket.message,
    )).toBe("We rotated the token.");
    expect(helpdeskBody("Your ticket #412 has been created.\n\nThe Slack connection closed and the run failed.", ticket.message)).toBe("");
  });

  it("finds the help desk's own ticket number", () => {
    expect(helpdeskRefIn("[Ticket #412] Re: hi")).toBe("412");
    expect(helpdeskRefIn("Re: hi [#88]")).toBe("88");
    expect(helpdeskRefIn("Re: hi")).toBeNull();
  });
});

describe("decideInbound", () => {
  it("drops our own mail by its header", async () => {
    const d = await decideInbound(mail({ headers: { "x-vectorbea-support": "VB-A83K2P" } }), rules, lookup);
    expect(d).toEqual({ kind: "ignored", reason: "our own outgoing mail" });
  });

  it("treats the customer's reply as a comment", async () => {
    const d = await decideInbound(mail({ text: "Still failing.\n\n> quoted" }), rules, lookup);
    expect(d.kind).toBe("customer");
    if (d.kind === "customer") expect(d.body).toBe("Still failing.");
  });

  it("never lets a customer change the status", async () => {
    const d = await decideInbound(mail({ subject: "Re: [VB-A83K2P] resolved?", text: "Ticket has been resolved? No." }), rules, lookup);
    expect(d.kind).toBe("customer");
  });

  it("ignores automatic replies", async () => {
    const d = await decideInbound(mail({ text: "Away", headers: { "auto-submitted": "auto-replied" } }), rules, lookup);
    expect(d.kind).toBe("ignored");
    const ooo = await decideInbound(mail({ subject: "Out of office: [VB-A83K2P]", text: "Away" }), rules, lookup);
    expect(ooo.kind).toBe("ignored");
  });

  it("applies a help desk close with a comment", async () => {
    const d = await decideInbound(mail({
      fromEmail: "help@acme.on.spiceworks.com", fromName: "Grace (IT)",
      subject: "[Ticket #412] Re: [VB-A83K2P] Connection closed unexpectedly",
      text: "Ticket #412 has been closed.\n\nWe rotated the token.",
    }), rules, lookup);
    expect(d).toMatchObject({ kind: "support", status: "RESOLVED", helpdeskRef: "412", body: "We rotated the token.", authorName: "Grace (IT)" });
  });

  it("matches a help desk message by its learned reference when the VB number is gone", async () => {
    const d = await decideInbound(mail({ fromEmail: "noreply@spiceworks.com", subject: "Ticket #412 updated", text: "Looking now." }), rules, lookup);
    expect(d).toMatchObject({ kind: "support", body: "Looking now.", status: null });
  });

  it("does not match by reference for a non help desk sender", async () => {
    const d = await decideInbound(mail({ fromEmail: "someone@else.com", subject: "Ticket #412", text: "hi" }), rules, lookup);
    expect(d.kind).toBe("unmatched");
  });

  it("ignores strangers who quote a real number", async () => {
    const d = await decideInbound(mail({ fromEmail: "someone@else.com", text: "hi" }), rules, lookup);
    expect(d).toEqual({ kind: "ignored", reason: "sender is neither the customer nor the help desk" });
  });

  it("reports mail with no reference as unmatched", async () => {
    const d = await decideInbound(mail({ subject: "Hello", text: "no number" }), rules, lookup);
    expect(d.kind).toBe("unmatched");
  });
});
