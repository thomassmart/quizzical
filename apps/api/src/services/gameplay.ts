import {
  assertTransition,
  allowedTransitions,
  normalizeAnswerSpec,
  pickSpeedWinner,
  scoreAnswer,
  type EventState,
  type AnswerSpec,
} from '@quizzical/shared';
import { query, withTransaction } from '../db/client.js';
import { hashPayload } from '../util/normalize.js';
import {
  markPresentedUsed,
  recordReveal,
  releaseUnrevealedReservations,
} from './exclusion.js';
import { evaluateStructured } from './structuredMark.js';
import { suggestMark, LlmUnavailableError } from '../llm/provider.js';
import type { Hub } from '../ws/hub.js';

export interface EventRow {
  id: string;
  series_id: string;
  name: string;
  code: string;
  state: EventState;
  wallboard_token: string;
  current_section_id: string | null;
  current_question_id: string | null;
  timer_deadline_at: Date | null;
  timer_remaining_ms: number | null;
  timer_paused: boolean;
  audio_playing: boolean;
  nominations_locked: boolean;
  section_reveal_answers: boolean;
  section_reveal_standings: boolean;
  section_reveal_answer_index: number | null;
  answer_opened_at: Date | null;
}

let hubRef: Hub | null = null;

export function setGameplayHub(hub: Hub) {
  hubRef = hub;
}

function broadcast(eventId: string) {
  hubRef?.broadcastEvent(eventId);
}

/** Delay so the wall can show the question before answers open. */
const AUTO_OPEN_DELAY_MS = 2500;
const pendingAutoOpen = new Map<string, ReturnType<typeof setTimeout>>();

function clearAutoOpen(eventId: string) {
  const handle = pendingAutoOpen.get(eventId);
  if (handle) {
    clearTimeout(handle);
    pendingAutoOpen.delete(eventId);
  }
}

function scheduleAutoOpen(eventId: string) {
  clearAutoOpen(eventId);
  const handle = setTimeout(() => {
    pendingAutoOpen.delete(eventId);
    void openAnswerWindow(eventId).catch(() => undefined);
  }, AUTO_OPEN_DELAY_MS);
  pendingAutoOpen.set(eventId, handle);
}

export async function getEvent(eventId: string): Promise<EventRow> {
  const { rows } = await query<EventRow>(`SELECT * FROM events WHERE id = $1`, [
    eventId,
  ]);
  if (!rows[0]) throw new Error('Event not found');
  return rows[0];
}

async function transition(
  eventId: string,
  to: EventState,
  detail?: unknown,
): Promise<EventRow> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<EventRow>(
      `SELECT * FROM events WHERE id = $1 FOR UPDATE`,
      [eventId],
    );
    const ev = rows[0];
    if (!ev) throw new Error('Event not found');
    assertTransition(ev.state, to);
    await client.query(
      `UPDATE events SET state = $1, updated_at = now() WHERE id = $2`,
      [to, eventId],
    );
    await client.query(
      `INSERT INTO event_transitions (event_id, from_state, to_state, detail)
       VALUES ($1,$2,$3,$4)`,
      [eventId, ev.state, to, detail ? JSON.stringify(detail) : null],
    );
    const { rows: updated } = await client.query<EventRow>(
      `SELECT * FROM events WHERE id = $1`,
      [eventId],
    );
    return updated[0]!;
  }).then((ev) => {
    broadcast(eventId);
    return ev;
  });
}

export async function openLobby(eventId: string) {
  const { buildEventPlaySnapshot } = await import('./eventSnapshot.js');
  await buildEventPlaySnapshot(eventId);
  const ev = await getEvent(eventId);
  // Legacy rows may still be draft; promote before lobby
  if (ev.state === 'draft') {
    await transition(eventId, 'ready');
  }
  await query(
    `UPDATE events SET nominations_locked = false, timer_paused = true WHERE id = $1`,
    [eventId],
  );
  return transition(eventId, 'lobby');
}

/**
 * Solo test run: freeze questions, skip waiting for teams, land in practice
 * so the host can check wallboard + audio with nobody joined.
 */
export async function startTestRun(eventId: string) {
  let ev = await getEvent(eventId);
  // Anything past rules (or finished) — clean restart into lobby first
  if (!['draft', 'ready', 'lobby', 'rules'].includes(ev.state)) {
    await restartEvent(eventId);
    ev = await getEvent(eventId);
  }

  if (ev.state === 'draft' || ev.state === 'ready') {
    await openLobby(eventId);
    ev = await getEvent(eventId);
  }
  if (ev.state === 'lobby') {
    await startGame(eventId);
    ev = await getEvent(eventId);
  }
  return beginPractice(eventId);
}

