import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  formatScore,
  type EventState,
  type HostSnapshot,
} from '@quizzical/shared';
import { Bezel } from '../../components/Bezel';
import { Button } from '../../components/Button';
import { CountdownRing } from '../../components/CountdownRing';
import { TeamAvatar } from '../../components/TeamAvatar';
import { api } from '../../lib/api';
import { randomUUID } from '../../lib/uuid';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { useSnapshot } from '../../hooks/useSnapshot';

const STATE_LABELS: Record<EventState, string> = {
  draft: 'Prep — open the lobby when you are ready',
  ready: 'Prep — open the lobby when you are ready',
  lobby: 'Lobby — teams joining (optional for a test)',
  rules: 'Rules on the wall — then practice or begin the night',
  section_active: 'Section active — reveal the next question',
  question_revealed: 'Question on wall — open answers when ready',
  answer_open: 'Answers open',
  answer_closed: 'Answers closed',
  section_marking: 'Review marks — then approve & reveal',
  section_reveal: 'Revealing answers / scores',
  finished: 'Finished',
  abandoned: 'Abandoned',
};

type MarkRow = {
  id: string;
  team_name: string;
  correctness: 'correct' | 'incorrect' | 'partial' | 'unanswered';
  partial_fraction: number | null;
  needs_discretion: boolean;
  host_approved: boolean;
  wagered?: boolean;
  submitted: unknown;
  llm_suggestion: {
    correctness?: string;
    partialFraction?: number;
    justification?: string;
    uncertainty?: string;
    unavailable?: boolean;
    message?: string;
  } | null;
  question_content: {
    wording?: string;
    format?: string;
    answerSpec?: {
      format?: string;
      data?: { acceptedAnswers?: string[] };
    };
  };
};

