import { config, llmConfigured } from '../config.js';
import { query } from '../db/client.js';
import { cosineSimilarity, embedTexts } from '../llm/provider.js';
import { normalizeWording } from '../util/normalize.js';

const BLOCKED = new Set([
  'dismissed',
  'reserved',
  'used',
  'revealed_abandoned',
]);

export async function checkDuplicates(input: {
  seriesId: string;
  questionId: string;
  wording: string;
  embedding?: number[] | null;
}): Promise<{
  blocked: boolean;
  exactDuplicate: boolean;
  ambiguousMatches: {
    existingQuestionId: string;
    wording: string;
    similarity: number;
  }[];
}> {
  const normalized = normalizeWording(input.wording);

  const { rows: exact } = await query<{ id: string }>(
    `SELECT id FROM questions
     WHERE series_id = $1 AND wording_normalized = $2 AND id <> $3
       AND status = ANY($4::text[])`,
    [
      input.seriesId,
      normalized,
      input.questionId,
      ['draft', 'proposed', 'approved', 'reserved', 'used', 'dismissed', 'revealed_abandoned'],
    ],
  );
  if (exact.length) {
    return { blocked: true, exactDuplicate: true, ambiguousMatches: [] };
  }

  const { rows: blockedIds } = await query<{ id: string }>(
    `SELECT id FROM questions WHERE series_id = $1 AND status = ANY($2::text[])`,
    [input.seriesId, [...BLOCKED]],
  );
  // identity block already enforced by status when assigning; here we surface semantic matches

  let embedding = input.embedding ?? null;
  if ((!embedding || !embedding.length) && llmConfigured()) {
    try {
      const [e] = await embedTexts([input.wording]);
      embedding = e ?? null;
      if (embedding?.length) {
        await query(`UPDATE questions SET embedding = $1::jsonb WHERE id = $2`, [
          JSON.stringify(embedding),
          input.questionId,
        ]);
      }
    } catch {
      embedding = null;
    }
  }

  const ambiguousMatches: {
    existingQuestionId: string;
    wording: string;
    similarity: number;
  }[] = [];

  if (embedding?.length) {
    const { rows: candidates } = await query<{
      id: string;
      wording: string;
      embedding: number[] | null;
      status: string;
    }>(
      `SELECT id, wording, embedding, status FROM questions
       WHERE series_id = $1 AND id <> $2 AND embedding IS NOT NULL`,
      [input.seriesId, input.questionId],
    );

    for (const c of candidates) {
      const emb = Array.isArray(c.embedding) ? c.embedding : null;
      if (!emb?.length) continue;
      const sim = cosineSimilarity(embedding, emb);
      if (sim >= config.semanticSimilarityThreshold) {
        ambiguousMatches.push({
          existingQuestionId: c.id,
          wording: c.wording,
          similarity: sim,
        });
        await query(
          `INSERT INTO duplicate_candidates
           (series_id, new_question_id, existing_question_id, similarity, status)
           VALUES ($1,$2,$3,$4,'pending')`,
          [input.seriesId, input.questionId, c.id, sim],
        );
      }
    }
  }

  void blockedIds;
  return {
    blocked: false,
    exactDuplicate: false,
    ambiguousMatches: ambiguousMatches.sort((a, b) => b.similarity - a.similarity),
  };
}

export async function reserveQuestion(
  questionId: string,
  eventId: string,
): Promise<void> {
  const { rows } = await query<{ status: string; series_id: string }>(
    `SELECT status, series_id FROM questions WHERE id = $1`,
    [questionId],
  );
  const q = rows[0];
  if (!q) throw new Error('Question not found');
  if (BLOCKED.has(q.status) && q.status !== 'reserved') {
    throw new Error(`Question unavailable: ${q.status}`);
  }
  await query(`UPDATE questions SET status = 'reserved', updated_at = now() WHERE id = $1`, [
    questionId,
  ]);
  await query(
    `INSERT INTO question_history (series_id, question_id, reason, event_id, detail)
     VALUES ($1,$2,'reserved',$3,'Assigned to upcoming event')`,
    [q.series_id, questionId, eventId],
  );
}

export async function releaseUnrevealedReservations(eventId: string): Promise<void> {
  const { rows } = await query<{ question_id: string; series_id: string }>(
    `SELECT es.question_id, q.series_id
     FROM event_snapshots es
     JOIN questions q ON q.id = es.question_id
     JOIN events e ON e.id = es.event_id
     WHERE es.event_id = $1 AND q.status = 'reserved'`,
    [eventId],
  );
  // Only release if never revealed — revealed questions tracked via history
  const { rows: revealed } = await query<{ question_id: string }>(
    `SELECT DISTINCT question_id FROM question_history
     WHERE event_id = $1 AND reason IN ('used','revealed_abandoned','revealed')`,
    [eventId],
  );
  const revealedSet = new Set(revealed.map((r) => r.question_id));
  for (const r of rows) {
    if (revealedSet.has(r.question_id)) continue;
    await query(
      `UPDATE questions SET status = 'approved', updated_at = now() WHERE id = $1 AND status = 'reserved'`,
      [r.question_id],
    );
    await query(
      `INSERT INTO question_history (series_id, question_id, reason, event_id, detail)
       VALUES ($1,$2,'released',$3,'Unrevealed reservation released on cancel')`,
      [r.series_id, r.question_id, eventId],
    );
  }
}

export async function markPresentedUsed(
  eventId: string,
  mode: 'used' | 'revealed_abandoned',
): Promise<void> {
  const { rows } = await query<{ question_id: string; series_id: string }>(
    `SELECT DISTINCT q.id AS question_id, q.series_id
     FROM question_history h
     JOIN questions q ON q.id = h.question_id
     WHERE h.event_id = $1 AND h.reason = 'revealed'`,
    [eventId],
  );
  for (const r of rows) {
    await query(`UPDATE questions SET status = $1, updated_at = now() WHERE id = $2`, [
      mode,
      r.question_id,
    ]);
    await query(
      `INSERT INTO question_history (series_id, question_id, reason, event_id)
       VALUES ($1,$2,$3,$4)`,
      [r.series_id, r.question_id, mode, eventId],
    );
  }
}

export async function recordReveal(questionId: string, eventId: string): Promise<void> {
  const { rows } = await query<{ series_id: string }>(
    `SELECT series_id FROM questions WHERE id = $1`,
    [questionId],
  );
  if (!rows[0]) return;
  await query(
    `INSERT INTO question_history (series_id, question_id, reason, event_id, detail)
     VALUES ($1,$2,'revealed',$3,'Presented on wallboard')`,
    [rows[0].series_id, questionId, eventId],
  );
}
