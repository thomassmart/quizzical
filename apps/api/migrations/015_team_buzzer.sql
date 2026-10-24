-- Per-team submit buzzer (funny SFX assigned at join)
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS buzzer_id text NOT NULL DEFAULT 'zoink';
