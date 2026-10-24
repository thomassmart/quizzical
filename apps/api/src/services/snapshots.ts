import {
  normalizeAnswerSpec,
  parseAvatarId,
  parseBuzzerId,
  type HostSnapshot,
  type TeamPlaySnapshot,
  type WallboardSnapshot,
  type AnswerSpec,
  type EventState,
} from '@quizzical/shared';
import { query } from '../db/client.js';
import { config } from '../config.js';
import {
  getAllowedTransitions,
  getEvent,
  isDemoSection,
  teamTotals,
} from './gameplay.js';
import {
  topicImageUrls,
  type StoredTopicImage,
} from './topicImages.js';
import type { TeamClaims } from '../auth/tokens.js';

type BonusStatus = 'this_section' | 'used' | 'remaining' | 'none';

/** Resolve bonus nomination status relative to the current (or last) section. */
async function teamBonusMeta(eventId: string, currentSectionId: string | null) {
  const { rows: teams } = await query<{
    id: string;
    name: string;
    avatar_id: string;
    wagers_remaining: number;
    bonus_section_id: string | null;
  }>(
    `SELECT id, name, avatar_id, wagers_remaining, bonus_section_id
     FROM teams WHERE event_id = $1`,
    [eventId],
  );

  const { rows: sections } = await query<{ id: string; sort_order: number }>(
    `SELECT id, sort_order FROM sections WHERE event_id = $1`,
    [eventId],
  );
  const orderById = new Map(sections.map((s) => [s.id, s.sort_order]));
  const currentOrder =
    currentSectionId != null ? (orderById.get(currentSectionId) ?? null) : null;

  const byTeam = new Map<
    string,
    {
      wagersRemaining: number;
      bonusStatus: BonusStatus;
      teamName: string;
      avatarId: string;
    }
  >();

  for (const t of teams) {
    let bonusStatus: BonusStatus = 'none';
    if (t.bonus_section_id) {
      if (currentSectionId && t.bonus_section_id === currentSectionId) {
        bonusStatus = 'this_section';
      } else if (currentOrder != null) {
        const nominatedOrder = orderById.get(t.bonus_section_id);
        if (nominatedOrder != null && nominatedOrder < currentOrder) {
          bonusStatus = 'used';
        } else {
          bonusStatus = 'remaining';
        }
      } else {
        // Finished / no current section — any nomination counts as used
        bonusStatus = 'used';
      }
    }
    byTeam.set(t.id, {
      wagersRemaining: t.wagers_remaining,
      bonusStatus,
      teamName: t.name,
      avatarId: parseAvatarId(t.avatar_id),
    });
  }

  const bonusTeamsThisSection = teams
    .filter(
      (t) =>
        currentSectionId &&
        t.bonus_section_id &&
        t.bonus_section_id === currentSectionId,
    )
    .map((t) => ({
      teamName: t.name,
      avatarId: parseAvatarId(t.avatar_id),
    }));

  return { byTeam, bonusTeamsThisSection };
}

/** Teams that wagered on a question, with won/lost from marks (correct → won). */
async function wagerOutcomesForQuestion(
  eventId: string,
  questionId: string,
): Promise<
  { teamName: string; avatarId: string; outcome: 'won' | 'lost' }[]
> {
  const { rows } = await query<{
    name: string;
    avatar_id: string;
    correctness: string | null;
  }>(
    `SELECT t.name, t.avatar_id, m.correctness
     FROM wagers w
     JOIN teams t ON t.id = w.team_id
     LEFT JOIN marks m
       ON m.event_id = w.event_id
      AND m.team_id = w.team_id
      AND m.question_id = w.question_id
     WHERE w.event_id = $1 AND w.question_id = $2
     ORDER BY t.name`,
    [eventId, questionId],
  );
  return rows.map((r) => ({
    teamName: r.name,
    avatarId: parseAvatarId(r.avatar_id),
    outcome: r.correctness === 'correct' ? ('won' as const) : ('lost' as const),
  }));
}

