-- Who is on each team (shown on final winner / host lobby)
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS member_names TEXT[] NOT NULL DEFAULT '{}';
