-- Support tickets — lightweight, cross-tenant admin support portal (/support).
--
-- Replaces the earlier runtime-created `support_incidents` table with a proper
-- migration. Persistence is the source of truth for a support request; the
-- notification email is best-effort on top of it.
--
-- Follows the raw-SQL support subsystem conventions: uuid PK (gen_random_uuid),
-- the `vectorbea` schema, and text columns for identity so OAuth JWT subs
-- ("google:…") and workspace ids store cleanly without FK/uuid-cast surprises.

CREATE SCHEMA IF NOT EXISTS vectorbea;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS vectorbea.support_tickets (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text        NOT NULL UNIQUE,          -- human-readable, e.g. VB-A83K2P
  tenant_id     text,                                 -- workspace id (nullable — logged-out/unknown)
  tenant_name   text,                                 -- workspace name, captured at file time
  user_id       text,                                 -- authenticated JWT sub (uuid or "google:…")
  user_email    text        NOT NULL,
  user_name     text,
  subject       text        NOT NULL,
  message       text        NOT NULL,
  status        text        NOT NULL DEFAULT 'OPEN'   CHECK (status   IN ('OPEN', 'RESOLVED')),
  priority      text        NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH')),
  category      text,
  admin_note    text,
  resolved_by   text,                                 -- admin email who resolved it
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);

-- Normal support view: open first, newest first. `ticket_number UNIQUE` already
-- creates its own index, so it is not repeated here.
CREATE INDEX IF NOT EXISTS support_tickets_status_created_idx
  ON vectorbea.support_tickets (status, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_user_email_idx
  ON vectorbea.support_tickets (lower(user_email));
CREATE INDEX IF NOT EXISTS support_tickets_tenant_idx
  ON vectorbea.support_tickets (tenant_id);
CREATE INDEX IF NOT EXISTS support_tickets_user_id_idx
  ON vectorbea.support_tickets (user_id);
