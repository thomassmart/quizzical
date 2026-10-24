import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import {
  inferFormatFromAnswerSpec,
  normalizeAnswerSpec,
} from '@quizzical/shared';
import { requireHost } from '../middleware/auth.js';
import { query } from '../db/client.js';
import { randomCode, normalizeWording } from '../util/normalize.js';
import { checkDuplicates, reserveQuestion } from '../services/exclusion.js';
import {
  generateSectionQuestions,
  LlmUnavailableError,
  embedTexts,
  suggestSectionThemes,
  DEFAULT_SECTION_SUGGESTIONS,
  composeHostNotes,
  composeRevealFact,
} from '../llm/provider.js';
import { llmConfigured } from '../config.js';
import { statusForNewQuestion } from '../services/questionStatus.js';

async function proposeQuestionsForSection(input: {
  sectionId: string;
  eventId: string;
  theme: string;
  difficulty: string;
  count: number;
}): Promise<{ id: string; wording: string; duplicates: unknown }[]> {
  const { rows: events } = await query<{ series_id: string }>(
    `SELECT series_id FROM events WHERE id = $1`,
    [input.eventId],
  );
  const seriesId = events[0]!.series_id;
  const { rows: excluded } = await query<{ wording: string }>(
    `SELECT wording FROM questions WHERE series_id = $1 AND status = ANY($2::text[])`,
    [
      seriesId,
      [
        'used',
        'dismissed',
        'reserved',
        'revealed_abandoned',
        'approved',
        'proposed',
      ],
    ],
  );

  const proposed = await generateSectionQuestions({
    theme: input.theme || 'General',
    count: input.count,
    difficulty: input.difficulty,
    excludedSummaries: excluded.map((e) => e.wording),
  });

  const created: { id: string; wording: string; duplicates: unknown }[] = [];
  for (const p of proposed) {
    const wording = String(p?.wording ?? '').trim();
    if (!wording) continue;

    const format =
      p.format ||
      inferFormatFromAnswerSpec(p.answerSpec) ||
      'short_answer';
    const answerSpec = normalizeAnswerSpec(format, p.answerSpec);

    let embedding: number[] | null = null;
    try {
      const [e] = await embedTexts([wording]);
      embedding = e ?? null;
    } catch {
      embedding = null;
    }
    const hostNotes = composeHostNotes(p);
    const revealFact = composeRevealFact(p);
    const { rows } = await query<{ id: string }>(
      `INSERT INTO questions
       (series_id, section_id, format, wording, wording_normalized, answer_spec, rubric,
        difficulty, theme_tags, points, timing_seconds, source_references, sources_verified,
        host_notes, reveal_fact, status, llm_proposed, embedding)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,false,$13,$14,'approved',true,$15::jsonb)
       RETURNING id`,
      [
        seriesId,
        input.sectionId,
        answerSpec.format,
        wording,
        normalizeWording(wording),
        JSON.stringify(answerSpec),
        p.rubric ?? '',
        p.difficulty ?? input.difficulty,
        p.themeTags ?? [],
        p.points ?? 1,
        p.timingSeconds ?? 30,
        [], // never invent citations from the LLM
        hostNotes,
        revealFact,
        embedding ? JSON.stringify(embedding) : null,
      ],
    );
    const dup = await checkDuplicates({
      seriesId,
      questionId: rows[0]!.id,
      wording,
      embedding,
    });
    created.push({ id: rows[0]!.id, wording, duplicates: dup });
  }

  // Non-spoiling ambience media (theme-based — never uses answers)
  if (created.length) {
    const { ensureQuestionAmbienceMedia } = await import(
      '../services/questionMedia.js'
    );
    await Promise.all(
      created.map((c) =>
        ensureQuestionAmbienceMedia(c.id).catch(() => ({
          imageId: null,
          audioId: null,
        })),
      ),
    );
  }

  return created;
}

type ImportQuestion = {
  format: string;
  wording: string;
  answerSpec: unknown;
  rubric: string;
  difficulty: 'easy' | 'medium' | 'hard';
  themeTags: string[];
  points: number;
  timingSeconds: number;
  sourceReferences: string[];
  sourcesVerified: boolean;
  hostNotes: string | null;
  revealFact: string | null;
  /** Same-DB media UUID; optional in packs. */
  revealImageId: string | null;
};

type ImportSection = {
  title: string;
  theme: string;
  difficulty: 'easy' | 'medium' | 'hard';
  autoOpenAnswers: boolean;
  questions: ImportQuestion[];
};

function asDifficulty(value: unknown): 'easy' | 'medium' | 'hard' {
  if (value === 'easy' || value === 'hard' || value === 'medium') return value;
  return 'medium';
}

