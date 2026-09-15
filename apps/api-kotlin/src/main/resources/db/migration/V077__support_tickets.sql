-- V077 - support tickets, in the migration chain, and forwarding to a help desk.
--
-- The web app's support widget and /support portal read and write this table
-- through the web deployment's DATABASE_URL, and created it on first use with
-- CREATE TABLE IF NOT EXISTS (lib/server/support.ts). That works only for a role
-- allowed to create tables, so on a least-privilege database the portal could
-- not start, and a database provisioned from migrations alone never had it.
--
-- The forward_* columns record whether a ticket reached the external help desk
-- (Spiceworks, by email — lib/server/support-spiceworks.ts). The ticket is saved
-- first and forwarded after, so a failed forward is a state the portal shows and
-- retries, never a lost report.
--
-- Idempotent: an existing table keeps its rows and gains the new columns.

CREATE TABLE IF NOT EXISTS support_tickets (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number text        NOT NULL UNIQUE,
    tenant_id     text,
    tenant_name   text,
    user_id       text,
    user_email    text        NOT NULL,
    user_name     text,
    subject       text        NOT NULL,
    message       text        NOT NULL,
    status        text        NOT NULL DEFAULT 'OPEN'   CHECK (status   IN ('OPEN','RESOLVED')),
    priority      text        NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH')),
    category      text,
    admin_note    text,
    resolved_by   text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    resolved_at   timestamptz
);

ALTER TABLE support_tickets
    ADD COLUMN IF NOT EXISTS forwarded_to      text,
    ADD COLUMN IF NOT EXISTS forward_status    text,
    ADD COLUMN IF NOT EXISTS forward_error     text,
    ADD COLUMN IF NOT EXISTS forward_attempts  int NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS forwarded_at      timestamptz;

COMMENT ON COLUMN support_tickets.forward_status IS
    'NULL = not forwarded (no help desk configured), sent, or failed. See forward_error.';

CREATE INDEX IF NOT EXISTS support_tickets_status_created_idx ON support_tickets (status, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_user_email_idx     ON support_tickets (lower(user_email));
CREATE INDEX IF NOT EXISTS support_tickets_tenant_idx         ON support_tickets (tenant_id);
CREATE INDEX IF NOT EXISTS support_tickets_user_id_idx        ON support_tickets (user_id);