export async function startGame(eventId: string) {
  // Refresh freeze from latest approved questions before go-live
  const { buildEventPlaySnapshot } = await import('./eventSnapshot.js');
  await buildEventPlaySnapshot(eventId);
  await query(
    `UPDATE events SET nominations_locked = true, timer_paused = true,
       current_section_id = NULL, current_question_id = NULL
     WHERE id = $1`,
    [eventId],
  );
  // Rules screen first; practice section begins via beginPractice()
  return transition(eventId, 'rules');
}

/** Leave rules screen and open the practice (demo) section. */
export async function beginPractice(eventId: string) {
  const { ensureDemoSection, snapshotDemoSection } = await import(
    './demoSection.js'
  );
  const demoId = await ensureDemoSection(eventId);
  // Always refresh practice snapshot (media strip + new picture-ID questions)
  await snapshotDemoSection(eventId, demoId);
  await query(
    `UPDATE events SET current_section_id = $1, current_question_id = NULL,
       section_reveal_answers = false, section_reveal_standings = false,
       section_reveal_answer_index = NULL
     WHERE id = $2`,
    [demoId, eventId],
  );
  const { ensureSectionTopicImages } = await import('./topicImages.js');
  await ensureSectionTopicImages(demoId).catch(() => []);
  return transition(eventId, 'section_active', { sectionId: demoId });
}

/** Leave rules and open the first real (non-demo) section — skip practice. */
export async function skipPractice(eventId: string) {
  const { rows: sections } = await query<{ id: string }>(
    `SELECT id FROM sections
     WHERE event_id = $1 AND COALESCE(is_demo, false) = false
     ORDER BY sort_order
     LIMIT 1`,
    [eventId],
  );
  const first = sections[0];
  if (!first) throw new Error('No sections prepared for this night');
  await query(
    `UPDATE events SET current_section_id = $1, current_question_id = NULL,
       section_reveal_answers = false, section_reveal_standings = false,
       section_reveal_answer_index = NULL
     WHERE id = $2`,
    [first.id, eventId],
  );
  const { ensureSectionTopicImages } = await import('./topicImages.js');
  await ensureSectionTopicImages(first.id).catch(() => []);
  return transition(eventId, 'section_active', { sectionId: first.id });
}

export async function isDemoSection(sectionId: string | null): Promise<boolean> {
  if (!sectionId) return false;
  const { rows } = await query<{ is_demo: boolean }>(
    `SELECT is_demo FROM sections WHERE id = $1`,
    [sectionId],
  );
  return Boolean(rows[0]?.is_demo);
}

export async function revealQuestion(eventId: string, questionId: string) {
  const ev = await getEvent(eventId);
  const { rows: snap } = await query<{ content: { timingSeconds: number } }>(
    `SELECT content FROM event_snapshots WHERE event_id = $1 AND question_id = $2`,
    [eventId, questionId],
  );
  if (!snap[0]) throw new Error('Question not in event snapshot');
  const timing = snap[0].content.timingSeconds ?? 30;
  await query(
    `UPDATE events SET
      current_question_id = $1,
      timer_remaining_ms = $2,
      timer_deadline_at = NULL,
      timer_paused = true,
      audio_playing = false,
      section_reveal_answers = false,
      section_reveal_standings = false,
      section_reveal_answer_index = NULL
     WHERE id = $3`,
    [questionId, timing * 1000, eventId],
  );
  await recordReveal(questionId, eventId);

  let result: EventRow;
  if (ev.state === 'section_active' || ev.state === 'answer_closed') {
    result = await transition(eventId, 'question_revealed', { questionId });
  } else if (ev.state === 'question_revealed') {
    broadcast(eventId);
    result = await getEvent(eventId);
  } else {
    throw new Error(`Cannot reveal question from state ${ev.state}`);
  }

  const sectionId = result.current_section_id ?? ev.current_section_id;
  if (sectionId) {
    const { rows: sec } = await query<{ auto_open_answers: boolean }>(
      `SELECT auto_open_answers FROM sections WHERE id = $1`,
      [sectionId],
    );
    if (sec[0]?.auto_open_answers) {
      scheduleAutoOpen(eventId);
    } else {
      clearAutoOpen(eventId);
    }
  }

  return result;
}

export async function openAnswerWindow(eventId: string) {
  clearAutoOpen(eventId);
  const ev = await getEvent(eventId);
  if (ev.state !== 'question_revealed') {
    throw new Error('Reveal question before opening answer window');
  }
  const remaining = ev.timer_remaining_ms ?? 30000;
  const now = new Date();
  const deadline = new Date(now.getTime() + remaining);
  await query(
    `UPDATE events SET timer_deadline_at = $1, timer_paused = false, timer_remaining_ms = $2,
       answer_opened_at = $3 WHERE id = $4`,
    [deadline, remaining, now, eventId],
  );
  return transition(eventId, 'answer_open');
}