function questionFromPlatform(raw: Record<string, unknown>): ImportQuestion | null {
  const wording = String(raw.wording ?? raw.question ?? '').trim();
  if (!wording) return null;

  let answerSpec = raw.answerSpec ?? raw.answer_spec;
  if (!answerSpec) {
    const accepted = [
      ...(Array.isArray(raw.accepted_answers)
        ? raw.accepted_answers.map(String)
        : []),
      ...(raw.answer != null && String(raw.answer).trim()
        ? [String(raw.answer).trim()]
        : []),
    ].filter(Boolean);
    const options = Array.isArray(raw.options)
      ? raw.options
          .map((o, i) => {
            if (!o || typeof o !== 'object') return null;
            const row = o as Record<string, unknown>;
            return {
              id: String(row.id ?? String.fromCharCode(97 + i)),
              label: String(row.label ?? row.text ?? ''),
            };
          })
          .filter((o): o is { id: string; label: string } => Boolean(o?.label))
      : [];
    if (options.length) {
      const correctId =
        raw.correct_option_id != null
          ? String(raw.correct_option_id)
          : options[0]!.id;
      answerSpec = {
        format: 'multiple_choice',
        data: {
          options,
          correctOptionIds: [correctId],
        },
      };
    } else {
      answerSpec = {
        format: 'short_answer',
        data: { acceptedAnswers: accepted.length ? accepted : [''] },
      };
    }
  }

  const type = String(raw.format ?? raw.type ?? '').toLowerCase();
  const format =
    type === 'multiple_choice' || type === 'picture' || type === 'audio'
      ? type === 'multiple_choice'
        ? 'multiple_choice'
        : inferFormatFromAnswerSpec(answerSpec) || 'short_answer'
      : type === 'ordered_list' || type === 'matching'
        ? type
        : inferFormatFromAnswerSpec(answerSpec) || 'short_answer';

  const sources = Array.isArray(raw.sources)
    ? raw.sources
        .map((s) => {
          if (!s || typeof s !== 'object') return null;
          const row = s as Record<string, unknown>;
          return String(row.title ?? row.url ?? '').trim() || null;
        })
        .filter((s): s is string => Boolean(s))
    : [];

  return {
    format,
    wording,
    answerSpec,
    rubric: String(raw.rubric ?? raw.explanation ?? raw.answer ?? ''),
    difficulty: asDifficulty(raw.difficulty),
    themeTags: Array.isArray(raw.themeTags)
      ? raw.themeTags.map(String)
      : Array.isArray(raw.theme_tags)
        ? raw.theme_tags.map(String)
        : raw.category
          ? [String(raw.category)]
          : [],
    points:
      typeof raw.points === 'number' && raw.points > 0
        ? Math.floor(raw.points)
        : 1,
    timingSeconds:
      typeof raw.timingSeconds === 'number' && raw.timingSeconds > 0
        ? Math.floor(raw.timingSeconds)
        : typeof raw.timing_seconds === 'number' && raw.timing_seconds > 0
          ? Math.floor(raw.timing_seconds)
          : 30,
    sourceReferences: Array.isArray(raw.sourceReferences)
      ? raw.sourceReferences.map(String)
      : Array.isArray(raw.source_references)
        ? raw.source_references.map(String)
        : sources,
    sourcesVerified: Boolean(
      raw.sourcesVerified ??
        raw.sources_verified ??
        raw.evidence_status === 'verified',
    ),
    hostNotes:
      raw.hostNotes != null
        ? String(raw.hostNotes)
        : raw.host_notes != null
          ? String(raw.host_notes)
          : null,
    revealFact:
      raw.revealFact != null
        ? String(raw.revealFact)
        : raw.reveal_fact != null
          ? String(raw.reveal_fact)
          : raw.explanation != null
            ? String(raw.explanation)
            : null,
    revealImageId: (() => {
      const v = raw.revealImageId ?? raw.reveal_image_id;
      if (typeof v !== 'string') return null;
      const s = v.trim();
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        s,
      )
        ? s
        : null;
    })(),
  };
}

/** Accept platform packs or neutral question-bank JSON. */
function normalizeImportPack(raw: unknown): ImportSection[] {
  if (!raw || typeof raw !== 'object') return [];
  const root = raw as Record<string, unknown>;

  if (Array.isArray(root.sections)) {
    return root.sections
      .map((s) => {
        if (!s || typeof s !== 'object') return null;
        const sec = s as Record<string, unknown>;
        const title = String(sec.title ?? sec.theme ?? sec.round ?? '').trim();
        if (!title) return null;
        const questions = Array.isArray(sec.questions)
          ? sec.questions
              .map((q) =>
                q && typeof q === 'object'
                  ? questionFromPlatform(q as Record<string, unknown>)
                  : null,
              )
              .filter((q): q is ImportQuestion => Boolean(q))
          : [];
        return {
          title,
          theme: String(sec.theme ?? title),
          difficulty: asDifficulty(sec.difficulty),
          autoOpenAnswers: Boolean(sec.autoOpenAnswers ?? sec.auto_open_answers),
          questions,
        } satisfies ImportSection;
      })
      .filter((s): s is ImportSection => Boolean(s));
  }

  if (Array.isArray(root.questions)) {
    const byRound = new Map<string, ImportQuestion[]>();
    for (const item of root.questions) {
      if (!item || typeof item !== 'object') continue;
      const q = item as Record<string, unknown>;
      const parsed = questionFromPlatform(q);
      if (!parsed) continue;
      const round = String(q.round ?? q.category ?? 'Imported').trim() || 'Imported';
      const list = byRound.get(round) ?? [];
      list.push(parsed);
      byRound.set(round, list);
    }
    return [...byRound.entries()].map(([title, questions]) => ({
      title,
      theme: title,
      difficulty: 'medium' as const,
      autoOpenAnswers: false,
      questions,
    }));
  }

  return [];
}

