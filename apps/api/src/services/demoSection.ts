import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeAnswerSpec, type AnswerSpec } from '@quizzical/shared';
import { config } from '../config.js';
import { query } from '../db/client.js';
import { normalizeWording } from '../util/normalize.js';
import { reserveQuestion } from './exclusion.js';

type DemoDef = {
  format: AnswerSpec['format'];
  wording: string;
  answerSpec: AnswerSpec;
  rubric: string;
  points: number;
  timingSeconds: number;
  /** When set, this practice Q uses a prompt image (not ambience). */
  picturePrompt?: 'orange';
  themeTags?: string[];
};

const PICTURE_PROMPT_TAG = 'picture-prompt';

/** Fixed practice questions — formats + one picture identification. */
export const DEMO_QUESTIONS: DemoDef[] = [
  {
    format: 'multiple_choice',
    wording: 'Practice — multiple choice: Which letter comes after A?',
    answerSpec: {
      format: 'multiple_choice',
      data: {
        options: [
          { id: 'a', label: 'C' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'D' },
          { id: 'd', label: 'Z' },
        ],
        correctOptionIds: ['b'],
      },
    },
    rubric: 'B',
    points: 1,
    timingSeconds: 25,
  },
  {
    format: 'short_answer',
    wording: 'Practice — type an answer: What is 2 + 2?',
    answerSpec: {
      format: 'short_answer',
      data: { acceptedAnswers: ['4', 'four'] },
    },
    rubric: '4 or four',
    points: 1,
    timingSeconds: 25,
  },
  {
    format: 'short_answer',
    wording: 'What fruit is this?',
    picturePrompt: 'orange',
    themeTags: [PICTURE_PROMPT_TAG, 'practice', 'demo'],
    answerSpec: {
      format: 'short_answer',
      data: { acceptedAnswers: ['orange', 'an orange'] },
    },
    rubric: 'Orange',
    points: 1,
    timingSeconds: 25,
  },
  {
    format: 'ordered_list',
    wording: 'Practice — put these in alphabetical order',
    answerSpec: {
      format: 'ordered_list',
      data: {
        items: [
          { id: '1', label: 'Banana' },
          { id: '2', label: 'Apple' },
          { id: '3', label: 'Cherry' },
        ],
        correctOrder: ['2', '1', '3'],
      },
    },
    rubric: 'Apple → Banana → Cherry',
    points: 1,
    timingSeconds: 35,
  },
  {
    format: 'matching',
    wording: 'Practice — match the pairs',
    answerSpec: {
      format: 'matching',
      data: {
        left: [
          { id: 'l1', label: '1' },
          { id: 'l2', label: '2' },
        ],
        right: [
          { id: 'r1', label: 'One' },
          { id: 'r2', label: 'Two' },
        ],
        pairs: [
          { leftId: 'l1', rightId: 'r1' },
          { leftId: 'l2', rightId: 'r2' },
        ],
      },
    },
    rubric: '1↔One, 2↔Two',
    points: 1,
    timingSeconds: 35,
  },
];

