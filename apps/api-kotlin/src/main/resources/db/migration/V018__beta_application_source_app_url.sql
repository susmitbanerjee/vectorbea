-- Remember which Vectorbea app host submitted a beta request.
-- Approval/rejection emails must link back to the same environment.
ALTER TABLE beta_applications
    ADD COLUMN IF NOT EXISTS source_app_url TEXT;