export async function prepRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/host')) return;
    await requireHost(req, reply);
  });

  app.get('/api/host/series', async () => {
    const { rows } = await query(`SELECT * FROM series ORDER BY created_at DESC`);
    return { series: rows };
  });

  app.post('/api/host/series', async (req) => {
    const body = z
      .object({ name: z.string(), description: z.string().optional() })
      .parse(req.body);
    const { rows } = await query(
      `INSERT INTO series (name, description) VALUES ($1,$2) RETURNING *`,
      [body.name, body.description ?? null],
    );
    return { series: rows[0] };
  });

  app.get('/api/host/series/:seriesId/events', async (req) => {
    const { seriesId } = req.params as { seriesId: string };
    const { rows } = await query(
      `SELECT id, name, code, state, created_at FROM events WHERE series_id = $1 ORDER BY created_at DESC`,
      [seriesId],
    );
    return { events: rows };
  });

  app.get('/api/host/series/:seriesId/history', async (req) => {
    const { seriesId } = req.params as { seriesId: string };
    const { rows } = await query(
      `SELECT h.*, q.wording, q.status, q.theme_tags
       FROM question_history h
       JOIN questions q ON q.id = h.question_id
       WHERE h.series_id = $1
       ORDER BY h.created_at DESC LIMIT 200`,
      [seriesId],
    );
    return { history: rows };
  });

  app.post('/api/host/series/:seriesId/events', async (req) => {
    const { seriesId } = req.params as { seriesId: string };
    const body = z.object({ name: z.string() }).parse(req.body);
    const code = randomCode();
    const wallboardToken = uuid();
    const { rows } = await query(
      `INSERT INTO events (series_id, name, code, wallboard_token, state)
       VALUES ($1,$2,$3,$4,'ready') RETURNING *`,
      [seriesId, body.name, code, wallboardToken],
    );
    return { event: rows[0] };
  });

  app.post('/api/host/events/:eventId/duplicate', async (req) => {
    const { eventId } = req.params as { eventId: string };
    const { rows: events } = await query<{ series_id: string; name: string }>(
      `SELECT series_id, name FROM events WHERE id = $1`,
      [eventId],
    );
    if (!events[0]) throw new Error('Not found');
    const code = randomCode();
    const wallboardToken = uuid();
    const { rows: created } = await query(
      `INSERT INTO events (series_id, name, code, wallboard_token, state)
       VALUES ($1,$2,$3,$4,'ready') RETURNING *`,
      [events[0].series_id, `${events[0].name} (copy)`, code, wallboardToken],
    );
    const newEvent = created[0]!;
    const { rows: sections } = await query<{
      id: string;
      title: string;
      theme: string;
      sort_order: number;
      question_count_target: number;
      difficulty: string;
      auto_open_answers: boolean;
    }>(`SELECT * FROM sections WHERE event_id = $1 ORDER BY sort_order`, [
      eventId,
    ]);
    for (const s of sections) {
      const { rows: ns } = await query<{ id: string }>(
        `INSERT INTO sections (event_id, title, theme, sort_order, question_count_target, difficulty, auto_open_answers)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          newEvent.id,
          s.title,
          s.theme,
          s.sort_order,
          s.question_count_target,
          s.difficulty,
          s.auto_open_answers,
        ],
      );
      // Structure only — do not copy reserved questions
      void ns;
    }
    return { event: newEvent };
  });

  app.get('/api/host/events/:eventId/section-suggestions', async (req) => {
    const { eventId } = req.params as { eventId: string };
    const { rows: events } = await query<{
      name: string;
      series_id: string;
    }>(`SELECT name, series_id FROM events WHERE id = $1`, [eventId]);
    if (!events[0]) return { suggestions: [], source: 'none' as const };

    const { rows: seriesRows } = await query<{ name: string }>(
      `SELECT name FROM series WHERE id = $1`,
      [events[0].series_id],
    );
    const { rows: existing } = await query<{ title: string; theme: string }>(
      `SELECT title, theme FROM sections WHERE event_id = $1`,
      [eventId],
    );
    const { rows: history } = await query<{ theme: string }>(
      `SELECT DISTINCT COALESCE(s.theme, s.title) AS theme
       FROM sections s
       JOIN events e ON e.id = s.event_id
       WHERE e.series_id = $1 AND e.id <> $2
       ORDER BY theme ASC
       LIMIT 40`,
      [events[0].series_id, eventId],
    );

    const existingThemes = existing.map((s) => s.theme || s.title);
    const seriesHistoryThemes = history.map((h) => h.theme).filter(Boolean);

    if (!llmConfigured()) {
      const blocked = new Set(
        [...existingThemes, ...seriesHistoryThemes].map((t) =>
          t.toLowerCase(),
        ),
      );
      return {
        suggestions: DEFAULT_SECTION_SUGGESTIONS.filter(
          (s) => !blocked.has(s.title.toLowerCase()),
        ),
        source: 'fallback' as const,
        note: 'LLM not configured — showing starter themes',
      };
    }

    try {
      const suggestions = await suggestSectionThemes({
        eventName: events[0].name,
        seriesName: seriesRows[0]?.name ?? '',
        existingThemes,
        seriesHistoryThemes,
        count: 6,
      });
      if (!suggestions.length) {
        return {
          suggestions: DEFAULT_SECTION_SUGGESTIONS,
          source: 'fallback' as const,
          note: 'LLM returned no themes — showing starter themes',
        };
      }
      return { suggestions, source: 'llm' as const };
    } catch (e) {
      if (!(e instanceof LlmUnavailableError)) throw e;
      return {
        suggestions: DEFAULT_SECTION_SUGGESTIONS.filter(
          (s) =>
            !existingThemes.some(
              (t) => t.toLowerCase() === s.title.toLowerCase(),
            ),
        ),
        source: 'fallback' as const,
        note: 'LLM unavailable — showing starter themes',
      };
    }
  });

  app.post('/api/host/events/:eventId/sections', async (req) => {
    const { eventId } = req.params as { eventId: string };
    const body = z
      .object({
        title: z.string(),
        theme: z.string().optional(),
        questionCountTarget: z.number().int().min(1).max(20).default(5),
        difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
        autoOpenAnswers: z.boolean().optional().default(false),
        /** When true (default), propose LLM questions after create */
        autoPropose: z.boolean().optional().default(true),
      })
      .parse(req.body);
    const { rows: max } = await query<{ m: number }>(
      `SELECT COALESCE(MAX(sort_order),-1) AS m FROM sections WHERE event_id = $1`,
      [eventId],
    );
    const { rows } = await query<{
      id: string;
      theme: string;
      difficulty: string;
      question_count_target: number;
      event_id: string;
    }>(
      `INSERT INTO sections (event_id, title, theme, sort_order, question_count_target, difficulty, auto_open_answers)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        eventId,
        body.title,
        body.theme ?? body.title,
        (max[0]?.m ?? -1) + 1,
        body.questionCountTarget,
        body.difficulty,
        body.autoOpenAnswers ?? false,
      ],
    );
    const section = rows[0]!;
    const theme = section.theme ?? body.title;

    const imagesPromise = import('../services/topicImages.js').then((m) =>
      m.storeTopicImagesForSection(section.id, theme, body.title).catch(() => []),
    );

    if (!body.autoPropose) {
      await imagesPromise;
      return { section, proposed: [], note: null };
    }
    if (!llmConfigured()) {
      await imagesPromise;
      return {
        section,
        proposed: [],
        note: 'Section created. LLM unavailable — add questions manually or try Propose later.',
      };
    }
    try {
      const [proposed] = await Promise.all([
        proposeQuestionsForSection({
          sectionId: section.id,
          eventId: section.event_id,
          theme,
          difficulty: section.difficulty,
          count: section.question_count_target,
        }),
        imagesPromise,
      ]);
      return {
        section,
        proposed,
        note: `Proposed ${proposed.length} questions with pub-trivia editor rules — approve or dismiss each; verify before locking.`,
      };
    } catch (e) {
      await imagesPromise;
      if (e instanceof LlmUnavailableError) {
        return {
          section,
          proposed: [],
          note: `Section created. Could not propose questions: ${e.message}`,
        };
      }
      throw e;
    }
  });

  app.get('/api/host/events/:eventId', async (req) => {
    const { eventId } = req.params as { eventId: string };
    const { rows: events } = await query(`SELECT * FROM events WHERE id = $1`, [
      eventId,
    ]);
    if (!events[0]) return { error: 'Not found' };
    const { rows: sections } = await query(
      `SELECT * FROM sections WHERE event_id = $1 ORDER BY sort_order`,
      [eventId],
    );
    const { rows: questions } = await query(
      `SELECT q.* FROM questions q
       JOIN sections s ON s.id = q.section_id
       WHERE s.event_id = $1
       ORDER BY s.sort_order, q.created_at`,
      [eventId],
    );
    return { event: events[0], sections, questions };
  });

  app.get('/api/host/events/:eventId/export', async (req, reply) => {
    const { eventId } = req.params as { eventId: string };
    const { rows: events } = await query<{
      id: string;
      name: string;
      code: string;
      state: string;
    }>(`SELECT id, name, code, state FROM events WHERE id = $1`, [eventId]);
    if (!events[0]) return reply.code(404).send({ error: 'Not found' });
    const { rows: sections } = await query<{
      id: string;
      title: string;
      theme: string;
      difficulty: string;
      auto_open_answers: boolean;
      is_demo: boolean;
      sort_order: number;
    }>(
      `SELECT id, title, theme, difficulty, auto_open_answers, is_demo, sort_order
       FROM sections WHERE event_id = $1 ORDER BY sort_order`,
      [eventId],
    );
    const { rows: questions } = await query<{
      section_id: string;
      format: string;
      wording: string;
      answer_spec: unknown;
      rubric: string;
      difficulty: string;
      theme_tags: string[] | null;
      points: number;
      timing_seconds: number;
      source_references: string[] | null;
      sources_verified: boolean;
      host_notes: string | null;
      reveal_fact: string | null;
      reveal_image_id: string | null;
      status: string;
    }>(
      `SELECT q.section_id, q.format, q.wording, q.answer_spec, q.rubric, q.difficulty,
              q.theme_tags, q.points, q.timing_seconds, q.source_references,
              q.sources_verified, q.host_notes, q.reveal_fact, q.reveal_image_id, q.status
       FROM questions q
       JOIN sections s ON s.id = q.section_id
       WHERE s.event_id = $1 AND q.status <> 'dismissed'
       ORDER BY s.sort_order, q.created_at`,
      [eventId],
    );

    const pack = {
      schema_version: 'quizzical.questions/1',
      exported_at: new Date().toISOString(),
      event: {
        name: events[0].name,
        code: events[0].code,
        state: events[0].state,
      },
      sections: sections
        .filter((s) => !s.is_demo)
        .map((s) => ({
          title: s.title,
          theme: s.theme,
          difficulty: s.difficulty,
          autoOpenAnswers: Boolean(s.auto_open_answers),
          questions: questions
            .filter((q) => q.section_id === s.id)
            .map((q) => ({
              format: q.format,
              wording: q.wording,
              answerSpec: q.answer_spec,
              rubric: q.rubric ?? '',
              difficulty: q.difficulty,
              themeTags: q.theme_tags ?? [],
              points: q.points,
              timingSeconds: q.timing_seconds,
              sourceReferences: q.source_references ?? [],
              sourcesVerified: Boolean(q.sources_verified),
              hostNotes: q.host_notes ?? null,
              revealFact: q.reveal_fact ?? null,
              revealImageId: q.reveal_image_id ?? null,
              status: q.status,
            })),
        })),
    };
    return pack;
  });

  app.post('/api/host/events/:eventId/import', async (req, reply) => {
    const { eventId } = req.params as { eventId: string };
    const { rows: events } = await query<{
      id: string;
      series_id: string;
    }>(`SELECT id, series_id FROM events WHERE id = $1`, [eventId]);
    if (!events[0]) return reply.code(404).send({ error: 'Not found' });
    const seriesId = events[0].series_id;

    const body = z
      .object({
        approve: z.boolean().optional().default(true),
        pack: z.unknown(),
      })
      .parse(req.body);

    const sectionsIn = normalizeImportPack(body.pack);
    if (!sectionsIn.length) {
      return reply.code(400).send({
        error:
          'No importable sections/questions found. Expect schema_version quizzical.questions/1 or a questions[] pack.',
      });
    }

    const { rows: existingSections } = await query<{
      id: string;
      title: string;
      theme: string;
    }>(`SELECT id, title, theme FROM sections WHERE event_id = $1`, [eventId]);

    const { rows: max } = await query<{ m: number }>(
      `SELECT COALESCE(MAX(sort_order),-1) AS m FROM sections WHERE event_id = $1`,
      [eventId],
    );
    let nextOrder = (max[0]?.m ?? -1) + 1;

    let sectionsCreated = 0;
    let questionsCreated = 0;
    let questionsSkipped = 0;
    const errors: string[] = [];

    for (const sec of sectionsIn) {
      const title = sec.title.trim();
      if (!title || !sec.questions.length) continue;

      let sectionId = existingSections.find(
        (s) =>
          s.title.toLowerCase() === title.toLowerCase() ||
          s.theme.toLowerCase() === title.toLowerCase(),
      )?.id;

      if (!sectionId) {
        const { rows: created } = await query<{ id: string }>(
          `INSERT INTO sections (event_id, title, theme, sort_order, question_count_target, difficulty, auto_open_answers)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            eventId,
            title,
            sec.theme.trim() || title,
            nextOrder++,
            Math.max(sec.questions.length, 1),
            sec.difficulty,
            sec.autoOpenAnswers,
          ],
        );
        sectionId = created[0]!.id;
        existingSections.push({
          id: sectionId,
          title,
          theme: sec.theme.trim() || title,
        });
        sectionsCreated += 1;
      }

      for (const q of sec.questions) {
        const wording = q.wording.trim();
        if (!wording) {
          questionsSkipped += 1;
          continue;
        }
        try {
          const format =
            q.format ||
            inferFormatFromAnswerSpec(q.answerSpec) ||
            'short_answer';
          const answerSpec = normalizeAnswerSpec(format, q.answerSpec);
          const insertStatus = body.approve ? 'approved' : 'draft';
          const { rows } = await query<{ id: string }>(
            `INSERT INTO questions
             (series_id, section_id, format, wording, wording_normalized, answer_spec, rubric,
              difficulty, theme_tags, points, timing_seconds, source_references, sources_verified,
              host_notes, reveal_fact, reveal_image_id, status, llm_proposed)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,false)
             RETURNING id`,
            [
              seriesId,
              sectionId,
              answerSpec.format,
              wording,
              normalizeWording(wording),
              JSON.stringify(answerSpec),
              q.rubric,
              q.difficulty,
              q.themeTags,
              q.points,
              q.timingSeconds,
              q.sourceReferences,
              q.sourcesVerified,
              q.hostNotes,
              q.revealFact,
              q.revealImageId,
              insertStatus,
            ],
          );
          const questionId = rows[0]!.id;
          const dup = await checkDuplicates({
            seriesId,
            questionId,
            wording,
          });
          if (dup.exactDuplicate) {
            await query(`DELETE FROM questions WHERE id = $1`, [questionId]);
            questionsSkipped += 1;
            continue;
          }
          if (body.approve) {
            const target = await statusForNewQuestion(eventId, true);
            if (target === 'reserved') {
              await reserveQuestion(questionId, eventId);
            }
          }
          questionsCreated += 1;
        } catch (err) {
          questionsSkipped += 1;
          errors.push(
            err instanceof Error
              ? `${wording.slice(0, 40)}…: ${err.message}`
              : 'Import row failed',
          );
        }
      }
    }

    return {
      ok: true,
      sectionsCreated,
      questionsCreated,
      questionsSkipped,
      errors: errors.slice(0, 10),
      note: `Imported ${questionsCreated} question${questionsCreated === 1 ? '' : 's'}${
        sectionsCreated
          ? ` across ${sectionsCreated} new section${sectionsCreated === 1 ? '' : 's'}`
          : ''
      }${questionsSkipped ? ` (${questionsSkipped} skipped)` : ''}.`,
    };
  });

  app.patch('/api/host/sections/reorder', async (req) => {
    const body = z
      .object({
        eventId: z.string().uuid(),
        orderedIds: z.array(z.string().uuid()),
      })
      .parse(req.body);
    for (let i = 0; i < body.orderedIds.length; i++) {
      await query(
        `UPDATE sections SET sort_order = $1 WHERE id = $2 AND event_id = $3`,
        [i, body.orderedIds[i], body.eventId],
      );
    }
    return { ok: true };
  });

  app.patch('/api/host/sections/:sectionId', async (req, reply) => {
    const { sectionId } = req.params as { sectionId: string };
    const body = z
      .object({
        title: z.string().min(1).optional(),
        theme: z.string().min(1).optional(),
        difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
        questionCountTarget: z.number().int().min(1).max(20).optional(),
        autoOpenAnswers: z.boolean().optional(),
      })
      .parse(req.body);
    const { rows } = await query(
      `UPDATE sections SET
         title = COALESCE($1, title),
         theme = COALESCE($2, theme),
         difficulty = COALESCE($3, difficulty),
         question_count_target = COALESCE($4, question_count_target),
         auto_open_answers = COALESCE($5, auto_open_answers)
       WHERE id = $6
       RETURNING *`,
      [
        body.title ?? null,
        body.theme ?? body.title ?? null,
        body.difficulty ?? null,
        body.questionCountTarget ?? null,
        body.autoOpenAnswers ?? null,
        sectionId,
      ],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
    if (body.title !== undefined || body.theme !== undefined) {
      const s = rows[0] as { id: string; title: string; theme: string };
      void import('../services/topicImages.js').then((m) =>
        m.storeTopicImagesForSection(s.id, s.theme || s.title, s.title),
      );
    }
    return { section: rows[0] };
  });

  app.delete('/api/host/sections/:sectionId', async (req, reply) => {
    const { sectionId } = req.params as { sectionId: string };
    const { rows: demoCheck } = await query<{ is_demo: boolean }>(
      `SELECT is_demo FROM sections WHERE id = $1`,
      [sectionId],
    );
    if (demoCheck[0]?.is_demo) {
      return reply.code(400).send({
        error: 'Practice section is required and cannot be deleted',
      });
    }
    const { rows: bound } = await query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM questions
       WHERE section_id = $1 AND status IN ('reserved','used','revealed_abandoned')`,
      [sectionId],
    );
    if (Number(bound[0]?.c ?? 0) > 0) {
      return reply.code(409).send({
        error: 'Cannot delete a section with reserved or used questions',
      });
    }
    // Unlink draft/proposed/approved/dismissed questions from the section
    await query(
      `UPDATE questions SET section_id = NULL WHERE section_id = $1`,
      [sectionId],
    );
    const { rows } = await query(
      `DELETE FROM sections WHERE id = $1 RETURNING id`,
      [sectionId],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
    return { ok: true };
  });

  app.post('/api/host/sections/:sectionId/questions', async (req, reply) => {
    const { sectionId } = req.params as { sectionId: string };
    const body = z
      .object({
        format: z.enum([
          'multiple_choice',
          'short_answer',
          'ordered_list',
          'matching',
        ]),
        wording: z.string().min(1),
        answerSpec: z.unknown(),
        rubric: z.string().default(''),
        difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
        themeTags: z.array(z.string()).default([]),
        points: z.number().int().positive().default(1),
        timingSeconds: z.number().int().positive().default(30),
        sourceReferences: z.array(z.string()).default([]),
        sourcesVerified: z.boolean().default(false),
        mediaImageId: z.string().uuid().nullable().optional(),
        mediaAudioId: z.string().uuid().nullable().optional(),
        mediaVideoId: z.string().uuid().nullable().optional(),
        hostNotes: z.string().optional(),
        revealFact: z.string().nullable().optional(),
        /** Answer-sheet image — reveal only */
        revealImageId: z.string().uuid().nullable().optional(),
        approve: z.boolean().default(true),
      })
      .parse(req.body);

    const { rows: sections } = await query<{
      event_id: string;
    }>(`SELECT event_id FROM sections WHERE id = $1`, [sectionId]);
    const section = sections[0];
    if (!section) {
      return reply.code(404).send({ error: 'Section not found' });
    }
    const { rows: events } = await query<{ series_id: string; id: string }>(
      `SELECT series_id, id FROM events WHERE id = $1`,
      [section.event_id],
    );
    const event = events[0];
    if (!event) {
      return reply.code(404).send({ error: 'Event not found' });
    }
    const seriesId = event.series_id;
    const eventId = event.id;

    // Insert as approved/draft first; reserve after if the night is already prepared.
    const insertStatus = body.approve ? 'approved' : 'draft';

    const { rows } = await query<{ id: string }>(
      `INSERT INTO questions
       (series_id, section_id, format, wording, wording_normalized, answer_spec, rubric,
        difficulty, theme_tags, points, timing_seconds, source_references, sources_verified,
        media_image_id, media_audio_id, media_video_id, host_notes, reveal_fact, reveal_image_id,
        status, llm_proposed)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,false)
       RETURNING id`,
      [
        seriesId,
        sectionId,
        body.format,
        body.wording,
        normalizeWording(body.wording),
        JSON.stringify(body.answerSpec),
        body.rubric,
        body.difficulty,
        body.themeTags,
        body.points,
        body.timingSeconds,
        body.sourceReferences,
        body.sourcesVerified,
        body.mediaImageId ?? null,
        body.mediaAudioId ?? null,
        body.mediaVideoId ?? null,
        body.hostNotes ?? null,
        body.revealFact ?? null,
        body.revealImageId ?? null,
        insertStatus,
      ],
    );
    const questionId = rows[0]!.id;
    const dup = await checkDuplicates({
      seriesId,
      questionId,
      wording: body.wording,
    });
    if (dup.exactDuplicate) {
      await query(`DELETE FROM questions WHERE id = $1`, [questionId]);
      return { error: 'Exact duplicate blocked', blocked: true };
    }

    let status = insertStatus;
    if (body.approve) {
      const target = await statusForNewQuestion(eventId, true);
      if (target === 'reserved') {
        await reserveQuestion(questionId, eventId);
        status = 'reserved';
      }
    }

    if (!body.mediaImageId && !body.mediaAudioId && !body.mediaVideoId) {
      const { ensureQuestionAmbienceMedia } = await import(
        '../services/questionMedia.js'
      );
      await ensureQuestionAmbienceMedia(questionId).catch(() => null);
    }
    return { questionId, status, duplicates: dup };
  });

  app.get('/api/host/questions/:questionId', async (req, reply) => {
    const { questionId } = req.params as { questionId: string };
    const { rows } = await query(`SELECT * FROM questions WHERE id = $1`, [
      questionId,
    ]);
    if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
    return { question: rows[0] };
  });

  app.patch('/api/host/questions/:questionId', async (req, reply) => {
    const { questionId } = req.params as { questionId: string };
    const body = z
      .object({
        wording: z.string().min(1).optional(),
        answerSpec: z.unknown().optional(),
        rubric: z.string().optional(),
        difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
        points: z.number().int().positive().optional(),
        timingSeconds: z.number().int().positive().optional(),
        sourceReferences: z.array(z.string()).optional(),
        sourcesVerified: z.boolean().optional(),
        mediaImageId: z.string().uuid().nullable().optional(),
        mediaAudioId: z.string().uuid().nullable().optional(),
        mediaVideoId: z.string().uuid().nullable().optional(),
        hostNotes: z.string().nullable().optional(),
        revealFact: z.string().nullable().optional(),
        revealImageId: z.string().uuid().nullable().optional(),
        status: z
          .enum(['draft', 'proposed', 'approved', 'reserved'])
          .optional(),
      })
      .parse(req.body);

    const { rows: existing } = await query<{
      id: string;
      status: string;
      section_id: string | null;
    }>(`SELECT id, status, section_id FROM questions WHERE id = $1`, [
      questionId,
    ]);
    if (!existing[0]) return reply.code(404).send({ error: 'Not found' });
    if (['used', 'revealed_abandoned'].includes(existing[0].status)) {
      return reply
        .code(409)
        .send({ error: `Cannot edit question in status ${existing[0].status}` });
    }

    // reserved matches freeze: assign to the question's event when prepared/ready.
    let statusForUpdate: string | null = body.status ?? null;
    if (body.status === 'reserved') {
      if (!existing[0].section_id) {
        return reply
          .code(400)
          .send({ error: 'Cannot reserve a question with no section' });
      }
      const { rows: secRows } = await query<{ event_id: string }>(
        `SELECT event_id FROM sections WHERE id = $1`,
        [existing[0].section_id],
      );
      const eventId = secRows[0]?.event_id;
      if (!eventId) {
        return reply.code(400).send({ error: 'Section has no event' });
      }
      await reserveQuestion(questionId, eventId);
      statusForUpdate = null; // reserveQuestion already set status + history
    }

    const { rows } = await query(
      `UPDATE questions SET
         wording = COALESCE($1, wording),
         wording_normalized = COALESCE($2, wording_normalized),
         answer_spec = COALESCE($3::jsonb, answer_spec),
         rubric = COALESCE($4, rubric),
         difficulty = COALESCE($5, difficulty),
         points = COALESCE($6, points),
         timing_seconds = COALESCE($7, timing_seconds),
         source_references = COALESCE($8, source_references),
         sources_verified = COALESCE($9, sources_verified),
         media_image_id = CASE WHEN $10::boolean THEN $11::uuid ELSE media_image_id END,
         media_audio_id = CASE WHEN $12::boolean THEN $13::uuid ELSE media_audio_id END,
         media_video_id = CASE WHEN $14::boolean THEN $15::uuid ELSE media_video_id END,
         host_notes = CASE WHEN $16::boolean THEN $17 ELSE host_notes END,
         reveal_fact = CASE WHEN $18::boolean THEN $19 ELSE reveal_fact END,
         reveal_image_id = CASE WHEN $20::boolean THEN $21::uuid ELSE reveal_image_id END,
         status = COALESCE($22, status),
         updated_at = now()
       WHERE id = $23
       RETURNING *`,
      [
        body.wording ?? null,
        body.wording ? normalizeWording(body.wording) : null,
        body.answerSpec !== undefined ? JSON.stringify(body.answerSpec) : null,
        body.rubric ?? null,
        body.difficulty ?? null,
        body.points ?? null,
        body.timingSeconds ?? null,
        body.sourceReferences ?? null,
        body.sourcesVerified ?? null,
        body.mediaImageId !== undefined,
        body.mediaImageId ?? null,
        body.mediaAudioId !== undefined,
        body.mediaAudioId ?? null,
        body.mediaVideoId !== undefined,
        body.mediaVideoId ?? null,
        body.hostNotes !== undefined,
        body.hostNotes ?? null,
        body.revealFact !== undefined,
        body.revealFact ?? null,
        body.revealImageId !== undefined,
        body.revealImageId ?? null,
        statusForUpdate,
        questionId,
      ],
    );

    let q = rows[0] as {
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
    };

    // Auto-attach ambience if still bare after save/approve
    if (!q.media_image_id && !q.media_audio_id && !q.media_video_id) {
      const { ensureQuestionAmbienceMedia } = await import(
        '../services/questionMedia.js'
      );
      await ensureQuestionAmbienceMedia(questionId).catch(() => null);
      const { rows: refreshed } = await query(`SELECT * FROM questions WHERE id = $1`, [
        questionId,
      ]);
      if (refreshed[0]) q = refreshed[0] as typeof q;
    }

    // Keep locked snapshots in sync when media/wording change before go-live
    if (
      body.mediaImageId !== undefined ||
      body.mediaAudioId !== undefined ||
      body.mediaVideoId !== undefined ||
      body.wording !== undefined ||
      body.answerSpec !== undefined ||
      body.points !== undefined ||
      body.timingSeconds !== undefined ||
      body.rubric !== undefined ||
      body.revealFact !== undefined ||
      body.revealImageId !== undefined ||
      body.status !== undefined
    ) {
      await query(
        `UPDATE event_snapshots es
         SET content = $1::jsonb
         FROM events e
         WHERE es.event_id = e.id
           AND es.question_id = $2
           AND e.state IN ('draft', 'ready', 'lobby')`,
        [
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
          questionId,
        ],
      );
    }

    return { question: q };
  });

  app.post('/api/host/questions/:questionId/approve', async (req) => {
    const { questionId } = req.params as { questionId: string };
    // draft/proposed → approved; dismissed → approved restores for reuse
    const { rows } = await query<{
      id: string;
      series_id: string;
      status: string;
      section_id: string | null;
    }>(
      `UPDATE questions SET status = 'approved', updated_at = now()
       WHERE id = $1 AND status IN ('draft','proposed','dismissed')
       RETURNING id, series_id, status, section_id`,
      [questionId],
    );
    let finalStatus: string | null = rows[0]?.status ?? null;
    if (rows[0]) {
      await query(
        `INSERT INTO question_history (series_id, question_id, reason, detail)
         VALUES ($1,$2,'approved',$3)`,
        [
          rows[0].series_id,
          questionId,
          'Host approved or restored question',
        ],
      );
      if (rows[0].section_id) {
        const { rows: secRows } = await query<{ event_id: string }>(
          `SELECT event_id FROM sections WHERE id = $1`,
          [rows[0].section_id],
        );
        const eventId = secRows[0]?.event_id;
        if (eventId) {
          const target = await statusForNewQuestion(eventId, true);
          if (target === 'reserved') {
            await reserveQuestion(questionId, eventId);
            finalStatus = 'reserved';
          }
        }
      }
      const { ensureQuestionAmbienceMedia } = await import(
        '../services/questionMedia.js'
      );
      await ensureQuestionAmbienceMedia(questionId).catch(() => null);
    }
    return {
      ok: true,
      restored: Boolean(rows[0]),
      status: finalStatus,
    };
  });

  app.post('/api/host/questions/:questionId/dismiss', async (req) => {
    const { questionId } = req.params as { questionId: string };
    const { rows } = await query<{ series_id: string }>(
      `UPDATE questions SET status = 'dismissed', updated_at = now() WHERE id = $1 RETURNING series_id`,
      [questionId],
    );
    if (rows[0]) {
      await query(
        `INSERT INTO question_history (series_id, question_id, reason, detail)
         VALUES ($1,$2,'dismissed','Explicitly dismissed by host')`,
        [rows[0].series_id, questionId],
      );
    }
    return { ok: true };
  });

  app.post('/api/host/duplicates/:id/resolve', async (req) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({ resolution: z.enum(['keep', 'dismiss_new', 'dismiss_existing']) })
      .parse(req.body);
    const { rows } = await query<{
      new_question_id: string;
      existing_question_id: string;
    }>(`SELECT * FROM duplicate_candidates WHERE id = $1`, [id]);
    if (!rows[0]) return { error: 'Not found' };
    if (body.resolution === 'dismiss_new') {
      await query(`UPDATE questions SET status = 'dismissed' WHERE id = $1`, [
        rows[0].new_question_id,
      ]);
    } else if (body.resolution === 'dismiss_existing') {
      await query(`UPDATE questions SET status = 'dismissed' WHERE id = $1`, [
        rows[0].existing_question_id,
      ]);
    }
    await query(
      `UPDATE duplicate_candidates SET status = 'resolved', resolution = $1 WHERE id = $2`,
      [body.resolution, id],
    );
    return { ok: true };
  });

  app.post('/api/host/sections/:sectionId/generate', async (req, reply) => {
    const { sectionId } = req.params as { sectionId: string };
    if (!llmConfigured()) {
      return reply.code(503).send({
        error: 'LLM unavailable — create questions manually',
      });
    }
    const { rows: sections } = await query<{
      id: string;
      theme: string;
      question_count_target: number;
      difficulty: string;
      event_id: string;
    }>(`SELECT * FROM sections WHERE id = $1`, [sectionId]);
    const section = sections[0];
    if (!section) return reply.code(404).send({ error: 'Not found' });

    try {
      const created = await proposeQuestionsForSection({
        sectionId: section.id,
        eventId: section.event_id,
        theme: section.theme ?? 'General',
        difficulty: section.difficulty,
        count: section.question_count_target,
      });
      return {
        proposed: created,
        note: 'Proposed with pub-trivia editor rules. Each question needs host approval; evidence is needs_review until you verify.',
      };
    } catch (e) {
      if (e instanceof LlmUnavailableError) {
        return reply.code(503).send({ error: e.message });
      }
      throw e;
    }
  });

  app.post('/api/host/events/:eventId/teams/:teamId/replace-device', async (req) => {
    const { teamId } = req.params as { eventId: string; teamId: string };
    const body = z.object({ newDeviceId: z.string() }).parse(req.body);
    const { rows } = await query<{ active_device_id: string | null }>(
      `SELECT active_device_id FROM teams WHERE id = $1`,
      [teamId],
    );
    if (rows[0]?.active_device_id) {
      await query(
        `UPDATE team_devices SET revoked = true WHERE team_id = $1 AND device_id = $2`,
        [teamId, rows[0].active_device_id],
      );
    }
    await query(`UPDATE teams SET active_device_id = $1 WHERE id = $2`, [
      body.newDeviceId,
      teamId,
    ]);
    await query(
      `INSERT INTO team_devices (team_id, device_id) VALUES ($1,$2)
       ON CONFLICT (team_id, device_id) DO UPDATE SET revoked = false, last_seen_at = now()`,
      [teamId, body.newDeviceId],
    );
    return { ok: true };
  });
}
