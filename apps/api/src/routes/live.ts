import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireHost, requireTeam } from '../middleware/auth.js';
import type { TeamClaims } from '../auth/tokens.js';
import {
  abandonEvent,
  advanceAnswerReveal,
  approveMarksAndScore,
  beginAnswerReveal,
  beginPractice,
  skipPractice,
  cancelEvent,
  closeAnswerWindow,
  enterMarking,
  extendTimer,
  hostAdjustScore,
  nextSectionOrFinish,
  openAnswerWindow,
  openLobby,
  pauseTimer,
  placeWager,
  restartEvent,
  resetEvent,
  revealQuestion,
  revealSection,
  resumeTimer,
  runSectionMarking,
  showSectionStandings,
  startGame,
  startTestRun,
  submitAnswer,
  teamTotals,
  getEvent,
} from '../services/gameplay.js';
import {
  buildHostSnapshot,
  buildTeamSnapshot,
  buildWallboardSnapshot,
} from '../services/snapshots.js';
import { query } from '../db/client.js';
import { requireWall } from '../middleware/auth.js';

export async function liveRoutes(app: FastifyInstance) {
  app.post('/api/host/events/:eventId/lobby', { preHandler: requireHost }, async (req) => {
    const { eventId } = req.params as { eventId: string };
    return { event: await openLobby(eventId) };
  });

  app.post('/api/host/events/:eventId/start', { preHandler: requireHost }, async (req) => {
    const { eventId } = req.params as { eventId: string };
    return { event: await startGame(eventId) };
  });

  app.post('/api/host/events/:eventId/test', { preHandler: requireHost }, async (req) => {
    const { eventId } = req.params as { eventId: string };
    return { event: await startTestRun(eventId) };
  });

  app.post(
    '/api/host/events/:eventId/begin-practice',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      return { event: await beginPractice(eventId) };
    },
  );

  app.post(
    '/api/host/events/:eventId/skip-practice',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      return { event: await skipPractice(eventId) };
    },
  );

  app.post(
    '/api/host/events/:eventId/reveal-question',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      const body = z.object({ questionId: z.string().uuid() }).parse(req.body);
      return { event: await revealQuestion(eventId, body.questionId) };
    },
  );

  app.post(
    '/api/host/events/:eventId/open-answers',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      return { event: await openAnswerWindow(eventId) };
    },
  );

  app.post(
    '/api/host/events/:eventId/close-answers',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      return { event: await closeAnswerWindow(eventId) };
    },
  );

  app.post('/api/host/events/:eventId/pause', { preHandler: requireHost }, async (req) => {
    const { eventId } = req.params as { eventId: string };
    return { event: await pauseTimer(eventId) };
  });

  app.post('/api/host/events/:eventId/resume', { preHandler: requireHost }, async (req) => {
    const { eventId } = req.params as { eventId: string };
    return { event: await resumeTimer(eventId) };
  });

  app.post('/api/host/events/:eventId/extend', { preHandler: requireHost }, async (req) => {
    const { eventId } = req.params as { eventId: string };
    const body = z.object({ extraMs: z.number().int().positive() }).parse(req.body);
    return { event: await extendTimer(eventId, body.extraMs) };
  });

  app.post(
    '/api/host/events/:eventId/audio',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      const body = z.object({ playing: z.boolean() }).parse(req.body);
      await query(`UPDATE events SET audio_playing = $1 WHERE id = $2`, [
        body.playing,
        eventId,
      ]);
      const { hub } = await import('../ws/hub.js');
      hub.broadcastEvent(eventId);
      return { ok: true };
    },
  );

  app.post(
    '/api/host/events/:eventId/marking/start',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      const ev = await enterMarking(eventId);
      if (ev.current_section_id) {
        // Build the queue only — host reviews before approve/reveal
        await runSectionMarking(eventId, ev.current_section_id);
      }
      return { event: ev, totals: await teamTotals(eventId) };
    },
  );

  app.get(
    '/api/host/events/:eventId/marking',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      const ev = await getEvent(eventId);
      const { rows: marks } = await query(
        `SELECT m.*, t.name AS team_name, s.payload AS submitted,
                es.content AS question_content,
                (w.id IS NOT NULL) AS wagered
         FROM marks m
         JOIN teams t ON t.id = m.team_id
         LEFT JOIN LATERAL (
           SELECT payload FROM submissions
           WHERE team_id = m.team_id AND question_id = m.question_id
           ORDER BY revision DESC LIMIT 1
         ) s ON true
         JOIN event_snapshots es ON es.event_id = m.event_id AND es.question_id = m.question_id
         LEFT JOIN wagers w
           ON w.event_id = m.event_id
          AND w.team_id = m.team_id
          AND w.question_id = m.question_id
         WHERE m.event_id = $1 AND es.section_id = $2
         ORDER BY es.sort_order, t.name`,
        [eventId, ev.current_section_id],
      );
      return { marks };
    },
  );

  app.patch(
    '/api/host/events/:eventId/marking/:markId',
    { preHandler: requireHost },
    async (req, reply) => {
      const { eventId, markId } = req.params as {
        eventId: string;
        markId: string;
      };
      const parsed = z
        .object({
          correctness: z.enum(['correct', 'incorrect', 'partial', 'unanswered']),
          partialFraction: z.number().min(0).max(1).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid mark update' });
      }
      const body = parsed.data;
      const partialFraction =
        body.correctness === 'partial' ? (body.partialFraction ?? 0.5) : null;
      const { rows } = await query<{
        id: string;
        correctness: string;
        partial_fraction: number | null;
        needs_discretion: boolean;
        host_approved: boolean;
        host_overridden: boolean;
      }>(
        `UPDATE marks SET
           correctness = $1,
           partial_fraction = $2,
           needs_discretion = false,
           host_approved = false,
           host_overridden = true,
           updated_at = now()
         WHERE id = $3 AND event_id = $4
         RETURNING id, correctness, partial_fraction, needs_discretion,
                   host_approved, host_overridden`,
        [body.correctness, partialFraction, markId, eventId],
      );
      if (!rows[0]) {
        return reply.code(404).send({ error: 'Mark not found' });
      }
      const ev = await getEvent(eventId);
      // Re-score only after ledger already exists (post-approve / during reveal)
      if (ev.current_section_id && ev.state === 'section_reveal') {
        await approveMarksAndScore(eventId, ev.current_section_id);
      }
      const { hub } = await import('../ws/hub.js');
      hub.broadcastEvent(eventId);
      return {
        ok: true,
        mark: rows[0],
        totals: await teamTotals(eventId),
      };
    },
  );

  app.post(
    '/api/host/events/:eventId/marking/approve',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      const ev = await getEvent(eventId);
      if (!ev.current_section_id) throw new Error('No section');
      await approveMarksAndScore(eventId, ev.current_section_id);
      return { ok: true, totals: await teamTotals(eventId) };
    },
  );

  app.post(
    '/api/host/events/:eventId/reveal-section',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      const body = z
        .object({ answers: z.boolean(), standings: z.boolean() })
        .parse(req.body);
      return { event: await revealSection(eventId, body) };
    },
  );

  app.post(
    '/api/host/events/:eventId/reveal-answers',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      return { event: await beginAnswerReveal(eventId) };
    },
  );

  app.post(
    '/api/host/events/:eventId/reveal-next-answer',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      return await advanceAnswerReveal(eventId);
    },
  );

  app.post(
    '/api/host/events/:eventId/reveal-standings',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      return { event: await showSectionStandings(eventId) };
    },
  );

  app.post(
    '/api/host/events/:eventId/next-section',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      return { event: await nextSectionOrFinish(eventId) };
    },
  );

  app.post(
    '/api/host/events/:eventId/abandon',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      return { event: await abandonEvent(eventId) };
    },
  );

  app.post(
    '/api/host/events/:eventId/restart',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      return { event: await restartEvent(eventId) };
    },
  );

  app.post(
    '/api/host/events/:eventId/reset',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      return { event: await resetEvent(eventId) };
    },
  );

  app.post(
    '/api/host/events/:eventId/cancel',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      return { event: await cancelEvent(eventId) };
    },
  );

  app.post(
    '/api/host/events/:eventId/adjust-score',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      const body = z
        .object({
          teamId: z.string().uuid(),
          delta: z.number(),
          reason: z.string().min(1),
          questionId: z.string().uuid().optional(),
        })
        .parse(req.body);
      await hostAdjustScore({ eventId, ...body });
      return { totals: await teamTotals(eventId) };
    },
  );

  app.get(
    '/api/host/events/:eventId/live',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      return buildHostSnapshot(eventId);
    },
  );

  app.get(
    '/api/host/events/:eventId/next-question',
    { preHandler: requireHost },
    async (req) => {
      const { eventId } = req.params as { eventId: string };
      const ev = await getEvent(eventId);
      const { rows } = await query<{
        question_id: string;
        sort_order: number;
        content: unknown;
      }>(
        `SELECT question_id, sort_order, content FROM event_snapshots
         WHERE event_id = $1 AND section_id = $2
         ORDER BY sort_order`,
        [eventId, ev.current_section_id],
      );
      const idx = rows.findIndex((r) => r.question_id === ev.current_question_id);
      const next = rows[idx + 1] ?? rows[0];
      return { questions: rows, next, currentIndex: idx };
    },
  );

  // Team
  app.post('/api/play/submit', { preHandler: requireTeam }, async (req, reply) => {
    const claims = req.auth as TeamClaims;
    const body = z
      .object({
        questionId: z.string().uuid(),
        payload: z.unknown(),
        idempotencyKey: z.string().min(1),
      })
      .parse(req.body);
    try {
      const result = await submitAnswer({
        eventId: claims.eventId,
        teamId: claims.teamId,
        deviceId: claims.deviceId,
        questionId: body.questionId,
        payload: body.payload,
        idempotencyKey: body.idempotencyKey,
      });
      return { ack: result };
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      return reply.code(err.statusCode ?? 400).send({ error: err.message });
    }
  });

  app.post('/api/play/wager', { preHandler: requireTeam }, async (req, reply) => {
    const claims = req.auth as TeamClaims;
    const body = z.object({ questionId: z.string().uuid() }).parse(req.body);
    try {
      return await placeWager({
        eventId: claims.eventId,
        teamId: claims.teamId,
        deviceId: claims.deviceId,
        questionId: body.questionId,
      });
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      return reply.code(err.statusCode ?? 400).send({ error: err.message });
    }
  });

  app.get('/api/play/state', { preHandler: requireTeam }, async (req) => {
    return buildTeamSnapshot(req.auth as TeamClaims);
  });

  app.get('/api/wall/state', { preHandler: requireWall }, async (req) => {
    const claims = req.auth as { eventId: string };
    return buildWallboardSnapshot(claims.eventId);
  });
}
