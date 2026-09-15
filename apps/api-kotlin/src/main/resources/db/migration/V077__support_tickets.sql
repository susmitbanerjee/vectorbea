-- V077 - support tickets, in the migration chain.
--
-- The web app's support widget and /support portal read and write this table
-- through the web deployment's DATABASE_URL, and created it on first use with
-- CREATE TABLE IF NOT EXISTS (lib/server/support.ts). That works only for a role
-- allowed to create tables, so on a least-privilege database the portal could
-- not start, and a database provisioned from migrations alone never had it.
--
-- The definition matches lib/server/support.ts exactly and is idempotent, so an
-- existing table is untouched.

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

CREATE INDEX IF NOT EXISTS support_tickets_status_created_idx ON support_tickets (status, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_user_email_idx     ON support_tickets (lower(user_email));
CREATE INDEX IF NOT EXISTS support_tickets_tenant_idx         ON support_tickets (tenant_id);
CREATE INDEX IF NOT EXISTS support_tickets_user_id_idx        ON support_tickets (user_id);