async function writeOrangeMedia(questionId: string): Promise<string> {
  const dirRel = path.join('question', questionId);
  await fs.mkdir(path.join(config.mediaDir, dirRel), { recursive: true });
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" role="img" aria-label="Orange">
  <defs>
    <radialGradient id="flesh" cx="38%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#FFB347"/>
      <stop offset="55%" stop-color="#F28500"/>
      <stop offset="100%" stop-color="#D35400"/>
    </radialGradient>
  </defs>
  <rect width="320" height="320" fill="#F7F5F0"/>
  <circle cx="160" cy="168" r="108" fill="url(#flesh)"/>
  <ellipse cx="160" cy="168" rx="108" ry="108" fill="none" stroke="#C2410C" stroke-width="3" opacity="0.25"/>
  <path d="M160 62 C152 88 168 96 160 118" fill="none" stroke="#15803D" stroke-width="10" stroke-linecap="round"/>
  <ellipse cx="148" cy="58" rx="18" ry="10" fill="#22C55E" transform="rotate(-25 148 58)"/>
  <ellipse cx="172" cy="56" rx="16" ry="9" fill="#16A34A" transform="rotate(20 172 56)"/>
  <circle cx="120" cy="140" r="6" fill="#FFEDD5" opacity="0.45"/>
  <circle cx="200" cy="150" r="4" fill="#FFEDD5" opacity="0.35"/>
</svg>`;
  const id = randomUUID();
  const storageName = path.join(dirRel, `${id}.svg`);
  const buf = Buffer.from(svg, 'utf8');
  await fs.writeFile(path.join(config.mediaDir, storageName), buf);
  await query(
    `INSERT INTO media_assets (id, filename, mime_type, size_bytes, storage_path)
     VALUES ($1,$2,$3,$4,$5)`,
    [id, 'orange.svg', 'image/svg+xml', buf.length, storageName],
  );
  return id;
}

async function insertDemoQuestion(
  seriesId: string,
  sectionId: string,
  d: DemoDef,
): Promise<string> {
  const answerSpec = normalizeAnswerSpec(d.format, d.answerSpec);
  const tags = d.themeTags ?? ['practice', 'demo'];
  const { rows: qRows } = await query<{ id: string }>(
    `INSERT INTO questions
     (series_id, section_id, format, wording, wording_normalized, answer_spec, rubric,
      difficulty, theme_tags, points, timing_seconds, source_references, sources_verified,
      status, llm_proposed)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'easy',$8,$9,$10,'{}',true,'approved',false)
     RETURNING id`,
    [
      seriesId,
      sectionId,
      d.format,
      d.wording,
      normalizeWording(d.wording),
      JSON.stringify(answerSpec),
      d.rubric,
      tags,
      d.points,
      d.timingSeconds,
    ],
  );
  const questionId = qRows[0]!.id;
  if (d.picturePrompt === 'orange') {
    const mediaId = await writeOrangeMedia(questionId);
    await query(`UPDATE questions SET media_image_id = $1 WHERE id = $2`, [
      mediaId,
      questionId,
    ]);
  }
  return questionId;
}

/**
 * Strip ambience media from practice questions that are not picture-prompts,
 * and ensure the fruit picture question exists.
 */
async function syncDemoQuestions(
  sectionId: string,
  seriesId: string,
): Promise<void> {
  // Remove auto-ambience from non picture-prompt practice questions
  await query(
    `UPDATE questions SET
       media_image_id = NULL,
       media_audio_id = NULL,
       media_video_id = NULL,
       updated_at = now()
     WHERE section_id = $1
       AND NOT (theme_tags @> ARRAY[$2]::text[])`,
    [sectionId, PICTURE_PROMPT_TAG],
  );

  const { rows: fruit } = await query<{ id: string }>(
    `SELECT id FROM questions
     WHERE section_id = $1 AND wording = $2
     LIMIT 1`,
    [sectionId, 'What fruit is this?'],
  );

  if (!fruit[0]) {
    const def = DEMO_QUESTIONS.find((d) => d.picturePrompt === 'orange');
    if (def) await insertDemoQuestion(seriesId, sectionId, def);
  } else {
    const { rows: media } = await query<{ media_image_id: string | null }>(
      `SELECT media_image_id FROM questions WHERE id = $1`,
      [fruit[0].id],
    );
    if (!media[0]?.media_image_id) {
      const mediaId = await writeOrangeMedia(fruit[0].id);
      await query(
        `UPDATE questions SET media_image_id = $1, theme_tags = $2 WHERE id = $3`,
        [mediaId, [PICTURE_PROMPT_TAG, 'practice', 'demo'], fruit[0].id],
      );
    }
  }

  await query(
    `UPDATE sections SET question_count_target = $1 WHERE id = $2`,
    [DEMO_QUESTIONS.length, sectionId],
  );
}

/**
 * Ensure the event has a practice (demo) section with answer formats + picture ID.
 * Placed at sort_order -1 so it runs first. Idempotent; upgrades older demos.
 */
export async function ensureDemoSection(eventId: string): Promise<string> {
  const { rows: events } = await query<{ series_id: string }>(
    `SELECT series_id FROM events WHERE id = $1`,
    [eventId],
  );
  const seriesId = events[0]?.series_id;
  if (!seriesId) throw new Error('Event not found');

  const { rows: existing } = await query<{ id: string }>(
    `SELECT id FROM sections WHERE event_id = $1 AND is_demo = true LIMIT 1`,
    [eventId],
  );
  if (existing[0]) {
    await syncDemoQuestions(existing[0].id, seriesId);
    return existing[0].id;
  }

  const { rows: secRows } = await query<{ id: string }>(
    `INSERT INTO sections
       (event_id, title, theme, sort_order, question_count_target, difficulty, auto_open_answers, is_demo)
     VALUES ($1, 'Practice', 'Practice', -1, $2, 'easy', true, true)
     RETURNING id`,
    [eventId, DEMO_QUESTIONS.length],
  );
  const sectionId = secRows[0]!.id;

  for (const d of DEMO_QUESTIONS) {
    await insertDemoQuestion(seriesId, sectionId, d);
  }

  // Prefetch practice Get Ready mosaic only — no ambience on practice questions
  void import('./topicImages.js').then((m) =>
    m.storeTopicImagesForSection(sectionId, 'trivia quiz night', 'Practice'),
  );

  return sectionId;
}

/** Snapshot demo questions if the event is already locked / being locked. */
export async function snapshotDemoSection(
  eventId: string,
  sectionId: string,
): Promise<void> {
  await query(
    `DELETE FROM event_snapshots WHERE event_id = $1 AND section_id = $2`,
    [eventId, sectionId],
  );

  const { rows: questions } = await query<{
    id: string;
    format: string;
    wording: string;
    answer_spec: unknown;
    rubric: string;
    difficulty: string;
    theme_tags: string[];
    points: number;
    timing_seconds: number;
    source_references: string[];
    sources_verified: boolean;
    media_image_id: string | null;
    media_audio_id: string | null;
    media_video_id: string | null;
    host_notes: string | null;
    reveal_fact: string | null;
    reveal_image_id: string | null;
    status: string;
  }>(
    `SELECT * FROM questions WHERE section_id = $1 AND status IN ('approved','reserved')
     ORDER BY created_at`,
    [sectionId],
  );

  let order = 0;
  for (const q of questions) {
    if (q.status === 'approved') {
      await reserveQuestion(q.id, eventId);
    }
    await query(
      `INSERT INTO event_snapshots (event_id, section_id, question_id, sort_order, content)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        eventId,
        sectionId,
        q.id,
        order++,
        JSON.stringify({
          id: q.id,
          format: q.format,
          wording: q.wording,
          answerSpec: normalizeAnswerSpec(q.format, q.answer_spec),
          rubric: q.rubric,
          difficulty: q.difficulty,
          themeTags: q.theme_tags,
          points: q.points,
          timingSeconds: q.timing_seconds,
          sourceReferences: q.source_references,
          sourcesVerified: q.sources_verified,
          mediaImageId: q.media_image_id,
          mediaAudioId: q.media_audio_id,
          mediaVideoId: q.media_video_id,
          hostNotes: q.host_notes,
          revealFact: q.reveal_fact,
          revealImageId: q.reveal_image_id,
          isDemo: true,
        }),
      ],
    );
  }
}
