-- Public wall/phone reveal colour — separate from private host_notes.
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS reveal_fact TEXT;

-- Backfill from legacy "Reveal: …" lines composed into host_notes.
UPDATE questions
SET reveal_fact = TRIM(SUBSTRING(host_notes FROM 'Reveal:[[:space:]]*([^\n]+)'))
WHERE reveal_fact IS NULL
  AND host_notes IS NOT NULL
  AND host_notes ~ 'Reveal:[[:space:]]*[^\n]+';
