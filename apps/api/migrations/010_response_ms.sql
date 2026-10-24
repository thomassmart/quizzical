-- Wall-clock ms from answer window open → submission (for Quickest display)
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS answer_opened_at TIMESTAMPTZ;

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS response_ms INTEGER;