export async function closeAnswerWindow(eventId: string) {
  clearAutoOpen(eventId);
  const ev = await getEvent(eventId);
  if (ev.state !== 'answer_open' && ev.state !== 'question_revealed') {
    throw new Error('Answer window not open');
  }
  let remaining = ev.timer_remaining_ms ?? 0;
  if (ev.timer_deadline_at && !ev.timer_paused) {
    remaining = Math.max(0, ev.timer_deadline_at.getTime() - Date.now());
  }
  await query(
    `UPDATE events SET timer_paused = true, timer_remaining_ms = $1, timer_deadline_at = NULL WHERE id = $2`,
    [remaining, eventId],
  );
  return transition(eventId, 'answer_closed');
}

export async function pauseTimer(eventId: string) {
  const ev = await getEvent(eventId);
  if (ev.state !== 'answer_open' || ev.timer_paused) return ev;
  const remaining = ev.timer_deadline_at
    ? Math.max(0, ev.timer_deadline_at.getTime() - Date.now())
    : (ev.timer_remaining_ms ?? 0);
  await query(
    `UPDATE events SET timer_paused = true, timer_remaining_ms = $1, timer_deadline_at = NULL WHERE id = $2`,
    [remaining, eventId],
  );
  broadcast(eventId);
  return getEvent(eventId);
}

export async function resumeTimer(eventId: string) {
  const ev = await getEvent(eventId);
  if (ev.state !== 'answer_open' || !ev.timer_paused) return ev;
  const remaining = ev.timer_remaining_ms ?? 0;
  const deadline = new Date(Date.now() + remaining);
  await query(
    `UPDATE events SET timer_paused = false, timer_deadline_at = $1 WHERE id = $2`,
    [deadline, eventId],
  );
  broadcast(eventId);
  return getEvent(eventId);
}

export async function extendTimer(eventId: string, extraMs: number) {
  const ev = await getEvent(eventId);
  let remaining = ev.timer_remaining_ms ?? 0;
  if (ev.timer_deadline_at && !ev.timer_paused) {
    remaining = Math.max(0, ev.timer_deadline_at.getTime() - Date.now());
  }
  remaining += extraMs;
  if (ev.timer_paused || ev.state !== 'answer_open') {
    await query(`UPDATE events SET timer_remaining_ms = $1 WHERE id = $2`, [
      remaining,
      eventId,
    ]);
  } else {
    const deadline = new Date(Date.now() + remaining);
    await query(
      `UPDATE events SET timer_remaining_ms = $1, timer_deadline_at = $2 WHERE id = $3`,
      [remaining, deadline, eventId],
    );
  }
  broadcast(eventId);
  return getEvent(eventId);
}

/** Called periodically and on restart: expire open windows; pause all on boot. */
export async function tickTimers() {
  const { rows } = await query<EventRow>(
    `SELECT * FROM events WHERE state = 'answer_open' AND timer_paused = false
     AND timer_deadline_at IS NOT NULL AND timer_deadline_at <= now()`,
  );
  for (const ev of rows) {
    await closeAnswerWindow(ev.id);
  }
}

export async function pauseAllLiveEventsOnBoot() {
  await query(
    `UPDATE events SET
      timer_paused = true,
      timer_remaining_ms = CASE
        WHEN timer_deadline_at IS NOT NULL AND timer_paused = false
        THEN GREATEST(0, (EXTRACT(EPOCH FROM (timer_deadline_at - now())) * 1000)::int)
        ELSE timer_remaining_ms
      END,
      timer_deadline_at = NULL
     WHERE state IN ('answer_open','question_revealed','section_active','lobby','section_marking','section_reveal')`,
  );
}

