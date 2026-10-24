/**
 * Question media policy:
 * - Picture-prompt / host uploads: leave alone (image is the question).
 * - Auto ambience: never attach random Openverse photos (they look like answers
 *   and often mismatch — e.g. kangaroo on a crocodile question).
 * - Music-themed sections may get instrumental audio only.
 * - Get Ready mosaics stay in topicImages.ts (section-level, not per-question).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db/client.js';
import { topicSearchQueries } from './topicImages.js';

type QuestionMediaRow = {
  id: string;
  wording: string;
  theme_tags: string[] | null;
  answer_spec: unknown;
  media_image_id: string | null;
  media_audio_id: string | null;
  media_video_id: string | null;
  section_id: string | null;
  section_theme: string | null;
  section_title: string | null;
  is_demo: boolean;
};

function isMusicTheme(theme: string, tags: string[]): boolean {
  const blob = `${theme} ${tags.join(' ')}`.toLowerCase();
  return /\b(music|song|album|band|disco|vinyl|chart|singer|tune|melody|soundtrack)\b/.test(
    blob,
  );
}

async function searchOpenverseAudio(
  query: string,
): Promise<{ url: string; title: string } | null> {
  try {
    const url = new URL('https://api.openverse.org/v1/audio/');
    url.searchParams.set('q', query);
    url.searchParams.set('page_size', '8');
    url.searchParams.set('mature', 'false');
    url.searchParams.set('category', 'music');
    const res = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'QuizzicalTrivia/1.0 (live pub quiz wallboard)',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: { url?: string; title?: string }[];
    };
    const hit = (data.results ?? []).find((r) => r.url);
    if (!hit?.url) return null;
    return { url: hit.url, title: hit.title ?? query };
  } catch {
    return null;
  }
}

async function downloadAudio(
  src: string,
  dirRel: string,
  label: string,
): Promise<string | null> {
  try {
    const res = await fetch(src, {
      headers: { 'User-Agent': 'QuizzicalTrivia/1.0' },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000 || buf.length > 20 * 1024 * 1024) return null;
    const mime = (res.headers.get('content-type') || 'audio/mpeg')
      .split(';')[0]!
      .trim();
    if (!mime.startsWith('audio/')) return null;
    const id = randomUUID();
    const ext = mime.includes('ogg')
      ? '.ogg'
      : mime.includes('wav')
        ? '.wav'
        : mime.includes('mp4') || mime.includes('m4a')
          ? '.m4a'
          : '.mp3';
    await fs.mkdir(path.join(config.mediaDir, dirRel), { recursive: true });
    const storageName = path.join(dirRel, `${id}${ext}`);
    await fs.writeFile(path.join(config.mediaDir, storageName), buf);
    await query(
      `INSERT INTO media_assets (id, filename, mime_type, size_bytes, storage_path)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, `${label.slice(0, 40)}${ext}`, mime, buf.length, storageName],
    );
    return id;
  } catch {
    return null;
  }
}

async function loadQuestion(questionId: string): Promise<QuestionMediaRow | null> {
  const { rows } = await query<QuestionMediaRow>(
    `SELECT q.id, q.wording, q.theme_tags, q.answer_spec,
            q.media_image_id, q.media_audio_id, q.media_video_id,
            q.section_id, s.theme AS section_theme, s.title AS section_title,
            COALESCE(s.is_demo, false) AS is_demo
     FROM questions q
     LEFT JOIN sections s ON s.id = q.section_id
     WHERE q.id = $1`,
    [questionId],
  );
  return rows[0] ?? null;
}

/** True when image was auto-stored under question/<id>/ (not a host upload). */
async function isAutoQuestionImage(
  questionId: string,
  mediaId: string | null,
): Promise<boolean> {
  if (!mediaId) return false;
  const { rows } = await query<{ storage_path: string; mime_type: string }>(
    `SELECT storage_path, mime_type FROM media_assets WHERE id = $1`,
    [mediaId],
  );
  const row = rows[0];
  if (!row) return false;
  const prefix = path.join('question', questionId);
  return (
    row.storage_path.startsWith(prefix + path.sep) ||
    row.storage_path.startsWith(`question/${questionId}/`)
  );
}

