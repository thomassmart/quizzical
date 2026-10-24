-- Preserve host marking overrides across remakes of the section queue.
ALTER TABLE marks
  ADD COLUMN IF NOT EXISTS host_overridden BOOLEAN NOT NULL DEFAULT false;