export function HostLive() {
  const { eventId } = useParams();
  const nav = useNavigate();
  const { snapshot, connected } = useSnapshot('host', eventId);
  const host = snapshot?.role === 'host' ? (snapshot as HostSnapshot) : null;
  const [marks, setMarks] = useState<MarkRow[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [restartArmed, setRestartArmed] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const [abandonArmed, setAbandonArmed] = useState(false);
  const [wallMeta, setWallMeta] = useState<{
    code: string;
    wallboardToken: string;
  } | null>(null);
  const [nextQ, setNextQ] = useState<{
    next?: { question_id: string; content: { wording: string } };
    questions: { question_id: string }[];
  } | null>(null);

  async function refreshMarks() {
    if (!eventId) return;
    const m = await api<{ marks: MarkRow[] }>(
      `/api/host/events/${eventId}/marking`,
      { auth: 'host' },
    );
    setMarks(m.marks);
  }

  useEffect(() => {
    if (!eventId) return;
    void api(`/api/host/events/${eventId}/next-question`, { auth: 'host' })
      .then((r) => setNextQ(r as typeof nextQ))
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load questions'),
      );
  }, [eventId, host?.state, host?.questionId, host?.sectionId]);

  useEffect(() => {
    if (!eventId) return;
    void api<{
      event: { code: string; wallboard_token: string };
    }>(`/api/host/events/${eventId}`, { auth: 'host' })
      .then((r) =>
        setWallMeta({
          code: r.event.code,
          wallboardToken: r.event.wallboard_token,
        }),
      )
      .catch(() => undefined);
  }, [eventId]);

  useEffect(() => {
    if (
      host?.state === 'section_marking' ||
      host?.state === 'section_reveal'
    ) {
      void refreshMarks().catch(() => undefined);
    }
  }, [eventId, host?.state]);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/host/events/${eventId}${path}`, {
        method: 'POST',
        auth: 'host',
        body: JSON.stringify(body ?? {}),
      });
      if (path.includes('marking') || path.includes('reveal')) {
        await refreshMarks().catch(() => undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function resetForLive() {
    if (!eventId) return;
    setBusy(true);
    setError('');
    setResetArmed(false);
    try {
      await api(`/api/host/events/${eventId}/reset`, {
        method: 'POST',
        auth: 'host',
        body: '{}',
      });
      nav(`/host/events/${eventId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  async function abandonNight() {
    if (!eventId) return;
    setBusy(true);
    setError('');
    setAbandonArmed(false);
    try {
      await api(`/api/host/events/${eventId}/abandon`, {
        method: 'POST',
        auth: 'host',
        body: '{}',
      });
      nav(`/host/events/${eventId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Abandon failed');
    } finally {
      setBusy(false);
    }
  }

  async function patchMark(
    markId: string,
    correctness: MarkRow['correctness'],
    partialFraction?: number,
  ) {
    const previous = marks.find((m) => m.id === markId);
    setError('');
    // Optimistic: selected pill updates immediately
    setMarks((prev) =>
      prev.map((m) =>
        m.id === markId
          ? {
              ...m,
              correctness,
              partial_fraction:
                correctness === 'partial' ? (partialFraction ?? 0.5) : null,
              needs_discretion: false,
            }
          : m,
      ),
    );
    setBusy(true);
    try {
      const body: { correctness: string; partialFraction?: number } = {
        correctness,
      };
      if (correctness === 'partial') {
        body.partialFraction = partialFraction ?? 0.5;
      }
      const res = await api<{
        ok: boolean;
        mark?: {
          id: string;
          correctness: MarkRow['correctness'];
          partial_fraction: number | null;
          needs_discretion: boolean;
        };
      }>(`/api/host/events/${eventId}/marking/${markId}`, {
        method: 'PATCH',
        auth: 'host',
        body: JSON.stringify(body),
      });
      if (res.mark) {
        setMarks((prev) =>
          prev.map((m) =>
            m.id === markId
              ? {
                  ...m,
                  correctness: res.mark!.correctness,
                  partial_fraction: res.mark!.partial_fraction,
                  needs_discretion: res.mark!.needs_discretion,
                }
              : m,
          ),
        );
      } else {
        await refreshMarks();
      }
    } catch (err) {
      if (previous) {
        setMarks((prev) =>
          prev.map((m) => (m.id === markId ? previous : m)),
        );
      } else {
        await refreshMarks().catch(() => undefined);
      }
      setError(err instanceof Error ? err.message : 'Mark update failed');
    } finally {
      setBusy(false);
    }
  }

  async function applySuggestion(m: MarkRow) {
    const s = m.llm_suggestion;
    if (!s?.correctness || s.unavailable) return;
    const c = s.correctness as MarkRow['correctness'];
    if (!['correct', 'incorrect', 'partial', 'unanswered'].includes(c)) return;
    await patchMark(
      m.id,
      c,
      c === 'partial' ? (s.partialFraction ?? 0.5) : undefined,
    );
  }

  async function adjustScore(teamId: string, delta: number) {
    const reason = window.prompt(
      `Reason for ${delta > 0 ? '+' : ''}${delta} points?`,
      delta > 0 ? 'Host bonus' : 'Host adjustment',
    );
    if (!reason?.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/host/events/${eventId}/adjust-score`, {
        method: 'POST',
        auth: 'host',
        body: JSON.stringify({ teamId, delta, reason: reason.trim() }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adjust failed');
    } finally {
      setBusy(false);
    }
  }

  async function replaceDevice(teamId: string, teamName: string) {
    if (
      !confirm(
        `Replace device for ${teamName}? Their current phone loses authority — they rejoin with the team PIN.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(
        `/api/host/events/${eventId}/teams/${teamId}/replace-device`,
        {
          method: 'POST',
          auth: 'host',
          body: JSON.stringify({ newDeviceId: randomUUID() }),
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Replace device failed');
    } finally {
      setBusy(false);
    }
  }

  async function approveAndReveal() {
    setBusy(true);
    setError('');
    try {
      await api(`/api/host/events/${eventId}/marking/approve`, {
        method: 'POST',
        auth: 'host',
        body: '{}',
      });
      await api(`/api/host/events/${eventId}/reveal-answers`, {
        method: 'POST',
        auth: 'host',
        body: '{}',
      });
      await refreshMarks().catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusy(false);
    }
  }

  async function revealNext() {
    const questions = nextQ?.questions ?? [];
    if (!questions.length) {
      setError('No snapshotted questions in this section');
      return;
    }
    let target = questions[0]!.question_id;
    if (host?.questionId) {
      const idx = questions.findIndex((q) => q.question_id === host.questionId);
      const following = questions[idx + 1];
      if (!following) {
        setError('No further questions in this section — mark or close the section');
        return;
      }
      target = following.question_id;
    }
    await act('/reveal-question', { questionId: target });
  }

  const state = host?.state;
  const timer = host?.timer;
  const {
    seconds: timerSeconds,
    remainingMs,
    durationMs,
    urgent: timerUrgent,
    paused,
  } = useLiveTimer(timer);
  const questions = nextQ?.questions ?? [];
  const hasNextQuestion = (() => {
    if (!questions.length) return false;
    if (!host?.questionId) return true;
    const idx = questions.findIndex((q) => q.question_id === host.questionId);
    return Boolean(questions[idx + 1]);
  })();

  let primaryLabel: string | null = null;
  let primaryRun: (() => void | Promise<void>) | null = null;
  if (state === 'ready' || state === 'draft') {
    primaryLabel = 'Open lobby';
    primaryRun = () => act('/lobby');
  } else if (state === 'lobby') {
    primaryLabel = 'Start game';
    primaryRun = () => act('/start');
  } else if (state === 'rules') {
    primaryLabel = 'Start practice';
    primaryRun = () => act('/begin-practice');
  } else if (state === 'section_active') {
    primaryLabel = host?.isDemoSection
      ? 'Reveal practice question'
      : 'Reveal question';
    primaryRun = () => revealNext();
  } else if (state === 'question_revealed') {
    primaryLabel = host?.autoOpenAnswers
      ? 'Open answers now'
      : 'Open answers';
    primaryRun = () => act('/open-answers');
  } else if (state === 'answer_open') {
    primaryLabel = paused ? 'Resume timer' : 'Close answers';
    primaryRun = () => act(paused ? '/resume' : '/close-answers');
  } else if (state === 'answer_closed') {
    if (hasNextQuestion) {
      primaryLabel = 'Reveal next question';
      primaryRun = () => revealNext();
    } else {
      primaryLabel = 'Mark section';
      primaryRun = () => act('/marking/start');
    }
  } else if (state === 'section_marking') {
    primaryLabel = 'Approve & reveal answers';
    primaryRun = () => approveAndReveal();
  } else if (state === 'section_reveal') {
    const rev = host?.reveal;
    if (rev?.showingStandings) {
      primaryLabel = host?.isDemoSection
        ? 'Begin the night'
        : 'Next section';
      primaryRun = () => act('/next-section');
    } else if (rev?.showingAnswers) {
      const idx = rev.answerIndex ?? 0;
      const last = idx >= Math.max(rev.answerTotal - 1, 0);
      if (last) {
        primaryLabel = 'Show scores';
        primaryRun = () => act('/reveal-standings');
      } else {
        primaryLabel = 'Next answer';
        primaryRun = () => act('/reveal-next-answer');
      }
    } else {
      primaryLabel = 'Reveal answers';
      primaryRun = () => act('/reveal-answers');
    }
  }

  const showTimerBar = state === 'answer_open';
  const answeredCount = (host?.teams ?? []).filter((t) => t.hasAnswered).length;
  const teamCount = host?.teams?.length ?? 0;
  const pendingDiscretion = marks.filter((m) => m.needs_discretion).length

  return (
    <main
      style={{
        padding: '1.5rem clamp(1rem,3vw,2rem)',
        maxWidth: 1400,
        margin: '0 auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 16,
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        <div>
          <Link
            to={`/host/events/${eventId}`}
            style={{ color: 'var(--ink-muted)', fontSize: 13 }}
          >
            ← Prep
          </Link>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              margin: '0.2rem 0',
              fontSize: '2.25rem',
            }}
          >
            Live · {host?.eventCode ?? '…'}
          </h1>
          <p style={{ margin: 0, fontSize: 15 }}>
            <span style={{ color: connected ? 'var(--teal)' : 'var(--coral)' }}>
              {connected ? 'Connected' : 'Reconnecting…'}
            </span>
            <span style={{ color: 'var(--ink-muted)' }}>
              {' '}
              · {state ? STATE_LABELS[state] : 'Loading…'}
              {host?.autoOpenAnswers ? ' · auto-open answers' : ''}
            </span>
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {primaryLabel && primaryRun && state !== 'finished' && state !== 'abandoned' ? (
            <Button
              withArrow
              type="button"
              disabled={busy}
              onClick={() => void primaryRun()}
            >
              {primaryLabel}
            </Button>
          ) : null}
          {state === 'question_revealed' && host?.autoOpenAnswers ? (
            <span style={{ fontSize: 13, color: 'var(--ink-muted)', maxWidth: 220 }}>
              Answers open automatically a few seconds after reveal.
            </span>
          ) : null}
          {state === 'rules' ? (
            <Button
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => void act('/skip-practice')}
            >
              Skip practice
            </Button>
          ) : null}
          {wallMeta ? (
            <Button
              variant="ghost"
              type="button"
              onClick={() =>
                window.open(
                  `/wall/${wallMeta.code}?token=${wallMeta.wallboardToken}`,
                  '_blank',
                  'noopener,noreferrer',
                )
              }
            >
              Open wall
            </Button>
          ) : null}
          {state ? (
            restartArmed ? (
              <>
                <Button
                  variant="danger"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setRestartArmed(false);
                    void act('/restart');
                  }}
                >
                  Confirm restart
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => setRestartArmed(false)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                type="button"
                disabled={busy || resetArmed || abandonArmed}
                onClick={() => {
                  setResetArmed(false);
                  setAbandonArmed(false);
                  setRestartArmed(true);
                }}
                title="Clear scores; keep teams → lobby"
              >
                Restart
              </Button>
            )
          ) : null}
          {state ? (
            resetArmed ? (
              <>
                <Button
                  variant="danger"
                  type="button"
                  disabled={busy}
                  onClick={() => void resetForLive()}
                >
                  Confirm reset
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => setResetArmed(false)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                type="button"
                disabled={busy || restartArmed || abandonArmed}
                onClick={() => {
                  setRestartArmed(false);
                  setAbandonArmed(false);
                  setResetArmed(true);
                }}
                title="Clear teams and scores; keep questions — back to Prep"
              >
                Reset
              </Button>
            )
          ) : null}
          {state && state !== 'abandoned' && state !== 'finished' ? (
            abandonArmed ? (
              <>
                <Button
                  variant="danger"
                  type="button"
                  disabled={busy}
                  onClick={() => void abandonNight()}
                >
                  Confirm abandon
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => setAbandonArmed(false)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                type="button"
                disabled={busy || restartArmed || resetArmed}
                onClick={() => {
                  setRestartArmed(false);
                  setResetArmed(false);
                  setAbandonArmed(true);
                }}
                title="End the night without finishing scores"
              >
                Abandon
              </Button>
            )
          ) : null}
        </div>
      </div>

      {error ? (
        <p style={{ color: 'var(--coral)', marginTop: 0 }} role="alert">
          {error}
        </p>
      ) : null}

      {showTimerBar ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'center',
            marginBottom: 20,
            padding: '12px 16px',
            borderRadius: 16,
            border: '1px solid var(--hairline)',
            background: 'var(--bg-elevated)',
          }}
        >
          {remainingMs != null ? (
            <CountdownRing
              remainingMs={remainingMs}
              durationMs={durationMs}
              size={40}
              urgent={timerUrgent}
              paused={paused}
            />
          ) : null}
          <span
            className={timerUrgent ? 'timer-urgent' : undefined}
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.75rem',
              minWidth: '4ch',
            }}
          >
            {timerSeconds ?? '—'}s
            {paused ? ' · paused' : ''}
          </span>
          <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
            {answeredCount}/{teamCount} answered
          </span>
          <span style={{ flex: 1 }} />
          {!paused ? (
            <Button
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => void act('/pause')}
            >
              Pause
            </Button>
          ) : (
            <Button
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => void act('/resume')}
            >
              Resume
            </Button>
          )}
          <Button
            variant="ghost"
            type="button"
            disabled={busy}
            onClick={() => void act('/extend', { extraMs: 15000 })}
          >
            +15s
          </Button>
        </div>
      ) : null}

      {(state === 'finished' || state === 'abandoned') && (
        <Bezel style={{ marginBottom: 20 }}>
          <p style={{ margin: '0 0 12px', fontSize: '1.1rem' }}>
            {state === 'finished'
              ? 'Event finished. Final standings are on the wall.'
              : 'Event abandoned. Return to prep to rebuild or reset for another night.'}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {wallMeta ? (
              <Button
                variant="ghost"
                type="button"
                onClick={() =>
                  window.open(
                    `/wall/${wallMeta.code}?token=${wallMeta.wallboardToken}`,
                    '_blank',
                    'noopener,noreferrer',
                  )
                }
              >
                Open wall
              </Button>
            ) : null}
            <Button
              type="button"
              withArrow
              onClick={() => eventId && nav(`/host/events/${eventId}`)}
            >
              Back to prep
            </Button>
            {state === 'finished' ? (
              <Button
                variant="ghost"
                type="button"
                disabled={busy}
                onClick={() => {
                  setRestartArmed(false);
                  setAbandonArmed(false);
                  setResetArmed(true);
                }}
              >
                Reset for next run
              </Button>
            ) : null}
          </div>
        </Bezel>
      )}

      {state === 'section_reveal' &&
      host?.reveal?.showingAnswers &&
      (host.reveal.wagers?.length ?? 0) > 0 ? (
        <Bezel style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: '1rem' }}>
            Wagers on this answer
          </h2>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            {host.reveal.wagers!.map((w) => {
              const won = w.outcome === 'won';
              return (
                <div
                  key={`${w.teamName}-${w.outcome}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px 6px 6px',
                    borderRadius: 999,
                    background: won ? 'var(--teal-soft)' : 'var(--coral-soft)',
                    border: `1px solid ${won ? 'rgba(13,148,136,0.25)' : 'rgba(225,29,72,0.22)'}`,
                  }}
                >
                  <TeamAvatar
                    avatarId={w.avatarId}
                    size={28}
                    label={w.teamName}
                  />
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {w.teamName}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: won ? 'var(--teal)' : 'var(--coral)',
                    }}
                  >
                    {won ? 'Won' : 'Lost'}
                  </span>
                </div>
              );
            })}
          </div>
        </Bezel>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            state === 'section_marking'
              ? 'minmax(0,1.55fr) minmax(0,1fr)'
              : 'minmax(0,1.1fr) minmax(0,1fr) minmax(0,0.9fr)',
          gap: 16,
        }}
        className="live-grid"
      >
        {state !== 'section_marking' ? (
          <Bezel>
            <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Preview</h2>
            {host?.preview ? (
              <>
                <p
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '1.35rem',
                  }}
                >
                  {host.preview.wording}
                </p>
                <p style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
                  {host.preview.points} pts · {host.preview.timingSeconds}s
                </p>
                <pre
                  style={{
                    fontSize: 11,
                    whiteSpace: 'pre-wrap',
                    background: 'var(--bg-0)',
                    padding: 12,
                    borderRadius: 12,
                    overflow: 'auto',
                  }}
                >
                  {host.preview.answerSummary}
                </pre>
                <p style={{ fontSize: 13 }}>{host.preview.rubric}</p>
              </>
            ) : (
              <p style={{ color: 'var(--ink-muted)' }}>No current question</p>
            )}
          </Bezel>
        ) : null}

        {state === 'section_marking' ? (
          <Bezel style={{ gridColumn: '1 / 2', gridRow: '1' }}>
            <h2 style={{ marginTop: 0, fontSize: '1rem' }}>
              Marking queue
              {pendingDiscretion ? (
                <span style={{ color: 'var(--coral)', fontWeight: 600 }}>
                  {' '}
                  · {pendingDiscretion} need discretion
                </span>
              ) : null}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 0 }}>
              Review short answers, then Approve & reveal.
            </p>
            <div style={{ maxHeight: 'min(70dvh, 720px)', overflow: 'auto', fontSize: 13 }}>
              {marks.map((m) => {
                const accepted =
                  m.question_content?.answerSpec?.data?.acceptedAnswers ?? [];
                const submittedText = formatSubmitted(m.submitted);
                const sug = m.llm_suggestion;
                return (
                  <div
                    key={m.id}
                    style={{
                      padding: '10px 0',
                      borderBottom: '1px solid var(--hairline)',
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      {m.team_name}
                      {m.wagered ? (
                        <span style={{ color: 'var(--coral)' }}>
                          {' '}
                          · wager
                          {m.correctness === 'correct'
                            ? ' won'
                            : m.correctness === 'incorrect' ||
                                m.correctness === 'unanswered'
                              ? ' lost'
                              : ''}
                        </span>
                      ) : null}
                      {m.needs_discretion ? (
                        <span style={{ color: 'var(--coral)' }}>
                          {' '}
                          · needs discretion
                        </span>
                      ) : null}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--ink-muted)',
                        marginBottom: 4,
                      }}
                    >
                      {(m.question_content?.wording ?? '').slice(0, 120)}
                      {(m.question_content?.wording?.length ?? 0) > 120
                        ? '…'
                        : ''}
                    </div>
                    {accepted.length ? (
                      <div style={{ fontSize: 12, marginBottom: 4 }}>
                        Accepted: {accepted.join(' / ')}
                      </div>
                    ) : null}
                    <div style={{ marginBottom: 6 }}>
                      Submitted: <strong>{submittedText || '—'}</strong>
                    </div>
                    {sug ? (
                      <div
                        style={{
                          fontSize: 12,
                          background: 'var(--bg-0)',
                          padding: '6px 8px',
                          borderRadius: 8,
                          marginBottom: 6,
                        }}
                      >
                        {sug.unavailable ? (
                          <span>{sug.message ?? 'LLM unavailable'}</span>
                        ) : (
                          <>
                            Suggestion: <strong>{sug.correctness}</strong>
                            {sug.correctness === 'partial' &&
                            sug.partialFraction != null
                              ? ` (${Math.round(sug.partialFraction * 100)}%)`
                              : ''}
                            {sug.justification
                              ? ` — ${sug.justification}`
                              : ''}
                            {sug.correctness ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void applySuggestion(m)}
                                style={{
                                  ...adjustBtn,
                                  marginLeft: 8,
                                  color: 'var(--teal)',
                                }}
                              >
                                Apply
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : null}
                    <div
                      role="group"
                      aria-label={`Mark for ${m.team_name}`}
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 6,
                        alignItems: 'center',
                      }}
                    >
                      {(
                        [
                          ['correct', 'Correct'],
                          ['incorrect', 'Incorrect'],
                          ['partial', 'Partial ½'],
                        ] as const
                      ).map(([value, label]) => {
                        const selected =
                          value === 'partial'
                            ? m.correctness === 'partial'
                            : m.correctness === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            disabled={busy}
                            aria-pressed={selected}
                            onClick={() =>
                              void patchMark(
                                m.id,
                                value,
                                value === 'partial' ? 0.5 : undefined,
                              )
                            }
                            style={{
                              ...markToggleBtn,
                              background: selected
                                ? value === 'correct'
                                  ? 'var(--teal-soft)'
                                  : value === 'incorrect'
                                    ? 'var(--coral-soft)'
                                    : 'var(--bg-0)'
                                : 'var(--bg-elevated)',
                              color: selected
                                ? value === 'correct'
                                  ? 'var(--teal)'
                                  : value === 'incorrect'
                                    ? 'var(--coral)'
                                    : 'var(--ink)'
                                : 'var(--ink)',
                              borderColor: selected
                                ? 'transparent'
                                : 'var(--hairline)',
                              opacity: busy ? 0.45 : 1,
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                      {m.correctness === 'unanswered' ? (
                        <span
                          style={{
                            fontSize: 11,
                            color: 'var(--ink-muted)',
                            fontWeight: 600,
                          }}
                        >
                          Unanswered
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Bezel>
        ) : null}

        {state !== 'section_marking' ? (
        <Bezel>
          <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Teams</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {(host?.teams ?? []).map((t) => (
              <div
                key={t.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  gap: 8,
                  alignItems: 'center',
                  padding: '0.75rem 0.9rem',
                  borderRadius: 12,
                  border: '1px solid var(--hairline)',
                  background: t.hasAnswered ? 'var(--teal-soft)' : 'transparent',
                }}
              >
                <TeamAvatar avatarId={t.avatarId} size={36} label={t.name} />
                <div>
                  <strong>{t.name}</strong>
                  <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                    PIN{' '}
                    <span
                      style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontWeight: 700,
                        color: 'var(--ink)',
                        letterSpacing: '0.06em',
                      }}
                    >
                      {t.pin ?? '—'}
                    </span>
                  </div>
                  {t.members?.length ? (
                    <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                      {t.members.join(' · ')}
                    </div>
                  ) : null}
                  <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                    {t.connected ? 'connected' : 'disconnected'}
                    {t.wagerActive ? (
                      <span style={{ color: 'var(--coral)', fontWeight: 600 }}>
                        {' '}
                        · wager on
                      </span>
                    ) : null}
                    {t.hasAnswered ? ' · answered' : ''}
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void replaceDevice(t.id, t.name)}
                    style={{
                      marginTop: 4,
                      appearance: 'none',
                      border: 'none',
                      background: 'none',
                      padding: 0,
                      fontSize: 12,
                      color: 'var(--teal)',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    Replace device
                  </button>
                </div>
                <div style={{ fontWeight: 700 }}>{formatScore(t.score)}</div>
              </div>
            ))}
          </div>
        </Bezel>
        ) : null}

        <Bezel>
          <h2 style={{ marginTop: 0, fontSize: '1rem' }}>
            {host?.isDemoSection ? 'Practice totals' : 'Private totals'}
          </h2>
          {host?.isDemoSection ? (
            <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--ink-muted)' }}>
              Practice scores — not counted in the night total
            </p>
          ) : null}
          {!host?.isDemoSection &&
          (host?.bonusTeamsThisSection?.length ?? 0) > 0 &&
          (state === 'section_marking' ||
            state === 'section_reveal' ||
            host?.reveal?.showingStandings) ? (
            <p style={{ margin: '0 0 10px', fontSize: 13 }}>
              <span style={{ color: 'var(--ink-muted)' }}>Bonus this round · </span>
              {host!.bonusTeamsThisSection!.map((t) => t.teamName).join(' · ')}
            </p>
          ) : null}
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {(host?.privateTotals ?? []).map((t) => (
              <li
                key={t.teamId}
                style={{
                  marginBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <TeamAvatar avatarId={t.avatarId} size={28} label={t.teamName} />
                <span>
                  {t.teamName} — {formatScore(t.score)}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color:
                      t.bonusStatus === 'this_section'
                        ? 'var(--teal)'
                        : 'var(--ink-muted)',
                    fontWeight: t.bonusStatus === 'this_section' ? 600 : 400,
                  }}
                >
                  {t.bonusStatus === 'this_section'
                    ? '· bonus'
                    : t.bonusStatus === 'used'
                      ? '· bonus used'
                      : t.bonusStatus === 'remaining'
                        ? '· bonus left'
                        : ''}
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                  · {t.wagersRemaining} wager
                  {t.wagersRemaining === 1 ? '' : 's'}
                </span>
                <span style={{ display: 'inline-flex', gap: 4 }}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void adjustScore(t.teamId, 1)}
                    title="Add 1 point"
                    style={adjustBtn}
                  >
                    +1
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void adjustScore(t.teamId, -1)}
                    title="Remove 1 point"
                    style={adjustBtn}
                  >
                    −1
                  </button>
                </span>
              </li>
            ))}
          </ol>

          {state !== 'section_marking' && marks.length ? (
            <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 16 }}>
              {marks.length} mark{marks.length === 1 ? '' : 's'} in queue — open
              Mark section to review.
            </p>
          ) : null}
        </Bezel>
      </div>
      <style>{`
        @media (max-width: 900px) {
          .live-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </main>
  );
}

function formatSubmitted(payload: unknown): string {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'object') {
    const body = payload as Record<string, unknown>;
    if (typeof body.text === 'string') return body.text;
    try {
      return JSON.stringify(payload);
    } catch {
      return 'Submitted';
    }
  }
  return String(payload);
}

const adjustBtn: CSSProperties = {
  appearance: 'none',
  border: '1px solid var(--hairline)',
  background: 'var(--bg-elevated)',
  borderRadius: 6,
  padding: '2px 8px',
  fontSize: 12,
  cursor: 'pointer',
  fontWeight: 600,
};

const markToggleBtn: CSSProperties = {
  appearance: 'none',
  border: '1px solid var(--hairline)',
  borderRadius: 999,
  padding: '6px 14px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background 160ms ease, color 160ms ease, opacity 160ms ease',
};
