import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { formatScore, type WallboardSnapshot } from '@quizzical/shared';
import { CountdownRing } from '../../components/CountdownRing';
import { GetReady } from '../../components/GetReady';
import { MarkingRobot } from '../../components/MarkingRobot';
import { FinalConfetti } from '../../components/FinalConfetti';
import { TeamAvatar } from '../../components/TeamAvatar';
import { api, clearToken, setToken, getToken, tokenEventId } from '../../lib/api';
import { playSystem } from '../../lib/sfx';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { useRoomSfx } from '../../hooks/useRoomSfx';
import { useSnapshot } from '../../hooks/useSnapshot';

export function WallPage() {
  const { eventCode } = useParams();
  const [params] = useSearchParams();
  const [eventId, setEventId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setReady(false);
      setEventId(null);
      if (!eventCode) return;

      const wallTokenParam = params.get('token');
      if (wallTokenParam) {
        const res = await api<{ token: string; eventId: string }>(
          '/api/auth/wallboard',
          {
            method: 'POST',
            body: JSON.stringify({
              eventCode,
              wallboardToken: wallTokenParam,
            }),
            auth: false,
          },
        );
        if (cancelled) return;
        setToken('wallboard', res.token);
        setEventId(res.eventId);
        setReady(true);
        return;
      }

      // Resume stored wall session only for this same event
      const existing = getToken('wallboard');
      const existingEventId = tokenEventId(existing);
      if (!existing || !existingEventId) {
        if (existing) clearToken('wallboard');
        return;
      }
      const meta = await api<{
        event?: { id: string };
        error?: string;
      }>(`/api/events/by-code/${eventCode}`, { auth: false });
      if (cancelled) return;
      if (meta.event?.id && meta.event.id === existingEventId) {
        setEventId(existingEventId);
        setReady(true);
      } else {
        clearToken('wallboard');
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [eventCode, params]);

  const { snapshot, connected } = useSnapshot(
    'wallboard',
    eventId ?? undefined,
  );
  const wall = snapshot?.role === 'wallboard' ? (snapshot as WallboardSnapshot) : null;

  // Autoplay question media as soon as it mounts on the wall (browsers may
  // still block until the wall tab has had a user gesture).
  useEffect(() => {
    if (
      wall?.state !== 'question_revealed' &&
      wall?.state !== 'answer_open'
    ) {
      return;
    }

    const audio = audioRef.current;
    if (wall?.mediaAudioUrl && audio) {
      audio.currentTime = 0;
      void audio.play().catch(() => undefined);
    }

    const video = videoRef.current;
    if (wall?.mediaVideoUrl && video) {
      video.currentTime = 0;
      void video.play().catch(() => undefined);
    }
  }, [
    wall?.state,
    wall?.questionNumber,
    wall?.mediaAudioUrl,
    wall?.mediaVideoUrl,
  ]);

  const {
    seconds,
    remainingMs,
    durationMs,
    urgent,
    critical,
    paused: timerPaused,
  } = useLiveTimer(wall?.timer);

  useRoomSfx({
    state: wall?.state,
    critical,
    timerPaused,
  });

  const wagerQuestion = useRef<number | null>(null);
  const wagerCount = useRef(0);
  const lastRevealKey = useRef<string | null>(null);
  const standingsPlayed = useRef(false);

  useEffect(() => {
    if (wall?.state !== 'answer_open') {
      wagerQuestion.current = null;
      wagerCount.current = 0;
      return;
    }
    const q = wall.questionNumber ?? 0;
    const list = wall.activeWagers ?? [];
    if (wagerQuestion.current !== q) {
      // New question (or first snapshot): seed without replaying existing wagers
      wagerQuestion.current = q;
      wagerCount.current = list.length;
      return;
    }
    if (list.length > wagerCount.current) {
      const added = list.length - wagerCount.current;
      for (let i = 0; i < added; i++) {
        playSystem('wager', { volume: 0.85 });
      }
      wagerCount.current = list.length;
    }
  }, [wall?.state, wall?.questionNumber, wall?.activeWagers]);

  useEffect(() => {
    const reveal = wall?.revealAnswer;
    if (!reveal || wall?.state !== 'section_reveal') {
      lastRevealKey.current = null;
      return;
    }
    const key = `${reveal.index}:${reveal.wording}`;
    if (lastRevealKey.current === key) return;
    lastRevealKey.current = key;
    playSystem('reveal_answer');
    if (reveal.speedWinner) {
      window.setTimeout(() => playSystem('speed_winner'), 450);
    }
  }, [
    wall?.state,
    wall?.revealAnswer?.index,
    wall?.revealAnswer?.wording,
    wall?.revealAnswer?.speedWinner,
  ]);

  useEffect(() => {
    const showingStandings =
      (wall?.state === 'section_reveal' || wall?.state === 'finished') &&
      Array.isArray(wall?.standings) &&
      wall.standings.length > 0;
    if (!showingStandings) {
      standingsPlayed.current = false;
      return;
    }
    if (standingsPlayed.current) return;
    standingsPlayed.current = true;
    playSystem('standings');
  }, [wall?.state, wall?.standings]);

  if (!ready) {
    return (
      <main className="wall-shell">
        <p style={{ color: 'var(--ink-muted)' }}>
          Provide wallboard token: /wall/{eventCode}?token=…
        </p>
      </main>
    );
  }

  const teamCount = wall?.standings?.length ?? 0;
  const compactStandings = teamCount > 8;
  const hasVisualMedia = Boolean(wall?.mediaVideoUrl || wall?.mediaImageUrl);
  const hasAnyMedia = Boolean(
    wall?.mediaVideoUrl || wall?.mediaImageUrl || wall?.mediaAudioUrl,
  );
  const questionLive =
    wall?.state === 'question_revealed' || wall?.state === 'answer_open';
  const choicesExpanded =
    Boolean(wall?.choices) && !hasVisualMedia && questionLive;
  /** Centre prompt (+ choices/media) like short-answer; used for all formats. */
  const centeredQuestion = Boolean(questionLive);

  return (
    <main className="wall-shell">
      <div
        style={{
          position: 'absolute',
          top: 'clamp(12px, 2vh, 24px)',
          right: 'clamp(16px, 2vw, 28px)',
          fontSize: 13,
          color: connected ? 'var(--teal)' : 'var(--coral)',
          zIndex: 5,
        }}
      >
        {connected ? 'Live' : 'Reconnecting…'}
      </div>

      {!wall || wall.state === 'lobby' || wall.state === 'ready' || wall.state === 'draft' ? (
        <section
          className="stage-enter wall-panel"
          style={{ textAlign: 'center', justifyContent: 'center' }}
        >
          <p
            style={{
              fontSize: 12,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: 'var(--ink-muted)',
              marginBottom: 'clamp(8px, 1.5vh, 12px)',
            }}
          >
            {wall?.seriesName ?? 'Trivia'}
          </p>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--type-wall-hero)',
              margin: 0,
              lineHeight: 0.95,
            }}
          >
            Quizzical
          </h1>
          <p
            style={{
              fontSize: 'var(--type-wall-body)',
              margin: 'clamp(0.75rem, 2vh, 1.25rem) 0 clamp(1rem, 3vh, 2rem)',
            }}
          >
            {wall?.eventName ?? 'Join the game'}
          </p>
          <div
            style={{
              display: 'inline-flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'clamp(10px, 1.8vh, 16px)',
            }}
          >
            {wall?.joinUrl ? (
              <div
                className="wall-lobby-qr"
                style={{
                  padding: 'clamp(10px, 1.5vh, 16px)',
                  background: '#fff',
                  borderRadius: 20,
                  boxShadow: 'var(--shadow-ambient)',
                }}
              >
                <QRCodeSVG value={wall.joinUrl} size={200} />
              </div>
            ) : null}
            <p
              style={{
                fontSize: 'clamp(1.5rem, 4vmin, 2rem)',
                fontWeight: 700,
                letterSpacing: '0.12em',
                margin: 0,
              }}
            >
              {wall?.eventCode ?? eventCode}
            </p>
            <p
              style={{
                color: 'var(--ink-muted)',
                fontSize: 'clamp(1rem, 2.4vmin, 1.25rem)',
                margin: 0,
              }}
            >
              Scan or open join link · enter team PIN
            </p>
          </div>
        </section>
      ) : null}

      {wall && wall.state === 'rules' ? (
        <section className="stage-enter wall-panel" style={{ padding: '2vh 0' }}>
          <p
            style={{
              fontSize: 13,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--ink-muted)',
              margin: '0 0 8px',
              textAlign: 'center',
              flexShrink: 0,
            }}
          >
            How tonight works
          </p>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(2rem, 5.5vmin, 3.25rem)',
              margin: '0 0 clamp(14px, 2.5vh, 22px)',
              textAlign: 'center',
              flexShrink: 0,
            }}
          >
            Rules & scoring
          </h1>
          <div className="wall-rules-grid">
            <RuleRow
              title="Teams"
              body="One phone per team. Discuss, then submit before the timer ends. You can revise until answers close."
            />
            <RuleRow
              title="Scoring"
              body="Most questions are worth 1 point — multiple choice, short answer, ordered list, and matching alike. Correct earns that point. First fully correct team also gets +1 speed. Wrong or blank = 0. Partial credit may apply on short answers."
            />
            <RuleRow
              title="Bonus section"
              body="Your nominated bonus doubles correct points. Incorrect answers cost −1. No wagers in bonus."
            />
            <RuleRow
              title="Wagers"
              body="Up to two per night. Correct doubles what you earn (including speed). Wrong or blank costs −2× the question points."
            />
            <RuleRow
              title="Host call"
              body="The host has final authority on marks. They can also add or deduct points outside the questions — bonuses, penalties, or corrections — at their discretion."
            />
            <RuleRow
              title="Practice first"
              body="Next up: a short practice round covering every answer type. It scores for fun — it does not count toward tonight’s total."
            />
          </div>
        </section>
      ) : null}

      {wall &&
      (wall.state === 'section_active' || wall.state === 'answer_closed') ? (
        <GetReady
          sectionTitle={wall.sectionTitle}
          topicImageUrls={wall.topicImageUrls}
          hint={
            wall.state === 'answer_closed'
              ? 'Answers locked — next question soon'
              : wall.isDemoSection
                ? 'Practice only — scores do not count'
                : null
          }
        />
      ) : null}

      {wall &&
      (wall.state === 'question_revealed' || wall.state === 'answer_open') ? (
        <section
          key={`${wall.state}-${wall.questionNumber}`}
          className={
            centeredQuestion
              ? 'stage-enter wall-question-stage wall-question-stage--centered'
              : 'stage-enter wall-question-stage'
          }
        >
          <p
            style={{
              fontSize: 14,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--ink-muted)',
              margin: 0,
            }}
          >
            {wall.sectionTitle}
            {wall.sectionIndex
              ? ` · ${wall.sectionIndex}/${wall.sectionCount}`
              : ''}
            {wall.questionNumber ? ` · Q${wall.questionNumber}` : ''}
          </p>

          <div
            className={
              choicesExpanded
                ? 'wall-question-center wall-question-center--choices'
                : 'wall-question-center'
            }
          >
            {wall.questionWording ? (
              <h1
                className="wall-question-prompt"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: choicesExpanded
                    ? 'clamp(2.1rem, 5.2vmin, 3.6rem)'
                    : !hasAnyMedia
                      ? 'clamp(2.25rem, 6vmin, 4.5rem)'
                      : 'clamp(2rem, 5.5vmin, 4rem)',
                  lineHeight: 1.1,
                  margin: 0,
                  maxWidth: choicesExpanded
                    ? 'min(32ch, 96%)'
                    : !hasAnyMedia
                      ? 'min(24ch, 92%)'
                      : 'min(28ch, 90%)',
                }}
              >
                {wall.questionWording}
              </h1>
            ) : (
              <h1
                className="wall-question-prompt"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'clamp(2rem, 5vmin, 3rem)',
                  margin: 0,
                }}
              >
                Get Ready
              </h1>
            )}

            {hasAnyMedia || wall.choices ? (
              <div
                className={
                  choicesExpanded
                    ? 'wall-question-media wall-question-media--choices'
                    : 'wall-question-media'
                }
              >
                {wall.mediaVideoUrl ? (
                  <video
                    key={wall.mediaVideoUrl}
                    ref={videoRef}
                    src={wall.mediaVideoUrl}
                    controls
                    playsInline
                    autoPlay
                    loop
                    preload="auto"
                    onCanPlay={(e) => {
                      void e.currentTarget.play().catch(() => undefined);
                    }}
                    style={{ background: '#0b0d10' }}
                  />
                ) : null}

                {wall.mediaImageUrl && !wall.mediaVideoUrl ? (
                  <img src={wall.mediaImageUrl} alt="" />
                ) : null}

                {wall.mediaAudioUrl ? (
                  <audio
                    key={wall.mediaAudioUrl}
                    ref={audioRef}
                    src={wall.mediaAudioUrl}
                    preload="auto"
                    autoPlay
                    loop
                    controls
                    onCanPlay={(e) => {
                      void e.currentTarget.play().catch(() => undefined);
                    }}
                    style={{ width: 'min(480px, 100%)' }}
                  />
                ) : null}

                {wall.choices ? (
                  <div
                    className={
                      choicesExpanded
                        ? 'wall-choice-grid wall-choice-grid--expanded'
                        : 'wall-choice-grid'
                    }
                  >
                    {wall.choices.map((c) => (
                      <div key={c.id} className="wall-choice">
                        <span className="wall-choice-letter">
                          {c.id.toUpperCase()}
                        </span>
                        <span className="wall-choice-label">{c.label}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 24,
              paddingTop: 'clamp(8px, 1.5vh, 20px)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              {wall.state === 'answer_open' && remainingMs != null ? (
                <CountdownRing
                  remainingMs={remainingMs}
                  durationMs={durationMs}
                  size={72}
                  urgent={urgent}
                  paused={timerPaused}
                />
              ) : null}
              <p
                className={urgent ? 'timer-urgent' : undefined}
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'clamp(2.5rem, 9vmin, 5.5rem)',
                  margin: 0,
                  lineHeight: 1,
                }}
              >
                {timerPaused
                  ? 'Paused'
                  : seconds !== null && wall.state === 'answer_open'
                    ? `${seconds}`
                    : ''}
              </p>
            </div>
            <p style={{ color: 'var(--ink-muted)', fontSize: 'clamp(1rem, 2.4vmin, 1.25rem)' }}>
              {wall.state === 'question_revealed'
                ? 'On screen'
                : wall.state === 'answer_open'
                  ? 'Answer now'
                  : ''}
            </p>
          </div>
        </section>
      ) : null}

      {wall && wall.state === 'section_marking' ? (
        <MarkingRobot sectionTitle={wall.sectionTitle} />
      ) : null}

      {wall && wall.state === 'section_reveal' && wall.revealAnswer ? (
        <section
          key={`answer-${wall.revealAnswer.index}`}
          className="stage-enter wall-panel"
          style={{
            padding: 'clamp(2vh, 4vh, 6vh) 0',
            textAlign: 'center',
            justifyContent: 'center',
          }}
        >
          <p
            style={{
              color: 'var(--ink-muted)',
              fontSize: 'clamp(1rem, 2.4vmin, 1.25rem)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              margin: '0 0 clamp(8px, 1.5vh, 12px)',
            }}
          >
            Answer {wall.revealAnswer.index + 1} of {wall.revealAnswer.total}
          </p>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(1.75rem, 4.8vmin, 3rem)',
              lineHeight: 1.2,
              margin: '0 0 clamp(16px, 3vh, 28px)',
            }}
          >
            {wall.revealAnswer.wording}
          </h1>
          <p
            style={{
              color: 'var(--teal)',
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(2rem, 6.5vmin, 3.75rem)',
              fontWeight: 700,
              margin: 0,
              lineHeight: 1.15,
            }}
          >
            {wall.revealAnswer.correctDisplay}
          </p>
          {wall.revealAnswer.imageUrl ? (
            <img
              src={wall.revealAnswer.imageUrl}
              alt=""
              className="stage-enter"
              style={{
                marginTop: 'clamp(16px, 3.5vh, 28px)',
                width: 'min(68vw, 720px)',
                height: 'min(32dvh, 380px)',
                objectFit: 'contain',
                objectPosition: 'center',
                borderRadius: 16,
                background: 'var(--bg-elevated)',
                boxShadow:
                  'inset 0 0 0 1px var(--hairline), var(--shadow-ambient)',
              }}
            />
          ) : null}
          {wall.revealAnswer.revealFact ? (
            <div
              className="stage-enter"
              style={{
                marginTop: 'clamp(16px, 3.5vh, 28px)',
                maxWidth: '42rem',
                marginLeft: 'auto',
                marginRight: 'auto',
                padding: 'clamp(12px, 2vh, 18px) clamp(16px, 3vw, 24px)',
                borderRadius: 20,
                background: 'var(--bg-elevated)',
                boxShadow:
                  'inset 0 0 0 1px var(--hairline), var(--shadow-ambient)',
                textAlign: 'left',
              }}
            >
              <div
                style={{
                  fontSize: 'clamp(0.75rem, 1.8vmin, 0.9rem)',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--teal)',
                  fontWeight: 700,
                  marginBottom: 6,
                }}
              >
                Did you know
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 'clamp(1.05rem, 2.6vmin, 1.45rem)',
                  lineHeight: 1.35,
                  color: 'var(--ink)',
                }}
              >
                {wall.revealAnswer.revealFact}
              </p>
            </div>
          ) : null}
          {wall.revealAnswer.speedWinner ? (
            <div
              style={{
                marginTop: 'clamp(18px, 4vh, 36px)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 16,
                padding: '12px 20px',
                borderRadius: 999,
                background: 'var(--teal-soft)',
                maxWidth: '100%',
              }}
            >
              <TeamAvatar
                avatarId={wall.revealAnswer.speedWinner.avatarId}
                size={48}
                label={wall.revealAnswer.speedWinner.teamName}
              />
              <div style={{ textAlign: 'left' }}>
                <div
                  style={{
                    fontSize: '0.85rem',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-muted)',
                    fontWeight: 600,
                  }}
                >
                  Quickest
                  {wall.revealAnswer.speedWinner.responseMs != null
                    ? ` · ${formatResponseTime(wall.revealAnswer.speedWinner.responseMs)}`
                    : ''}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'clamp(1.35rem, 3.2vmin, 2rem)',
                    fontWeight: 700,
                    lineHeight: 1.15,
                  }}
                >
                  {wall.revealAnswer.speedWinner.teamName}
                </div>
              </div>
            </div>
          ) : null}
          {wall.revealAnswer.wagers && wall.revealAnswer.wagers.length > 0 ? (
            <div
              style={{
                marginTop: 'clamp(14px, 3vh, 28px)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                width: '100%',
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: '0.8rem',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-muted)',
                  fontWeight: 600,
                }}
              >
                Wagers
              </p>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  gap: 8,
                  maxWidth: 'min(92%, 1100px)',
                }}
              >
                {wall.revealAnswer.wagers.map((w) => {
                  const won = w.outcome === 'won';
                  return (
                    <div
                      key={`${w.teamName}-${w.outcome}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 12px 6px 6px',
                        borderRadius: 999,
                        background: won
                          ? 'var(--teal-soft)'
                          : 'var(--coral-soft)',
                        border: `1px solid ${won ? 'rgba(13,148,136,0.25)' : 'rgba(225,29,72,0.22)'}`,
                        maxWidth: '100%',
                      }}
                    >
                      <TeamAvatar
                        avatarId={w.avatarId}
                        size={28}
                        label={w.teamName}
                      />
                      <span
                        style={{
                          fontFamily: 'var(--font-display)',
                          fontWeight: 700,
                          fontSize: 'clamp(0.95rem, 2vmin, 1.15rem)',
                          lineHeight: 1.1,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '28ch',
                        }}
                      >
                        {w.teamName}
                      </span>
                      <span
                        style={{
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          color: won ? 'var(--teal)' : 'var(--coral)',
                          flexShrink: 0,
                        }}
                      >
                        {won ? 'Won' : 'Lost'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {wall &&
      ((wall.state === 'section_reveal' && wall.standings) ||
        wall.state === 'finished') ? (
        <section
          className="stage-enter wall-panel"
          style={{
            padding: 'clamp(1.5vh, 3vh, 4vh) 0',
            position: 'relative',
          }}
        >
          {wall.state === 'finished' ? <FinalConfetti /> : null}
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(2rem, 5vmin, 3.25rem)',
              marginTop: 0,
              marginBottom: compactStandings ? 12 : 20,
              textAlign: 'center',
              flexShrink: 0,
              position: 'relative',
            }}
          >
            {wall.state === 'finished'
              ? 'Final standings'
              : wall.isDemoSection
                ? 'Practice scores'
                : 'Running scores'}
          </h1>
          {wall.isDemoSection && wall.state !== 'finished' ? (
            <p
              style={{
                textAlign: 'center',
                color: 'var(--ink-muted)',
                margin: '0 0 12px',
                fontSize: 'clamp(0.95rem, 2.2vmin, 1.1rem)',
                flexShrink: 0,
              }}
            >
              Does not count toward tonight’s total
            </p>
          ) : null}
          {!wall.isDemoSection &&
          wall.state !== 'finished' &&
          (wall.bonusTeamsThisSection?.length ?? 0) > 0 ? (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                alignItems: 'center',
                gap: compactStandings ? 8 : 12,
                marginBottom: compactStandings ? 12 : 18,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontSize: 'clamp(0.85rem, 2vmin, 1rem)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-muted)',
                  fontWeight: 600,
                }}
              >
                Bonus this round
              </span>
              {wall.bonusTeamsThisSection!.map((t) => (
                <span
                  key={t.teamName}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 12px 6px 6px',
                    borderRadius: 999,
                    background: 'var(--teal-soft)',
                    border: '1px solid rgba(13,148,136,0.25)',
                    fontWeight: 600,
                    fontSize: 'clamp(0.95rem, 2.2vmin, 1.15rem)',
                  }}
                >
                  <TeamAvatar
                    avatarId={t.avatarId}
                    size={compactStandings ? 28 : 34}
                    label={t.teamName}
                  />
                  {t.teamName}
                </span>
              ))}
            </div>
          ) : null}
          {wall.standings?.[0] ? (
            <div
              style={{
                display: 'grid',
                justifyItems: 'center',
                gap: compactStandings ? 6 : 10,
                marginBottom: compactStandings ? 14 : 24,
                flexShrink: 0,
              }}
            >
              <TeamAvatar
                avatarId={wall.standings[0].avatarId}
                size={
                  compactStandings
                    ? 64
                    : wall.state === 'finished'
                      ? 100
                      : 80
                }
                label={wall.standings[0].teamName}
              />
              <p
                style={{
                  margin: 0,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-muted)',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                }}
              >
                {wall.state === 'finished'
                  ? 'Winner'
                  : wall.isDemoSection
                    ? 'Practice leader'
                    : 'In the lead'}
              </p>
              <h2
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-display)',
                  fontSize: 'clamp(1.75rem, 4vmin, 2.75rem)',
                  fontWeight: 700,
                }}
              >
                {wall.standings[0].teamName}
              </h2>
              {wall.state === 'finished' &&
              wall.standings[0].members?.length ? (
                <p
                  style={{
                    margin: 0,
                    maxWidth: '36rem',
                    textAlign: 'center',
                    color: 'var(--ink-muted)',
                    fontSize: 'clamp(0.95rem, 2.2vmin, 1.25rem)',
                    lineHeight: 1.35,
                    fontWeight: 500,
                  }}
                >
                  {wall.standings[0].members.join(' · ')}
                </p>
              ) : null}
              <p
                style={{
                  margin: 0,
                  color: 'var(--teal)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 'clamp(1.35rem, 3vmin, 1.85rem)',
                  fontWeight: 700,
                }}
              >
                {wall.state === 'finished'
                  ? `${formatScore(wall.standings[0].score)} pts`
                  : `${formatScore(wall.standings[0].sectionScore)} this section · ${formatScore(wall.standings[0].score)} total`}
              </p>
            </div>
          ) : null}
          {wall.standings?.length ? (
            <div className="wall-standings-table-wrap">
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: compactStandings
                    ? 'clamp(1rem, 2.2vmin, 1.35rem)'
                    : 'clamp(1.1rem, 2.5vmin, 1.65rem)',
                }}
              >
                <thead>
                  <tr style={{ color: 'var(--ink-muted)', textAlign: 'left' }}>
                    <th style={{ padding: rowPad(compactStandings), fontWeight: 600 }}>
                      #
                    </th>
                    <th style={{ padding: rowPad(compactStandings), fontWeight: 600 }}>
                      Team
                    </th>
                    {wall.state !== 'finished' ? (
                      <th
                        style={{
                          padding: rowPad(compactStandings),
                          fontWeight: 600,
                          textAlign: 'right',
                        }}
                      >
                        Section
                      </th>
                    ) : null}
                    <th
                      style={{
                        padding: rowPad(compactStandings),
                        fontWeight: 600,
                        textAlign: 'center',
                      }}
                    >
                      Bonus
                    </th>
                    <th
                      style={{
                        padding: rowPad(compactStandings),
                        fontWeight: 600,
                        textAlign: 'center',
                      }}
                    >
                      Wagers
                    </th>
                    <th
                      style={{
                        padding: rowPad(compactStandings),
                        fontWeight: 600,
                        textAlign: 'right',
                      }}
                    >
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {wall.standings.map((s) => (
                    <tr
                      key={s.rank}
                      style={{
                        borderTop: '1px solid var(--hairline)',
                        fontFamily: 'var(--font-display)',
                      }}
                    >
                      <td
                        style={{
                          padding: rowPad(compactStandings),
                          color: 'var(--ink-muted)',
                        }}
                      >
                        {s.rank}
                      </td>
                      <td style={{ padding: rowPad(compactStandings) }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: compactStandings ? 10 : 14,
                          }}
                        >
                          <TeamAvatar
                            avatarId={s.avatarId}
                            size={compactStandings ? 32 : 40}
                            label={s.teamName}
                          />
                          {s.teamName}
                        </span>
                      </td>
                      {wall.state !== 'finished' ? (
                        <td
                          style={{
                            padding: rowPad(compactStandings),
                            textAlign: 'right',
                            color: 'var(--ink-muted)',
                          }}
                        >
                          {formatScore(s.sectionScore)}
                        </td>
                      ) : null}
                      <td
                        style={{
                          padding: rowPad(compactStandings),
                          textAlign: 'center',
                          fontSize: compactStandings
                            ? 'clamp(0.85rem, 1.8vmin, 1.05rem)'
                            : 'clamp(0.95rem, 2vmin, 1.2rem)',
                          fontWeight: 600,
                          color:
                            s.bonusStatus === 'this_section'
                              ? 'var(--teal)'
                              : 'var(--ink-muted)',
                        }}
                      >
                        {bonusLabel(s.bonusStatus)}
                      </td>
                      <td
                        style={{
                          padding: rowPad(compactStandings),
                          textAlign: 'center',
                          fontWeight: 600,
                          color: 'var(--ink-muted)',
                        }}
                      >
                        {s.wagersRemaining}
                      </td>
                      <td
                        style={{
                          padding: rowPad(compactStandings),
                          textAlign: 'right',
                          fontWeight: 700,
                          color: 'var(--teal)',
                        }}
                      >
                        {formatScore(s.score)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ textAlign: 'center', color: 'var(--ink-muted)' }}>
              Waiting for scores…
            </p>
          )}
        </section>
      ) : null}
    </main>
  );
}

function rowPad(compact: boolean): string {
  return compact ? '8px 12px' : '12px 16px';
}

function bonusLabel(
  status: 'this_section' | 'used' | 'remaining' | 'none' | undefined,
): string {
  switch (status) {
    case 'this_section':
      return 'This round';
    case 'used':
      return 'Used';
    case 'remaining':
      return 'Left';
    default:
      return '—';
  }
}

/** Format submission latency for the Quickest badge (e.g. 4.2s, 1:05). */
function formatResponseTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const totalSec = ms / 1000;
  if (totalSec < 60) {
    const rounded = Math.round(totalSec * 10) / 10;
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}s`;
  }
  const mins = Math.floor(totalSec / 60);
  const secs = Math.round(totalSec % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function RuleRow({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        padding: 'clamp(8px, 1.4vh, 14px) 0',
        borderTop: '1px solid var(--hairline)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          marginBottom: 4,
          color: 'var(--teal)',
        }}
      >
        {title}
      </div>
      <div>{body}</div>
    </div>
  );
}
