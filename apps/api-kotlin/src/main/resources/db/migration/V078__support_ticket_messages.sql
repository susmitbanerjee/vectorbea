-- V078 - the conversation on a support ticket.
--
-- A ticket used to be one message and one admin note. With Spiceworks as the
-- technicians' tool, the customer still needs one place to see what happened and
-- to answer, without a Spiceworks account. So the conversation lives here:
--
--   · a customer comment from the app, or an email reply to an update;
--   · a technician's comment or status change, arriving by email from the help desk;
--   · a reply written in the /support portal.
--
-- `external_message_id` is the email Message-ID when the row came from mail. It is
-- unique, so an inbound provider that retries a webhook (they all do) cannot add
-- the same comment twice.
--
-- `helpdesk_ref` on the ticket is the help desk's own ticket number, learned from
-- the first email it sends about the ticket, so later mail can be matched to the
-- ticket even when the subject no longer carries the Vectorbea number.

CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id            uuid        NOT NULL REFERENCES support_tickets (id) ON DELETE CASCADE,
    author_type          text        NOT NULL CHECK (author_type IN ('customer', 'support', 'system')),
    author_name          text,
    author_email         text,
    body                 text        NOT NULL,
    source               text        NOT NULL CHECK (source IN ('app', 'email', 'helpdesk', 'portal')),
    external_message_id  text,
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS support_ticket_messages_external_id_uidx
    ON support_ticket_messages (external_message_id) WHERE external_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_idx
    ON support_ticket_messages (ticket_id, created_at);

ALTER TABLE support_tickets
    ADD COLUMN IF NOT EXISTS helpdesk_ref      text,
    ADD COLUMN IF NOT EXISTS last_activity_at  timestamptz;

CREATE INDEX IF NOT EXISTS support_tickets_helpdesk_ref_idx ON support_tickets (helpdesk_ref)
    WHERE helpdesk_ref IS NOT NULL;
