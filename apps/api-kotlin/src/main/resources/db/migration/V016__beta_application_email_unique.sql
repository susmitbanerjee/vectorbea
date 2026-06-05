-- V016: Add unique constraint on beta_applications.email
-- Required for ON CONFLICT (email) upsert in BetaAccessRepository.upsertBetaApplication
ALTER TABLE beta_applications
    ADD CONSTRAINT IF NOT EXISTS uq_beta_applications_email UNIQUE (email);