async function timerFromEvent(ev: {
  timer_deadline_at: Date | null;
  timer_remaining_ms: number | null;
  timer_paused: boolean;
  current_question_id?: string | null;
  id?: string;
}) {
  let remainingMs = ev.timer_remaining_ms ?? 0;
  if (ev.timer_deadline_at && !ev.timer_paused) {
    remainingMs = Math.max(0, ev.timer_deadline_at.getTime() - Date.now());
  }
  let durationMs: number | null = null;
  if (ev.current_question_id && ev.id) {
    const { rows } = await query<{ content: { timingSeconds?: number } }>(
      `SELECT content FROM event_snapshots
       WHERE event_id = $1 AND question_id = $2`,
      [ev.id, ev.current_question_id],
    );
    const sec = Number(rows[0]?.content?.timingSeconds);
    if (Number.isFinite(sec) && sec > 0) {
      durationMs = Math.round(sec * 1000);
    }
  }
  // Extensions (+15s) can push remaining above the original duration
  if (durationMs != null && remainingMs > durationMs) {
    durationMs = remainingMs;
  }
  return {
    remainingMs,
    deadlineAt: ev.timer_deadline_at
      ? ev.timer_deadline_at.getTime()
      : null,
    paused: ev.timer_paused,
    durationMs,
  };
}

function correctDisplay(spec: AnswerSpec): string {
  switch (spec.format) {
    case 'multiple_choice':
      return spec.data.options
        .filter((o) => spec.data.correctOptionIds.includes(o.id))
        .map((o) => o.label)
        .join(', ');
    case 'short_answer':
      return spec.data.acceptedAnswers.join(' / ');
    case 'ordered_list':
      return spec.data.correctOrder
        .map((id) => spec.data.items.find((i) => i.id === id)?.label ?? id)
        .join(' → ');
    case 'matching':
      return spec.data.pairs
        .map((p) => {
          const l = spec.data.left.find((x) => x.id === p.leftId)?.label;
          const r = spec.data.right.find((x) => x.id === p.rightId)?.label;
          return `${l} ↔ ${r}`;
        })
        .join('; ');
    default:
      return '';
  }
}

/** Echo the team's own answer as readable text (never includes keys). */
function teamSubmissionDisplay(
  format: string | undefined,
  payload: unknown,
  labels: {
    optionLabels?: { id: string; label: string }[] | null;
    matchLeft?: { id: string; label: string }[] | null;
    matchRight?: { id: string; label: string }[] | null;
    orderItems?: { id: string; label: string }[] | null;
  },
): string {
  if (payload == null) return 'Submitted';
  const body = payload as Record<string, unknown>;

  if (format === 'short_answer') {
    const text = String(body.text ?? payload ?? '').trim();
    return text || 'Submitted';
  }

  if (format === 'multiple_choice') {
    const ids = Array.isArray(body.selected)
      ? body.selected.map(String)
      : body.optionId
        ? [String(body.optionId)]
        : [];
    const labelsOut = ids.map(
      (id) => labels.optionLabels?.find((o) => o.id === id)?.label ?? id,
    );
    return labelsOut.filter(Boolean).join(', ') || 'Submitted';
  }

  if (format === 'ordered_list') {
    const order = Array.isArray(body.order) ? body.order.map(String) : [];
    return (
      order
        .map(
          (id, i) =>
            `${i + 1}. ${labels.orderItems?.find((x) => x.id === id)?.label ?? id}`,
        )
        .join(' · ') || 'Submitted'
    );
  }

  if (format === 'matching') {
    const pairs = Array.isArray(body.pairs) ? body.pairs : [];
    return (
      pairs
        .map((p) => {
          const row = p as { leftId?: string; rightId?: string };
          const left =
            labels.matchLeft?.find((l) => l.id === row.leftId)?.label ??
            row.leftId ??
            '?';
          const right =
            labels.matchRight?.find((r) => r.id === row.rightId)?.label ??
            row.rightId ??
            '?';
          return `${left} → ${right}`;
        })
        .join(' · ') || 'Submitted'
    );
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return 'Submitted';
  }
}