export async function submitAnswer(input: {
  eventId: string;
  teamId: string;
  deviceId: string;
  questionId: string;
  payload: unknown;
  idempotencyKey: string;
}) {
  const ev = await getEvent(input.eventId);
  if (ev.state !== 'answer_open' || ev.timer_paused) {
    const err = new Error(
      ev.timer_paused
        ? 'Submissions disabled while timer is paused'
        : 'Answer window is closed',
    );
    (err as Error & { statusCode: number }).statusCode = 409;
    throw err;
  }
  if (ev.current_question_id !== input.questionId) {
    throw Object.assign(new Error('Not the current question'), { statusCode: 409 });
  }

  const { rows: teams } = await query<{
    active_device_id: string | null;
  }>(`SELECT active_device_id FROM teams WHERE id = $1`, [input.teamId]);
  if (!teams[0] || teams[0].active_device_id !== input.deviceId) {
    throw Object.assign(new Error('This device is not the active answering device'), {
      statusCode: 403,
    });
  }

  const pHash = hashPayload(input.payload);

  return withTransaction(async (client) => {
    const existing = await client.query<{
      id: string;
      revision: number;
      payload_hash: string;
      received_at: Date;
    }>(
      `SELECT id, revision, payload_hash, received_at FROM submissions
       WHERE team_id = $1 AND question_id = $2
       ORDER BY revision DESC LIMIT 1 FOR UPDATE`,
      [input.teamId, input.questionId],
    );

    const last = existing.rows[0];
    if (last && last.payload_hash === pHash) {
      // identical retry — no new revision / timestamp
      return {
        revision: last.revision,
        receivedAt: last.received_at.toISOString(),
        duplicate: true,
      };
    }

    const idem = await client.query(
      `SELECT id FROM submissions WHERE team_id = $1 AND question_id = $2 AND idempotency_key = $3`,
      [input.teamId, input.questionId, input.idempotencyKey],
    );
    if (idem.rows.length && last) {
      return {
        revision: last.revision,
        receivedAt: last.received_at.toISOString(),
        duplicate: true,
      };
    }

    const revision = (last?.revision ?? 0) + 1;
    const openedAt = ev.answer_opened_at ?? new Date();
    const { rows } = await client.query<{ received_at: Date; revision: number }>(
      `INSERT INTO submissions
       (event_id, team_id, question_id, idempotency_key, payload, payload_hash, revision, response_ms)
       VALUES (
         $1,$2,$3,$4,$5::jsonb,$6,$7,
         GREATEST(0, (EXTRACT(EPOCH FROM (now() - $8::timestamptz)) * 1000)::int)
       )
       RETURNING received_at, revision`,
      [
        input.eventId,
        input.teamId,
        input.questionId,
        input.idempotencyKey,
        JSON.stringify(input.payload),
        pHash,
        revision,
        openedAt,
      ],
    );
    return {
      revision: rows[0]!.revision,
      receivedAt: rows[0]!.received_at.toISOString(),
      duplicate: false,
    };
  }).then((r) => {
    broadcast(input.eventId);
    return r;
  });
}

export async function placeWager(input: {
  eventId: string;
  teamId: string;
  deviceId: string;
  questionId: string;
}) {
  const ev = await getEvent(input.eventId);
  if (ev.state !== 'answer_open' || ev.timer_paused) {
    throw Object.assign(new Error('Wagers only during open answer window'), {
      statusCode: 409,
    });
  }
  if (await isDemoSection(ev.current_section_id)) {
    throw Object.assign(new Error('Wagers are disabled during practice'), {
      statusCode: 409,
    });
  }

  return withTransaction(async (client) => {
    const { rows: teams } = await client.query<{
      wagers_remaining: number;
      bonus_section_id: string | null;
      active_device_id: string | null;
    }>(`SELECT wagers_remaining, bonus_section_id, active_device_id FROM teams WHERE id = $1 FOR UPDATE`, [
      input.teamId,
    ]);
    const team = teams[0];
    if (!team || team.active_device_id !== input.deviceId) {
      throw Object.assign(new Error('Device not authorised'), { statusCode: 403 });
    }
    if (team.wagers_remaining <= 0) {
      throw Object.assign(new Error('No wagers remaining'), { statusCode: 409 });
    }
    if (
      team.bonus_section_id &&
      ev.current_section_id &&
      team.bonus_section_id === ev.current_section_id
    ) {
      throw Object.assign(new Error('Cannot wager in bonus section'), {
        statusCode: 409,
      });
    }

    const existing = await client.query(
      `SELECT id FROM wagers WHERE team_id = $1 AND question_id = $2`,
      [input.teamId, input.questionId],
    );
    if (existing.rows.length) {
      return { ok: true, already: true, wagersRemaining: team.wagers_remaining };
    }

    await client.query(
      `INSERT INTO wagers (event_id, team_id, question_id) VALUES ($1,$2,$3)`,
      [input.eventId, input.teamId, input.questionId],
    );
    const { rows: updated } = await client.query<{ wagers_remaining: number }>(
      `UPDATE teams SET wagers_remaining = wagers_remaining - 1 WHERE id = $1 RETURNING wagers_remaining`,
      [input.teamId],
    );
    return {
      ok: true,
      already: false,
      wagersRemaining: updated[0]!.wagers_remaining,
    };
  }).then((r) => {
    broadcast(input.eventId);
    return r;
  });
}

export async function enterMarking(eventId: string) {
  return transition(eventId, 'section_marking');
}

const LLM_MARK_TIMEOUT_MS = 8_000;

