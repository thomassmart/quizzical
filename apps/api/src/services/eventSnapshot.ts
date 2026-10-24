/**
 * Build the play-time question freeze for an event.
 * Called automatically when opening the lobby / starting the game — not a host prep step.
 */
import { normalizeAnswerSpec } from '@quizzical/shared';
import { query } from '../db/client.js';
import { reserveQuestion } from './exclusion.js';

export async function buildEventPlaySnapshot(eventId: string): Promise<void> {
  const { ensureDemoSection } = await import('./demoSection.js');
  const { ensureSectionTopicImages } = await import('./topicImages.js');
  const { ensureEventQuestionsMedia } = await import('./questionMedia.js');

  await ensureDemoSection(eventId);
  const { rows: sections } = await query<{ id: string }>(
    `SELECT id FROM sections WHERE event_id = $1 ORDER BY sort_order`,
    [eventId],
  );

  await Promise.all([
    ...sections.map((s) => ensureSectionTopicImages(s.id).catch(() => [])),
    ensureEventQuestionsMedia(eventId).catch(() => undefined),
  ]);

  await query(`DELETE FROM event_snapshots WHERE event_id = $1`, [eventId]);

  for (const section of sections) {
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
      `SELECT * FROM questions
       WHERE section_id = $1 AND status IN ('approved','reserved')
       ORDER BY created_at`,
      [section.id],
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
          section.id,
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
          }),
        ],
      );
    }
  }

  await query(
    `UPDATE events SET state = 'ready' WHERE id = $1 AND state = 'draft'`,
    [eventId],
  );
}