export async function buildWallboardSnapshot(
  eventId: string,
): Promise<WallboardSnapshot> {
  const ev = await getEvent(eventId);
  const { rows: series } = await query<{ name: string }>(
    `SELECT name FROM series WHERE id = $1`,
    [ev.series_id],
  );
  const { rows: sections } = await query<{
    id: string;
    title: string;
    theme: string | null;
    topic_images: StoredTopicImage[] | null;
  }>(
    `SELECT id, title, theme, topic_images FROM sections WHERE event_id = $1 ORDER BY sort_order`,
    [eventId],
  );
  const sectionIdx = sections.findIndex((s) => s.id === ev.current_section_id);
  const section = sections[sectionIdx];
  const demoSection = await isDemoSection(ev.current_section_id);

  const base: WallboardSnapshot = {
    role: 'wallboard',
    eventId: ev.id,
    eventCode: ev.code,
    eventName: ev.name,
    seriesName: series[0]?.name ?? '',
    state: ev.state,
    isDemoSection: demoSection,
    sectionTitle: section?.title ?? null,
    sectionTheme: section?.theme ?? section?.title ?? null,
    topicImageUrls: topicImageUrls(
      Array.isArray(section?.topic_images) ? section.topic_images : [],
    ),
    sectionIndex: sectionIdx >= 0 ? sectionIdx + 1 : null,
    sectionCount: sections.length,
    timer: await timerFromEvent(ev),
    joinUrl: `${config.webOrigin}/play/${ev.code}`,
    audioPlaying: ev.audio_playing,
  };

  if (
    ['question_revealed', 'answer_open'].includes(ev.state) &&
    ev.current_question_id
  ) {
    const { rows } = await query<{
      content: {
        wording: string;
        format: string;
        answerSpec: AnswerSpec;
        mediaImageId?: string;
        mediaAudioId?: string;
        mediaVideoId?: string;
      };
      sort_order: number;
    }>(
      `SELECT content, sort_order FROM event_snapshots
       WHERE event_id = $1 AND question_id = $2`,
      [eventId, ev.current_question_id],
    );
    const snap = rows[0];
    if (snap) {
      const { rows: countRows } = await query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM event_snapshots WHERE event_id = $1 AND section_id = $2`,
        [eventId, ev.current_section_id],
      );
      base.questionNumber = snap.sort_order + 1;
      base.questionWording = snap.content.wording;
      base.questionFormat = snap.content.format;
      const answerSpec = normalizeAnswerSpec(
        snap.content.format,
        snap.content.answerSpec,
      );
      if (answerSpec.format === 'multiple_choice') {
        base.choices = answerSpec.data.options.map((o) => ({
          id: o.id,
          label: o.label,
        }));
      } else if (answerSpec.format === 'ordered_list') {
        // Labels only — never correctOrder (answer key)
        base.choices = answerSpec.data.items.map((i) => ({
          id: i.id,
          label: i.label,
        }));
      }
      if (snap.content.mediaImageId) {
        base.mediaImageUrl = `/media/${snap.content.mediaImageId}`;
      }
      if (snap.content.mediaAudioId) {
        base.mediaAudioUrl = `/media/${snap.content.mediaAudioId}`;
      }
      if (snap.content.mediaVideoId) {
        base.mediaVideoUrl = `/media/${snap.content.mediaVideoId}`;
      }
      base.answerClosed = ev.state === 'answer_closed';
      void countRows;
    }
  }

  if (ev.state === 'answer_open' && ev.current_question_id) {
    const { rows: liveWagers } = await query<{
      name: string;
      avatar_id: string;
    }>(
      `SELECT t.name, t.avatar_id
       FROM wagers w
       JOIN teams t ON t.id = w.team_id
       WHERE w.event_id = $1 AND w.question_id = $2
       ORDER BY w.created_at ASC`,
      [eventId, ev.current_question_id],
    );
    base.activeWagers = liveWagers.map((w) => ({
      teamName: w.name,
      avatarId: parseAvatarId(w.avatar_id),
    }));
  }

  if (ev.state === 'section_reveal' || ev.state === 'finished') {
    if (
      ev.section_reveal_answers &&
      ev.current_section_id &&
      !ev.section_reveal_standings
    ) {
      const { rows } = await query<{
        question_id: string;
        content: {
          wording: string;
          answerSpec: AnswerSpec;
          revealFact?: string | null;
          revealImageId?: string | null;
        };
      }>(
        `SELECT question_id, content FROM event_snapshots
         WHERE event_id = $1 AND section_id = $2 ORDER BY sort_order`,
        [eventId, ev.current_section_id],
      );
      const idx = Math.min(
        Math.max(ev.section_reveal_answer_index ?? 0, 0),
        Math.max(rows.length - 1, 0),
      );
      const row = rows[idx];
      if (row) {
        const { rows: speedRows } = await query<{
          name: string;
          avatar_id: string;
          response_ms: number | null;
        }>(
          `SELECT t.name, t.avatar_id, s.response_ms
           FROM marks m
           JOIN teams t ON t.id = m.team_id
           LEFT JOIN LATERAL (
             SELECT response_ms FROM submissions
             WHERE event_id = m.event_id AND team_id = m.team_id AND question_id = m.question_id
             ORDER BY revision DESC
             LIMIT 1
           ) s ON true
           WHERE m.event_id = $1 AND m.question_id = $2
             AND m.is_first_fully_correct = true
           LIMIT 1`,
          [eventId, row.question_id],
        );
        const speed = speedRows[0];
        const wagers = await wagerOutcomesForQuestion(eventId, row.question_id);
        let fact = row.content.revealFact?.trim() || null;
        let revealImageId = row.content.revealImageId ?? null;
        if (!fact || !revealImageId) {
          const { rows: qRows } = await query<{
            reveal_fact: string | null;
            reveal_image_id: string | null;
          }>(
            `SELECT reveal_fact, reveal_image_id FROM questions WHERE id = $1`,
            [row.question_id],
          );
          if (!fact) fact = qRows[0]?.reveal_fact?.trim() || null;
          if (!revealImageId) revealImageId = qRows[0]?.reveal_image_id ?? null;
        }
        base.revealAnswer = {
          index: idx,
          total: rows.length,
          wording: row.content.wording,
          correctDisplay: correctDisplay(
            normalizeAnswerSpec(
              row.content.answerSpec?.format ?? 'short_answer',
              row.content.answerSpec,
            ),
          ),
          revealFact: fact,
          imageUrl: revealImageId ? `/media/${revealImageId}` : null,
          speedWinner: speed
            ? {
                teamName: speed.name,
                avatarId: parseAvatarId(speed.avatar_id),
                responseMs:
                  speed.response_ms == null ? null : Number(speed.response_ms),
              }
            : null,
          wagers,
        };
      }
    }
    if (ev.section_reveal_standings || ev.state === 'finished') {
      const demoStandings =
        demoSection && ev.state === 'section_reveal';
      const totals = await teamTotals(eventId, {
        mode: demoStandings ? 'demo' : 'official',
      });
      const sectionId = ev.current_section_id;
      const bonusMeta = await teamBonusMeta(eventId, sectionId);
      let sectionScores = new Map<string, number>();
      if (sectionId) {
        const { rows: sectionRows } = await query<{
          team_id: string;
          total: string;
        }>(
          `SELECT s.team_id,
             COALESCE(SUM(s.answer_points + s.speed_points + s.bonus_effect + s.wager_effect + s.host_adjustment),0) AS total
           FROM score_ledger s
           JOIN event_snapshots es
             ON es.event_id = s.event_id AND es.question_id = s.question_id
           WHERE s.event_id = $1 AND es.section_id = $2
             AND s.entry_type = ANY($3::text[])
           GROUP BY s.team_id`,
          [
            eventId,
            sectionId,
            demoStandings ? ['demo'] : ['answer', 'adjustment'],
          ],
        );
        sectionScores = new Map(
          sectionRows.map((r) => [r.team_id, Number(r.total)]),
        );
      }
      const finished = ev.state === 'finished';
      base.standings = totals.map((t) => {
        const meta = bonusMeta.byTeam.get(t.teamId);
        let bonusStatus = demoStandings
          ? ('none' as const)
          : (meta?.bonusStatus ?? 'none');
        // Final table: every consumed bonus is "used", not "this round"
        if (finished && bonusStatus === 'this_section') {
          bonusStatus = 'used';
        }
        return {
          rank: t.rank,
          teamName: t.teamName,
          avatarId: parseAvatarId(t.avatarId),
          members: t.members,
          sectionScore: sectionScores.get(t.teamId) ?? 0,
          score: t.score,
          wagersRemaining: meta?.wagersRemaining ?? 0,
          bonusStatus,
        };
      });
      if (
        !demoStandings &&
        !finished &&
        bonusMeta.bonusTeamsThisSection.length
      ) {
        base.bonusTeamsThisSection = bonusMeta.bonusTeamsThisSection;
      } else {
        base.bonusTeamsThisSection = [];
      }
    }
  }

  // Intentionally omit: PINs, host notes, answer keys during section, LLM, unpublished scores
  return base;
}

export async function buildTeamSnapshot(
  claims: TeamClaims,
): Promise<TeamPlaySnapshot> {
  const ev = await getEvent(claims.eventId);
  const { rows: teams } = await query<{
    id: string;
    name: string;
    avatar_id: string;
    buzzer_id: string;
    wagers_remaining: number;
    bonus_section_id: string | null;
    active_device_id: string | null;
  }>(`SELECT * FROM teams WHERE id = $1`, [claims.teamId]);
  const team = teams[0]!;

  const { rows: wager } = await query(
    `SELECT id FROM wagers WHERE team_id = $1 AND question_id = $2`,
    [claims.teamId, ev.current_question_id],
  );

  const { rows: sub } = await query<{
    received_at: Date;
    revision: number;
    payload: unknown;
  }>(
    `SELECT received_at, revision, payload FROM submissions
     WHERE team_id = $1 AND question_id = $2
     ORDER BY revision DESC LIMIT 1`,
    [claims.teamId, ev.current_question_id],
  );

  const inBonusSection = Boolean(
    team.bonus_section_id &&
      ev.current_section_id &&
      team.bonus_section_id === ev.current_section_id,
  );

  let sectionTitle: string | null = null;
  let sectionTheme: string | null = null;
  let sectionTopicUrls: string[] = [];
  const demoSection = await isDemoSection(ev.current_section_id);

  let revealPhase: TeamPlaySnapshot['revealPhase'] = null;
  let myScore: number | null = null;
  let myRank: number | null = null;
  let revealCard: TeamPlaySnapshot['revealCard'] = null;
  if (ev.state === 'section_reveal') {
    if (ev.section_reveal_standings) {
      revealPhase = 'standings';
      const totals = await teamTotals(claims.eventId, {
        mode: demoSection ? 'demo' : 'official',
      });
      const mine = totals.find((t) => t.teamId === claims.teamId);
      myScore = mine?.score ?? 0;
      myRank = mine?.rank ?? null;
    } else if (ev.section_reveal_answers && ev.current_section_id) {
      revealPhase = 'answers';
      const { rows: revealRows } = await query<{
        question_id: string;
        content: {
          format?: string;
          wording: string;
          answerSpec: AnswerSpec;
          revealFact?: string | null;
          revealImageId?: string | null;
        };
      }>(
        `SELECT question_id, content FROM event_snapshots
         WHERE event_id = $1 AND section_id = $2 ORDER BY sort_order`,
        [claims.eventId, ev.current_section_id],
      );
      const idx = Math.min(
        Math.max(ev.section_reveal_answer_index ?? 0, 0),
        Math.max(revealRows.length - 1, 0),
      );
      const row = revealRows[idx];
      if (row) {
        const spec = normalizeAnswerSpec(
          row.content.answerSpec?.format ?? row.content.format ?? 'short_answer',
          row.content.answerSpec,
        );
        const { rows: subRows } = await query<{ payload: unknown }>(
          `SELECT payload FROM submissions
           WHERE team_id = $1 AND question_id = $2
           ORDER BY revision DESC LIMIT 1`,
          [claims.teamId, row.question_id],
        );
        const labels = {
          optionLabels:
            spec.format === 'multiple_choice'
              ? spec.data.options.map((o) => ({ id: o.id, label: o.label }))
              : null,
          orderItems:
            spec.format === 'ordered_list'
              ? spec.data.items.map((i) => ({ id: i.id, label: i.label }))
              : null,
          matchLeft: spec.format === 'matching' ? spec.data.left : null,
          matchRight: spec.format === 'matching' ? spec.data.right : null,
        };
        const yourAnswerDisplay = subRows[0]
          ? teamSubmissionDisplay(spec.format, subRows[0].payload, labels)
          : null;
        const { rows: markRows } = await query<{ correctness: string }>(
          `SELECT correctness FROM marks
           WHERE event_id = $1 AND team_id = $2 AND question_id = $3`,
          [claims.eventId, claims.teamId, row.question_id],
        );
        const correctness = markRows[0]?.correctness;
        const markOutcome =
          !subRows[0] || correctness === 'unanswered'
            ? ('unanswered' as const)
            : correctness === 'correct' ||
                correctness === 'incorrect' ||
                correctness === 'partial'
              ? correctness
              : ('unanswered' as const);
        let revealFact = row.content.revealFact?.trim() || null;
        let revealImageId = row.content.revealImageId ?? null;
        if (!revealFact || !revealImageId) {
          const { rows: qRows } = await query<{
            reveal_fact: string | null;
            reveal_image_id: string | null;
          }>(
            `SELECT reveal_fact, reveal_image_id FROM questions WHERE id = $1`,
            [row.question_id],
          );
          if (!revealFact) revealFact = qRows[0]?.reveal_fact?.trim() || null;
          if (!revealImageId) revealImageId = qRows[0]?.reveal_image_id ?? null;
        }
        revealCard = {
          index: idx,
          total: revealRows.length,
          wording: row.content.wording,
          correctDisplay: correctDisplay(spec),
          yourAnswerDisplay,
          markOutcome,
          revealFact,
          imageUrl: revealImageId ? `/media/${revealImageId}` : null,
        };
      }
    }
  } else if (ev.state === 'finished') {
    revealPhase = 'standings';
    const totals = await teamTotals(claims.eventId, { mode: 'official' });
    const mine = totals.find((t) => t.teamId === claims.teamId);
    myScore = mine?.score ?? 0;
    myRank = mine?.rank ?? null;
  }
  if (ev.current_section_id) {
    const { rows: sec } = await query<{
      title: string;
      theme: string | null;
      topic_images: StoredTopicImage[] | null;
    }>(`SELECT title, theme, topic_images FROM sections WHERE id = $1`, [
      ev.current_section_id,
    ]);
    sectionTitle = sec[0]?.title ?? null;
    sectionTheme = sec[0]?.theme ?? sectionTitle;
    sectionTopicUrls = topicImageUrls(
      Array.isArray(sec[0]?.topic_images) ? sec[0]!.topic_images : [],
    );
  }

  const snap: TeamPlaySnapshot = {
    role: 'team',
    eventId: ev.id,
    teamId: team.id,
    teamName: team.name,
    avatarId: parseAvatarId(team.avatar_id),
    buzzerId: parseBuzzerId(team.buzzer_id),
    state: ev.state,
    sectionTitle,
    sectionTheme,
    topicImageUrls: sectionTopicUrls,
    isDemoSection: demoSection,
    currentQuestionId: ev.current_question_id,
    timer: await timerFromEvent(ev),
    answerWindowOpen: ev.state === 'answer_open' && !ev.timer_paused,
    paused: ev.timer_paused,
    wagersRemaining: team.wagers_remaining,
    wagerActive: wager.length > 0,
    bonusSectionId: team.bonus_section_id,
    inBonusSection,
    bonusLocked: ev.nominations_locked,
    connected: true,
    submissionAuthority: team.active_device_id === claims.deviceId,
    submissionAck: null,
    revealPhase,
    myScore,
    myRank,
    revealCard,
  };

  if (ev.current_question_id) {
    const { rows } = await query<{
      content: {
        format: string;
        wording: string;
        answerSpec: AnswerSpec;
        mediaImageId?: string | null;
        mediaAudioId?: string | null;
        mediaVideoId?: string | null;
      };
      sort_order: number;
    }>(
      `SELECT content, sort_order FROM event_snapshots
       WHERE event_id = $1 AND question_id = $2`,
      [claims.eventId, ev.current_question_id],
    );
    const q = rows[0];
    if (q) {
      snap.questionNumber = q.sort_order + 1;
      snap.questionFormat = q.content.format;
      // Wording + media are public on the wall once revealed
      if (
        ev.state === 'question_revealed' ||
        ev.state === 'answer_open'
      ) {
        snap.questionWording = q.content.wording;
        if (q.content.mediaImageId) {
          snap.mediaImageUrl = `/media/${q.content.mediaImageId}`;
        }
        if (q.content.mediaAudioId) {
          snap.mediaAudioUrl = `/media/${q.content.mediaAudioId}`;
        }
        if (q.content.mediaVideoId) {
          snap.mediaVideoUrl = `/media/${q.content.mediaVideoId}`;
        }
      }
      const spec = normalizeAnswerSpec(q.content.format, q.content.answerSpec);
      // Never send answer keys
      if (spec.format === 'multiple_choice') {
        snap.optionLabels = spec.data.options.map((o) => ({
          id: o.id,
          label: o.label,
        }));
      } else if (spec.format === 'ordered_list') {
        snap.orderItems = spec.data.items.map((i) => ({
          id: i.id,
          label: i.label,
        }));
      } else if (spec.format === 'matching') {
        snap.matchLeft = spec.data.left;
        snap.matchRight = spec.data.right;
      }
    }
  }

  if (sub[0]) {
    snap.submissionAck = {
      receivedAt: sub[0].received_at.toISOString(),
      revision: sub[0].revision,
      payload: sub[0].payload,
      display: teamSubmissionDisplay(snap.questionFormat ?? undefined, sub[0].payload, {
        optionLabels: snap.optionLabels,
        matchLeft: snap.matchLeft,
        matchRight: snap.matchRight,
        orderItems: snap.orderItems,
      }),
    };
  }

  return snap;
}

export async function buildHostSnapshot(eventId: string): Promise<HostSnapshot> {
  const ev = await getEvent(eventId);
  const demoSection = await isDemoSection(ev.current_section_id);
  const totals = await teamTotals(eventId, {
    mode: demoSection ? 'demo' : 'official',
  });
  const { rows: teams } = await query<{
    id: string;
    name: string;
    avatar_id: string;
    member_names: string[] | null;
    pin: string | null;
    active_device_id: string | null;
    wagers_remaining: number;
    bonus_section_id: string | null;
  }>(
    `SELECT id, name, avatar_id, member_names, pin, active_device_id,
            wagers_remaining, bonus_section_id
     FROM teams WHERE event_id = $1`,
    [eventId],
  );

  const connected = hubConnectedTeams(eventId);
  const bonusMeta = await teamBonusMeta(eventId, ev.current_section_id);

  const teamRows = await Promise.all(
    teams.map(async (t) => {
      const { rows: sub } = await query(
        `SELECT id FROM submissions WHERE team_id = $1 AND question_id = $2`,
        [t.id, ev.current_question_id],
      );
      const { rows: wager } = await query(
        `SELECT id FROM wagers WHERE team_id = $1 AND question_id = $2`,
        [t.id, ev.current_question_id],
      );
      const meta = bonusMeta.byTeam.get(t.id);
      return {
        id: t.id,
        name: t.name,
        avatarId: parseAvatarId(t.avatar_id),
        members: Array.isArray(t.member_names) ? t.member_names : [],
        pin: t.pin ?? null,
        connected: connected.has(t.id),
        hasAnswered: sub.length > 0,
        wagerActive: wager.length > 0,
        score: totals.find((x) => x.teamId === t.id)?.score ?? 0,
        wagersRemaining: meta?.wagersRemaining ?? t.wagers_remaining,
        inBonusSection: Boolean(
          t.bonus_section_id &&
            ev.current_section_id &&
            t.bonus_section_id === ev.current_section_id,
        ),
      };
    }),
  );

  let preview: HostSnapshot['preview'] = null;
  if (ev.current_question_id) {
    const { rows } = await query<{
      content: {
        wording: string;
        rubric: string;
        points: number;
        timingSeconds: number;
        answerSpec: AnswerSpec;
        hostNotes?: string;
      };
    }>(
      `SELECT content FROM event_snapshots WHERE event_id = $1 AND question_id = $2`,
      [eventId, ev.current_question_id],
    );
    if (rows[0]) {
      const answerSpec = normalizeAnswerSpec(
        rows[0].content.answerSpec?.format ?? 'short_answer',
        rows[0].content.answerSpec,
      );
      preview = {
        wording: rows[0].content.wording,
        answerSummary: JSON.stringify(answerSpec),
        rubric: rows[0].content.rubric,
        points: rows[0].content.points,
        timingSeconds: rows[0].content.timingSeconds,
      };
    }
  }

  let autoOpenAnswers = false;
  let reveal: HostSnapshot['reveal'] = null;
  if (ev.current_section_id) {
    const { rows: sec } = await query<{ auto_open_answers: boolean }>(
      `SELECT auto_open_answers FROM sections WHERE id = $1`,
      [ev.current_section_id],
    );
    autoOpenAnswers = Boolean(sec[0]?.auto_open_answers);

    if (ev.state === 'section_reveal' || ev.state === 'section_marking') {
      const { rows: countRows } = await query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM event_snapshots
         WHERE event_id = $1 AND section_id = $2`,
        [eventId, ev.current_section_id],
      );
      let revealWagers: NonNullable<HostSnapshot['reveal']>['wagers'] = [];
      if (
        ev.section_reveal_answers &&
        !ev.section_reveal_standings &&
        ev.section_reveal_answer_index != null
      ) {
        const { rows: qRows } = await query<{ question_id: string }>(
          `SELECT question_id FROM event_snapshots
           WHERE event_id = $1 AND section_id = $2
           ORDER BY sort_order`,
          [eventId, ev.current_section_id],
        );
        const idx = Math.min(
          Math.max(ev.section_reveal_answer_index, 0),
          Math.max(qRows.length - 1, 0),
        );
        const qid = qRows[idx]?.question_id;
        if (qid) {
          revealWagers = await wagerOutcomesForQuestion(eventId, qid);
        }
      }
      reveal = {
        showingAnswers: Boolean(ev.section_reveal_answers),
        showingStandings: Boolean(ev.section_reveal_standings),
        answerIndex: ev.section_reveal_answer_index,
        answerTotal: Number(countRows[0]?.c ?? 0),
        wagers: revealWagers,
      };
    }
  }

  return {
    role: 'host',
    eventId: ev.id,
    eventCode: ev.code,
    state: ev.state as EventState,
    sectionId: ev.current_section_id,
    questionId: ev.current_question_id,
    autoOpenAnswers,
    preview,
    timer: await timerFromEvent(ev),
    teams: teamRows,
    privateTotals: totals.map((t) => {
      const meta = bonusMeta.byTeam.get(t.teamId);
      return {
        teamId: t.teamId,
        teamName: t.teamName,
        avatarId: parseAvatarId(t.avatarId),
        members: t.members,
        score: t.score,
        wagersRemaining: meta?.wagersRemaining ?? 0,
        bonusStatus: demoSection
          ? ('none' as const)
          : (meta?.bonusStatus ?? 'none'),
      };
    }),
    bonusTeamsThisSection: demoSection
      ? []
      : bonusMeta.bonusTeamsThisSection,
    reveal,
    isDemoSection: demoSection,
    allowedTransitions: getAllowedTransitions(ev.state),
  };
}

// filled by hub
const connectedTeamDevices = new Map<string, Set<string>>();

export function hubConnectedTeams(eventId: string): Set<string> {
  return connectedTeamDevices.get(eventId) ?? new Set();
}

export function setTeamConnected(
  eventId: string,
  teamId: string,
  connected: boolean,
) {
  let set = connectedTeamDevices.get(eventId);
  if (!set) {
    set = new Set();
    connectedTeamDevices.set(eventId, set);
  }
  if (connected) set.add(teamId);
  else set.delete(teamId);
}
