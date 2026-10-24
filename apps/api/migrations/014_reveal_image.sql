-- Answer-sheet image: shown only during section answer reveal (not during the live question).
-- Table is media_assets (see 001_init.sql).
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS reveal_image_id UUID REFERENCES media_assets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_questions_reveal_image_id
  ON questions(reveal_image_id)
  WHERE reveal_image_id IS NOT NULL;
