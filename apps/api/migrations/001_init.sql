-- Quizzical initial schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'draft',
  wallboard_token TEXT NOT NULL,
  current_section_id UUID,
  current_question_id UUID,
  timer_deadline_at TIMESTAMPTZ,
  timer_remaining_ms INTEGER,
  timer_paused BOOLEAN NOT NULL DEFAULT true,
  audio_playing BOOLEAN NOT NULL DEFAULT false,
  nominations_locked BOOLEAN NOT NULL DEFAULT false,
  section_reveal_answers BOOLEAN NOT NULL DEFAULT false,
  section_reveal_standings BOOLEAN NOT NULL DEFAULT false,
  section_reveal_answer_index INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  theme TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  question_count_target INTEGER NOT NULL DEFAULT 5,
  difficulty TEXT NOT NULL DEFAULT 'medium',
  auto_open_answers BOOLEAN NOT NULL DEFAULT false,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  topic_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  format TEXT NOT NULL,
  wording TEXT NOT NULL,
  wording_normalized TEXT NOT NULL,
  answer_spec JSONB NOT NULL,
  rubric TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT 'medium',
  theme_tags TEXT[] NOT NULL DEFAULT '{}',
  points INTEGER NOT NULL DEFAULT 1,
  timing_seconds INTEGER NOT NULL DEFAULT 30,
  source_references TEXT[] NOT NULL DEFAULT '{}',
  sources_verified BOOLEAN NOT NULL DEFAULT false,
  media_image_id UUID,
  media_audio_id UUID,
  media_video_id UUID,
  host_notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  embedding JSONB,
  parent_question_id UUID REFERENCES questions(id),
  llm_proposed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE question_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE duplicate_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  new_question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  existing_question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  similarity DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE event_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  section_id UUID NOT NULL,
  question_id UUID NOT NULL,
  sort_order INTEGER NOT NULL,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, question_id)
);

CREATE TABLE media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  bonus_section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  wagers_remaining INTEGER NOT NULL DEFAULT 2,
  active_device_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, name)
);

CREATE TABLE team_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, device_id)
);

CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  question_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, question_id, idempotency_key),
  UNIQUE (team_id, question_id, revision)
);

CREATE TABLE wagers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  question_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, question_id)
);

CREATE TABLE marks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  question_id UUID NOT NULL,
  correctness TEXT NOT NULL,
  partial_fraction DOUBLE PRECISION,
  is_first_fully_correct BOOLEAN NOT NULL DEFAULT false,
  llm_suggestion JSONB,
  host_approved BOOLEAN NOT NULL DEFAULT false,
  needs_discretion BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, team_id, question_id)
);

CREATE TABLE score_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  question_id UUID,
  entry_type TEXT NOT NULL,
  answer_points DOUBLE PRECISION NOT NULL DEFAULT 0,
  speed_points DOUBLE PRECISION NOT NULL DEFAULT 0,
  bonus_effect DOUBLE PRECISION NOT NULL DEFAULT 0,
  wager_effect DOUBLE PRECISION NOT NULL DEFAULT 0,
  host_adjustment DOUBLE PRECISION NOT NULL DEFAULT 0,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE event_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'host',
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_questions_series_status ON questions(series_id, status);
CREATE INDEX idx_questions_wording_norm ON questions(series_id, wording_normalized);
CREATE INDEX idx_submissions_team_q ON submissions(team_id, question_id);
CREATE INDEX idx_score_ledger_event_team ON score_ledger(event_id, team_id);
CREATE INDEX idx_sections_event_order ON sections(event_id, sort_order);
