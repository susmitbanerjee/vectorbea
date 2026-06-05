-- V016: Add unique index on beta_applications.email
-- Required for ON CONFLICT (email) upsert in BetaAccessRepository.upsertBetaApplication
-- Using CREATE UNIQUE INDEX (not ADD CONSTRAINT IF NOT EXISTS which is invalid PG syntax)
CREATE UNIQUE INDEX IF NOT EXISTS uq_beta_applications_email ON beta_applications (email);