/**
 * Ensure question media follows the non-spoiling policy.
 * Does not attach random photos. Never overwrites host uploads or picture-prompts.
 */
export async function ensureQuestionAmbienceMedia(
  questionId: string,
): Promise<{ imageId: string | null; audioId: string | null }> {
  const q = await loadQuestion(questionId);
  if (!q) return { imageId: null, audioId: null };

  if (q.is_demo || (q.theme_tags ?? []).includes('picture-prompt')) {
    return { imageId: q.media_image_id, audioId: q.media_audio_id };
  }

  // Strip prior auto-attached Openverse/SVG junk so hosts see a clean slate
  if (q.media_image_id && (await isAutoQuestionImage(questionId, q.media_image_id))) {
    await query(
      `UPDATE questions SET media_image_id = NULL, updated_at = now() WHERE id = $1`,
      [questionId],
    );
    q.media_image_id = null;
  }

  // Host (or picture) image / video already set — leave alone
  if (q.media_image_id || q.media_video_id) {
    return {
      imageId: q.media_image_id,
      audioId: q.media_audio_id,
    };
  }

  const theme = q.section_theme || q.section_title || 'trivia';
  const tags = q.theme_tags ?? [];
  const dirRel = path.join('question', questionId);

  let audioId = q.media_audio_id;
  if (!audioId && isMusicTheme(theme, tags)) {
    const queries = topicSearchQueries(theme, q.section_title);
    const audioQuery =
      queries.find((x) => /\bmusic|disco|vinyl|band\b/i.test(x)) ??
      `${theme} instrumental music`;
    const hit = await searchOpenverseAudio(audioQuery);
    if (hit) {
      audioId = await downloadAudio(hit.url, dirRel, hit.title);
      if (audioId) {
        await query(
          `UPDATE questions SET media_audio_id = COALESCE(media_audio_id, $1), updated_at = now()
           WHERE id = $2`,
          [audioId, questionId],
        );
      }
    }
  }

  return { imageId: null, audioId };
}

/**
 * Remove auto-attached per-question images (Openverse/SVG under question/)
 * for a section. Host uploads and picture-prompts are kept.
 */
export async function stripAutoQuestionImages(sectionId: string): Promise<number> {
  const { rows } = await query<{
    id: string;
    media_image_id: string | null;
    theme_tags: string[] | null;
  }>(
    `SELECT id, media_image_id, theme_tags FROM questions
     WHERE section_id = $1 AND media_image_id IS NOT NULL`,
    [sectionId],
  );
  let cleared = 0;
  for (const r of rows) {
    if ((r.theme_tags ?? []).includes('picture-prompt')) continue;
    if (!(await isAutoQuestionImage(r.id, r.media_image_id))) continue;
    await query(
      `UPDATE questions SET media_image_id = NULL, updated_at = now() WHERE id = $1`,
      [r.id],
    );
    cleared += 1;
  }
  return cleared;
}

/** Attach media policy to every bare question in a section. */
export async function ensureSectionQuestionsMedia(
  sectionId: string,
): Promise<void> {
  await stripAutoQuestionImages(sectionId);
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM questions WHERE section_id = $1`,
    [sectionId],
  );
  await Promise.all(
    rows.map((r) =>
      ensureQuestionAmbienceMedia(r.id).catch(() => ({
        imageId: null,
        audioId: null,
      })),
    ),
  );
}

/** Apply media policy across an event (used when building the play snapshot). */
export async function ensureEventQuestionsMedia(eventId: string): Promise<void> {
  const { rows: sections } = await query<{ id: string }>(
    `SELECT id FROM sections WHERE event_id = $1 AND COALESCE(is_demo, false) = false`,
    [eventId],
  );
  for (const s of sections) {
    await ensureSectionQuestionsMedia(s.id);
  }
}