async function suggestMarkBounded(
  input: Parameters<typeof suggestMark>[0],
): Promise<unknown> {
  try {
    return await Promise.race([
      suggestMark(input),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new LlmUnavailableError('LLM mark timed out')),
          LLM_MARK_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (e) {
    if (e instanceof LlmUnavailableError) {
      return { unavailable: true, message: 'LLM unavailable — mark manually' };
    }
    throw e;
  }
}

export async function runSectionMarking(eventId: string, sectionId: string) {
  const { rows: snaps } = await query<{
    question_id: string;
    content: {
      points: number;
      format: string;
      answerSpec: AnswerSpec;
      wording: string;
      rubric: string;
      hostNotes?: string;
    };
  }>(
    `SELECT question_id, content FROM event_snapshots
     WHERE event_id = $1 AND section_id = $2 ORDER BY sort_order`,
    [eventId, sectionId],
  );

  const { rows: teams } = await query<{
    id: string;
    bonus_section_id: string | null;
  }>(`SELECT id, bonus_section_id FROM teams WHERE event_id = $1`, [eventId]);

  type Draft = {
    teamId: string;
    questionId: string;
    correctness: 'correct' | 'incorrect' | 'partial' | 'unanswered';
    partialFraction?: number;
    needsDiscretion: boolean;
    receivedAt: number;
    llmJob?: Parameters<typeof suggestMark>[0];
    llmSuggestion: unknown;
  };

  const drafts: Draft[] = [];

  for (const snap of snaps) {
    for (const team of teams) {
      const { rows: subs } = await query<{
        payload: unknown;
        received_at: Date;
      }>(
        `SELECT payload, received_at FROM submissions
         WHERE team_id = $1 AND question_id = $2
         ORDER BY revision DESC LIMIT 1`,
        [team.id, snap.question_id],
      );
      const { rows: wagerRows } = await query(
        `SELECT id FROM wagers WHERE team_id = $1 AND question_id = $2`,
        [team.id, snap.question_id],
      );
      const isWager = wagerRows.length > 0;
      const isBonus = Boolean(
        team.bonus_section_id && team.bonus_section_id === sectionId,
      );
      const sub = subs[0];
      let correctness: Draft['correctness'] = 'unanswered';
      let partialFraction: number | undefined;
      let llmJob: Draft['llmJob'];

      if (sub) {
        const answerSpec = normalizeAnswerSpec(
          snap.content.format,
          snap.content.answerSpec,
        );
        const structured = evaluateStructured(answerSpec, sub.payload);
        correctness = structured.correctness;
        partialFraction = structured.partialFraction;

        if (
          answerSpec.format === 'short_answer' &&
          correctness === 'incorrect'
        ) {
          llmJob = {
            wording: snap.content.wording,
            rubric: snap.content.rubric,
            acceptedAnswers: answerSpec.data.acceptedAnswers,
            submitted: sub.payload,
            hostNotes: snap.content.hostNotes ?? null,
          };
        }
      }

      drafts.push({
        teamId: team.id,
        questionId: snap.question_id,
        correctness,
        partialFraction,
        needsDiscretion: (isBonus || isWager) && correctness === 'partial',
        receivedAt: sub?.received_at.getTime() ?? Number.MAX_SAFE_INTEGER,
        llmJob,
        llmSuggestion: null,
      });
    }
  }

  // Parallel LLM suggestions (bounded) so marking cannot stall the night
  await Promise.all(
    drafts.map(async (d) => {
      if (!d.llmJob) return;
      d.llmSuggestion = await suggestMarkBounded(d.llmJob);
    }),
  );

  for (const d of drafts) {
    await query(
      `INSERT INTO marks
       (event_id, team_id, question_id, correctness, partial_fraction, llm_suggestion, host_approved, needs_discretion, host_overridden)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,false,$7,false)
       ON CONFLICT (event_id, team_id, question_id) DO UPDATE SET
         correctness = CASE
           WHEN marks.host_overridden THEN marks.correctness
           ELSE EXCLUDED.correctness
         END,
         partial_fraction = CASE
           WHEN marks.host_overridden THEN marks.partial_fraction
           ELSE EXCLUDED.partial_fraction
         END,
         llm_suggestion = EXCLUDED.llm_suggestion,
         host_approved = CASE
           WHEN marks.host_overridden THEN marks.host_approved
           ELSE false
         END,
         needs_discretion = CASE
           WHEN marks.host_overridden THEN false
           ELSE EXCLUDED.needs_discretion
         END,
         updated_at = now()`,
      [
        eventId,
        d.teamId,
        d.questionId,
        d.correctness,
        d.partialFraction ?? null,
        d.llmSuggestion ? JSON.stringify(d.llmSuggestion) : null,
        d.needsDiscretion,
      ],
    );
  }

  for (const snap of snaps) {
    const receiptEntries = drafts
      .filter((d) => d.questionId === snap.question_id)
      .map((d) => ({
        teamId: d.teamId,
        receivedAt: d.receivedAt,
        fullyCorrect: d.correctness === 'correct',
      }));
    const winner = pickSpeedWinner(receiptEntries);
    if (winner) {
      await query(
        `UPDATE marks SET is_first_fully_correct = (team_id = $1)
         WHERE event_id = $2 AND question_id = $3`,
        [winner, eventId, snap.question_id],
      );
    }
  }

  broadcast(eventId);
}

export async function approveMarksAndScore(
  eventId: string,
  sectionId: string,
): Promise<void> {
  const { rows: snaps } = await query<{
    question_id: string;
    content: { points: number };
  }>(
    `SELECT question_id, content FROM event_snapshots
     WHERE event_id = $1 AND section_id = $2`,
    [eventId, sectionId],
  );

  const demo = await isDemoSection(sectionId);
  const entryType = demo ? 'demo' : 'answer';

  // Clear prior ledger rows for this section's questions (recalculate)
  for (const snap of snaps) {
    await query(
      `DELETE FROM score_ledger
       WHERE event_id = $1 AND question_id = $2 AND entry_type = ANY($3::text[])`,
      [eventId, snap.question_id, ['answer', 'demo']],
    );
  }

  for (const snap of snaps) {
    const points = snapPoints(snap.content);
    const { rows: marks } = await query<{
      team_id: string;
      correctness: 'correct' | 'incorrect' | 'partial' | 'unanswered';
      partial_fraction: number | null;
      is_first_fully_correct: boolean;
      needs_discretion: boolean;
    }>(
      `SELECT * FROM marks WHERE event_id = $1 AND question_id = $2`,
      [eventId, snap.question_id],
    );

    // Recompute speed winner from marks
    const { rows: subs } = await query<{
      team_id: string;
      received_at: Date;
    }>(
      `SELECT DISTINCT ON (team_id) team_id, received_at FROM submissions
       WHERE event_id = $1 AND question_id = $2
       ORDER BY team_id, revision DESC`,
      [eventId, snap.question_id],
    );
    const subMap = new Map(subs.map((s) => [s.team_id, s.received_at.getTime()]));
    const winner = pickSpeedWinner(
      marks.map((m) => ({
        teamId: m.team_id,
        receivedAt: subMap.get(m.team_id) ?? Number.MAX_SAFE_INTEGER,
        fullyCorrect: m.correctness === 'correct',
      })),
    );

    for (const m of marks) {
      const { rows: teams } = await query<{ bonus_section_id: string | null }>(
        `SELECT bonus_section_id FROM teams WHERE id = $1`,
        [m.team_id],
      );
      const { rows: wagerRows } = await query(
        `SELECT id FROM wagers WHERE team_id = $1 AND question_id = $2`,
        [m.team_id, snap.question_id],
      );
      const breakdown = scoreAnswer({
        basePoints: points,
        correctness: m.correctness,
        partialFraction:
          m.partial_fraction == null ? undefined : Number(m.partial_fraction),
        isFirstFullyCorrect: winner === m.team_id,
        // Practice never uses bonus doubling
        isBonusSection: !demo && teams[0]?.bonus_section_id === sectionId,
        isWager: !demo && wagerRows.length > 0,
      });

      await query(
        `UPDATE marks SET is_first_fully_correct = $1, host_approved = true, updated_at = now()
         WHERE event_id = $2 AND team_id = $3 AND question_id = $4`,
        [winner === m.team_id, eventId, m.team_id, snap.question_id],
      );

      await query(
        `INSERT INTO score_ledger
         (event_id, team_id, question_id, entry_type, answer_points, speed_points, bonus_effect, wager_effect, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          eventId,
          m.team_id,
          snap.question_id,
          entryType,
          breakdown.answerPoints,
          breakdown.speedPoints,
          breakdown.bonusEffect,
          breakdown.wagerEffect,
          demo
            ? 'practice'
            : breakdown.needsHostDiscretion
              ? 'needs_discretion'
              : null,
        ],
      );
    }
  }

  broadcast(eventId);
}

function snapPoints(content: { points?: unknown }): number {
  const n = Number(content?.points);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

async function ensureSectionScored(eventId: string, sectionId: string) {
  const { rows: markCount } = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM marks m
     JOIN event_snapshots es ON es.event_id = m.event_id AND es.question_id = m.question_id
     WHERE m.event_id = $1 AND es.section_id = $2`,
    [eventId, sectionId],
  );
  if (Number(markCount[0]?.c ?? 0) === 0) {
    await runSectionMarking(eventId, sectionId);
  }
  await approveMarksAndScore(eventId, sectionId);
}

async function sectionAnswerCount(
  eventId: string,
  sectionId: string,
): Promise<number> {
  const { rows } = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM event_snapshots
     WHERE event_id = $1 AND section_id = $2`,
    [eventId, sectionId],
  );
  return Number(rows[0]?.c ?? 0);
}

/** Enter section_reveal and show the first answer only. */
export async function beginAnswerReveal(eventId: string) {
  const ev = await getEvent(eventId);
  if (!ev.current_section_id) throw new Error('No section');
  await ensureSectionScored(eventId, ev.current_section_id);
  const count = await sectionAnswerCount(eventId, ev.current_section_id);
  if (count === 0) throw new Error('No questions in this section');

  await query(
    `UPDATE events SET
       section_reveal_answers = true,
       section_reveal_standings = false,
       section_reveal_answer_index = 0
     WHERE id = $1`,
    [eventId],
  );
  const next = await getEvent(eventId);
  if (next.state === 'section_marking') {
    return transition(eventId, 'section_reveal');
  }
  broadcast(eventId);
  return getEvent(eventId);
}

/** Advance to the next answer on the wall. Returns done=true after the last. */
export async function advanceAnswerReveal(eventId: string) {
  const ev = await getEvent(eventId);
  if (ev.state !== 'section_reveal') {
    throw new Error('Not in section reveal');
  }
  if (!ev.current_section_id || !ev.section_reveal_answers) {
    throw new Error('Answer reveal not active');
  }
  if (ev.section_reveal_standings) {
    throw new Error('Standings already showing');
  }
  const count = await sectionAnswerCount(eventId, ev.current_section_id);
  const idx = ev.section_reveal_answer_index ?? 0;
  if (idx + 1 >= count) {
    return { event: ev, done: true, index: idx, total: count };
  }
  await query(
    `UPDATE events SET section_reveal_answer_index = $1 WHERE id = $2`,
    [idx + 1, eventId],
  );
  broadcast(eventId);
  return {
    event: await getEvent(eventId),
    done: idx + 2 >= count,
    index: idx + 1,
    total: count,
  };
}

/** Hide answers and show the running standings table. */
export async function showSectionStandings(eventId: string) {
  const ev = await getEvent(eventId);
  if (ev.current_section_id) {
    await ensureSectionScored(eventId, ev.current_section_id);
  }
  await query(
    `UPDATE events SET
       section_reveal_answers = false,
       section_reveal_standings = true,
       section_reveal_answer_index = NULL
     WHERE id = $1`,
    [eventId],
  );
  const next = await getEvent(eventId);
  if (next.state === 'section_marking') {
    return transition(eventId, 'section_reveal');
  }
  broadcast(eventId);
  return getEvent(eventId);
}

/** @deprecated Prefer beginAnswerReveal / advanceAnswerReveal / showSectionStandings */
export async function revealSection(
  eventId: string,
  opts: { answers: boolean; standings: boolean },
) {
  if (opts.standings && !opts.answers) {
    return showSectionStandings(eventId);
  }
  if (opts.answers && !opts.standings) {
    return beginAnswerReveal(eventId);
  }
  // Legacy "both at once" — start standings after scoring
  const ev = await getEvent(eventId);
  if (ev.current_section_id) {
    await ensureSectionScored(eventId, ev.current_section_id);
  }
  return showSectionStandings(eventId);
}

export async function nextSectionOrFinish(eventId: string) {
  const ev = await getEvent(eventId);
  const { rows: sections } = await query<{ id: string }>(
    `SELECT id FROM sections WHERE event_id = $1 ORDER BY sort_order`,
    [eventId],
  );
  const idx = sections.findIndex((s) => s.id === ev.current_section_id);
  const next = sections[idx + 1];
  if (!next) {
    await markPresentedUsed(eventId, 'used');
    return transition(eventId, 'finished');
  }
  await query(
    `UPDATE events SET
      current_section_id = $1,
      current_question_id = NULL,
      section_reveal_answers = false,
      section_reveal_standings = false,
      section_reveal_answer_index = NULL
     WHERE id = $2`,
    [next.id, eventId],
  );
  const { ensureSectionTopicImages } = await import('./topicImages.js');
  await ensureSectionTopicImages(next.id).catch(() => []);
  return transition(eventId, 'section_active', { sectionId: next.id });
}

export async function abandonEvent(eventId: string) {
  clearAutoOpen(eventId);
  await markPresentedUsed(eventId, 'revealed_abandoned');
  return transition(eventId, 'abandoned');
}

export async function cancelEvent(eventId: string) {
  await releaseUnrevealedReservations(eventId);
  return abandonEvent(eventId);
}

/**
 * Host replay: wipe live progress, keep teams, rebuild play snapshot, return to lobby.
 * Bypasses the normal state machine so finished/abandoned nights can be re-run.
 */
export async function restartEvent(eventId: string) {
  clearAutoOpen(eventId);

  // Restore played questions BEFORE rebuilding the freeze — otherwise
  // buildEventPlaySnapshot only sees approved/reserved and real sections
  // end up empty (used/revealed_abandoned are skipped).
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM submissions WHERE event_id = $1`, [eventId]);
    await client.query(`DELETE FROM wagers WHERE event_id = $1`, [eventId]);
    await client.query(`DELETE FROM marks WHERE event_id = $1`, [eventId]);
    await client.query(`DELETE FROM score_ledger WHERE event_id = $1`, [eventId]);
    await client.query(
      `UPDATE teams SET wagers_remaining = 2 WHERE event_id = $1`,
      [eventId],
    );

    await client.query(
      `UPDATE questions q
       SET status = 'reserved', updated_at = now()
       FROM sections s
       WHERE s.event_id = $1
         AND q.section_id = s.id
         AND q.status IN ('reserved', 'used', 'revealed_abandoned')`,
      [eventId],
    );

    await client.query(
      `DELETE FROM question_history
       WHERE event_id = $1
         AND reason IN ('revealed', 'used', 'revealed_abandoned')`,
      [eventId],
    );

    await client.query(
      `UPDATE events SET
         state = 'lobby',
         current_section_id = NULL,
         current_question_id = NULL,
         timer_deadline_at = NULL,
         timer_remaining_ms = NULL,
         timer_paused = true,
         audio_playing = false,
         section_reveal_answers = false,
         section_reveal_standings = false,
         section_reveal_answer_index = NULL
       WHERE id = $1`,
      [eventId],
    );
  });

  const { buildEventPlaySnapshot } = await import('./eventSnapshot.js');
  await buildEventPlaySnapshot(eventId);
  const ev = await getEvent(eventId);
  if (ev.state === 'draft' || ev.state === 'ready') {
    await query(
      `UPDATE events SET state = 'lobby', nominations_locked = false, timer_paused = true
       WHERE id = $1`,
      [eventId],
    );
  }

  broadcast(eventId);
  return getEvent(eventId);
}

/**
 * Full wipe for a clean live run: same as restart, plus delete all teams
 * (and cascaded devices/sessions). Keeps sections, questions, media, and
 * topic images. Lands in Prep (`ready`) so you can Test again or open lobby.
 */
export async function resetEvent(eventId: string) {
  clearAutoOpen(eventId);

  await withTransaction(async (client) => {
    await client.query(`DELETE FROM submissions WHERE event_id = $1`, [eventId]);
    await client.query(`DELETE FROM wagers WHERE event_id = $1`, [eventId]);
    await client.query(`DELETE FROM marks WHERE event_id = $1`, [eventId]);
    await client.query(`DELETE FROM score_ledger WHERE event_id = $1`, [eventId]);
    await client.query(`DELETE FROM teams WHERE event_id = $1`, [eventId]);

    await client.query(
      `UPDATE questions q
       SET status = 'reserved', updated_at = now()
       FROM sections s
       WHERE s.event_id = $1
         AND q.section_id = s.id
         AND q.status IN ('reserved', 'used', 'revealed_abandoned')`,
      [eventId],
    );

    await client.query(
      `DELETE FROM question_history
       WHERE event_id = $1
         AND reason IN ('revealed', 'used', 'revealed_abandoned')`,
      [eventId],
    );

    await client.query(
      `UPDATE events SET
         state = 'ready',
         nominations_locked = false,
         current_section_id = NULL,
         current_question_id = NULL,
         timer_deadline_at = NULL,
         timer_remaining_ms = NULL,
         timer_paused = true,
         audio_playing = false,
         section_reveal_answers = false,
         section_reveal_standings = false,
         section_reveal_answer_index = NULL,
         answer_opened_at = NULL
       WHERE id = $1`,
      [eventId],
    );
  });

  const { buildEventPlaySnapshot } = await import('./eventSnapshot.js');
  await buildEventPlaySnapshot(eventId);

  broadcast(eventId);
  return getEvent(eventId);
}

export async function hostAdjustScore(input: {
  eventId: string;
  teamId: string;
  delta: number;
  reason: string;
  questionId?: string;
}) {
  await query(
    `INSERT INTO score_ledger
     (event_id, team_id, question_id, entry_type, host_adjustment, reason)
     VALUES ($1,$2,$3,'adjustment',$4,$5)`,
    [
      input.eventId,
      input.teamId,
      input.questionId ?? null,
      input.delta,
      input.reason,
    ],
  );
  broadcast(input.eventId);
}

export async function teamTotals(
  eventId: string,
  opts?: { mode?: 'official' | 'demo' },
) {
  const mode = opts?.mode ?? 'official';
  const entryFilter =
    mode === 'demo'
      ? `AND s.entry_type = 'demo'`
      : `AND (s.entry_type IS NULL OR s.entry_type <> 'demo')`;
  const { rows } = await query<{
    team_id: string;
    name: string;
    avatar_id: string;
    member_names: string[] | null;
    total: string;
  }>(
    `SELECT t.id AS team_id, t.name, t.avatar_id, t.member_names,
       COALESCE(SUM(s.answer_points + s.speed_points + s.bonus_effect + s.wager_effect + s.host_adjustment),0) AS total
     FROM teams t
     LEFT JOIN score_ledger s ON s.team_id = t.id AND s.event_id = t.event_id
       ${entryFilter}
     WHERE t.event_id = $1
     GROUP BY t.id, t.name, t.avatar_id, t.member_names
     ORDER BY total DESC, t.name ASC`,
    [eventId],
  );
  return rows.map((r, i) => ({
    rank: i + 1,
    teamId: r.team_id,
    teamName: r.name,
    avatarId: r.avatar_id,
    members: Array.isArray(r.member_names) ? r.member_names : [],
    score: Number(r.total),
  }));
}

export function getAllowedTransitions(state: EventState) {
  return allowedTransitions(state);
}
