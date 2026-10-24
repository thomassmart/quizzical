-- Host-visible team PIN (join still verifies against pin_hash).
-- Existing teams keep NULL until they re-register or are reseeded.
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS pin TEXT;
