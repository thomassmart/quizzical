import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Coins } from '@phosphor-icons/react';
import {
  AVATAR_IDS,
  DEFAULT_AVATAR_ID,
  parseAvatarId,
  type AvatarId,
  type TeamPlaySnapshot,
} from '@quizzical/shared';
import { Bezel } from '../../components/Bezel';
import { Button } from '../../components/Button';
import { GetReady } from '../../components/GetReady';
import { MarkingRobot } from '../../components/MarkingRobot';
import { ScoresWait } from '../../components/ScoresWait';
import { RevealCard } from '../../components/RevealCard';
import { FinalConfetti } from '../../components/FinalConfetti';
import { CountdownRing } from '../../components/CountdownRing';
import { AvatarPicker, TeamAvatar } from '../../components/TeamAvatar';
import {
  api,
  clearToken,
  getDeviceId,
  getToken,
  setToken,
  tokenEventId,
} from '../../lib/api';
import { randomUUID } from '../../lib/uuid';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { useSnapshot } from '../../hooks/useSnapshot';

function resetJoinFields() {
  return {
    teamName: '',
    pin: '',
    create: false,
    avatarId: DEFAULT_AVATAR_ID as AvatarId,
    bonusSectionId: '',
    membersText: '',
  };
}

function parseMembersText(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, 12);
}

export function PlayPage() {
  const { eventCode } = useParams();
  const [phase, setPhase] = useState<'join' | 'play'>('join');
  const [info, setInfo] = useState<{
    event: { id: string; name: string; nominations_locked: boolean };
    teams: { id: string; name: string; avatarId: string }[];
    sections: { id: string; title: string }[];
  } | null>(null);
  const [teamName, setTeamName] = useState('');
  const [pin, setPin] = useState('');
  const [create, setCreate] = useState(false);
  const [avatarId, setAvatarId] = useState<AvatarId>(DEFAULT_AVATAR_ID);
  const [bonusSectionId, setBonusSectionId] = useState<string>('');
  const [membersText, setMembersText] = useState('');
  const [error, setError] = useState('');
  const [eventId, setEventId] = useState<string | undefined>();
  const [ackFlash, setAckFlash] = useState(false);
  const [revising, setRevising] = useState(false);
  const [localDraft, setLocalDraft] = useState('');
  const [order, setOrder] = useState<string[]>([]);
  const [pairs, setPairs] = useState<Record<string, string>>({});
  const [questionId, setQuestionId] = useState<string | null>(null);

  useEffect(() => {
    // New event code → blank join form; never carry a prior night's session.
    const blank = resetJoinFields();
    setPhase('join');
    setInfo(null);
    setEventId(undefined);
    setTeamName(blank.teamName);
    setPin(blank.pin);
    setCreate(blank.create);
    setAvatarId(blank.avatarId);
    setBonusSectionId(blank.bonusSectionId);
    setMembersText(blank.membersText);
    setError('');
    setQuestionId(null);
    setLocalDraft('');
    setRevising(false);

    if (!eventCode) return;

    void api<{
      event: { id: string; name: string; nominations_locked: boolean };
      teams: { id: string; name: string; avatarId: string }[];
      sections: { id: string; title: string }[];
      error?: string;
    }>(`/api/events/by-code/${eventCode}`, { auth: false }).then((r) => {
      if (r.error) {
        setError('Event not found');
        return;
      }
      setInfo(r as typeof info);
      setEventId(r.event.id);

      const existing = getToken('team');
      const tokenEvent = tokenEventId(existing);
      if (existing && tokenEvent === r.event.id) {
        // Same night — resume play
        setPhase('play');
      } else if (existing) {
        // Token belongs to a different event
        clearToken('team');
      }
    });
  }, [eventCode]);

  const { snapshot, connected } = useSnapshot(
    'team',
    phase === 'play' ? eventId : undefined,
  );
  const play = snapshot?.role === 'team' ? (snapshot as TeamPlaySnapshot) : null;

  /** Avatars claimed by other teams; own avatar stays free on rejoin. */
  const takenAvatarIds =
    info?.teams
      .filter((t) => {
        if (create) return true;
        const nameKey = teamName.trim().toLowerCase();
        return !nameKey || t.name.toLowerCase() !== nameKey;
      })
      .map((t) => t.avatarId) ?? [];
  const takenAvatarKey = takenAvatarIds.join('\0');

  useEffect(() => {
    if (!takenAvatarKey) return;
    const taken = new Set(takenAvatarKey.split('\0'));
    if (!taken.has(avatarId)) return;
    const next = AVATAR_IDS.find((id) => !taken.has(id));
    if (next) setAvatarId(next);
  }, [takenAvatarKey, avatarId]);

  useEffect(() => {
    setRevising(false);
    setLocalDraft('');
    setPairs({});
    if (play?.orderItems) {
      setOrder(play.orderItems.map((i) => i.id));
    } else {
      setOrder([]);
    }
  }, [play?.currentQuestionId, play?.questionNumber, play?.questionFormat]);

  useEffect(() => {
    if (play?.submissionAck) {
      setAckFlash(true);
      setRevising(false);
      const t = setTimeout(() => setAckFlash(false), 700);
      return () => clearTimeout(t);
    }
  }, [play?.submissionAck?.revision, play?.submissionAck?.receivedAt]);

  function hydrateFromPayload(payload: unknown) {
    if (!payload || typeof payload !== 'object') return;
    const body = payload as Record<string, unknown>;
    if (typeof body.text === 'string') setLocalDraft(body.text);
    if (Array.isArray(body.order)) setOrder(body.order.map(String));
    if (Array.isArray(body.pairs)) {
      const next: Record<string, string> = {};
      for (const p of body.pairs) {
        if (!p || typeof p !== 'object') continue;
        const row = p as { leftId?: string; rightId?: string };
        if (row.leftId && row.rightId) next[row.leftId] = row.rightId;
      }
      setPairs(next);
    }
  }

  function startRevise() {
    if (play?.submissionAck?.payload != null) {
      hydrateFromPayload(play.submissionAck.payload);
    }
    setRevising(true);
    setError('');
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    setError('');
    const members = parseMembersText(membersText);
    if (create && members.length < 1) {
      setError('Add at least one team member (one name per line)');
      return;
    }
    try {
      const res = await api<{
        token: string;
        eventId: string;
        pin?: string;
      }>('/api/auth/team/join', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({
          eventCode,
          teamName,
          pin: pin || undefined,
          create,
          deviceId: getDeviceId(),
          bonusSectionId: bonusSectionId || null,
          avatarId,
          members: members.length ? members : undefined,
        }),
      });
      setToken('team', res.token);
      setEventId(res.eventId);
      if (res.pin) alert(`Your team PIN is ${res.pin} — keep it private.`);
      setPhase('play');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Join failed');
    }
  }

  async function resolveQuestionId(): Promise<string | null> {
    if (play?.currentQuestionId) return play.currentQuestionId;
    const st = await api<TeamPlaySnapshot>('/api/play/state');
    return st.currentQuestionId ?? questionId;
  }

  async function submit(payload: unknown) {
    const qid = await resolveQuestionId();
    if (!qid) {
      setError('No active question');
      return;
    }
    setQuestionId(qid);
    try {
      await api('/api/play/submit', {
        method: 'POST',
        body: JSON.stringify({
          questionId: qid,
          payload,
          idempotencyKey: randomUUID(),
        }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    }
  }

  async function wager() {
    const qid = await resolveQuestionId();
    if (!qid) return;
    try {
      await api('/api/play/wager', {
        method: 'POST',
        body: JSON.stringify({ questionId: qid }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wager failed');
    }
  }

  const {
    seconds,
    remainingMs,
    durationMs,
    urgent,
    paused: timerPaused,
  } = useLiveTimer(play?.timer);

  const showGetReady =
    play?.state === 'section_active' || play?.state === 'answer_closed';

  if (
    phase === 'play' &&
    (play?.state === 'section_marking' ||
      play?.state === 'section_reveal' ||
      play?.state === 'finished')
  ) {
    const waitPhase =
      play?.state === 'section_marking'
        ? 'marking'
        : play?.revealPhase === 'standings' || play?.state === 'finished'
          ? 'standings'
          : 'answers';
    return (
      <main
        style={{
          minHeight: '100dvh',
          padding: 16,
          maxWidth: 480,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 8,
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <TeamAvatar avatarId={play?.avatarId} size={40} />
            <div>
              <div style={{ fontWeight: 700 }}>{play?.teamName ?? 'Team'}</div>
              <div
                style={{
                  fontSize: 13,
                  color: connected ? 'var(--teal)' : 'var(--coral)',
                }}
              >
                {connected ? 'Connected' : 'Reconnecting…'}
              </div>
            </div>
          </div>
        </header>
        <div
          style={{
            flex: 1,
            display: 'grid',
            placeItems: 'center',
            position: 'relative',
            width: '100%',
          }}
        >
          {play?.state === 'finished' ? <FinalConfetti compact /> : null}
          {waitPhase === 'marking' ? (
            <MarkingRobot compact sectionTitle={play?.sectionTitle} />
          ) : waitPhase === 'answers' && play?.revealCard ? (
            <div
              key={play.revealCard.index}
              style={{ width: '100%', position: 'relative' }}
            >
              <RevealCard
                index={play.revealCard.index}
                total={play.revealCard.total}
                wording={play.revealCard.wording}
                correctDisplay={play.revealCard.correctDisplay}
                yourAnswerDisplay={play.revealCard.yourAnswerDisplay}
                markOutcome={play.revealCard.markOutcome}
                revealFact={play.revealCard.revealFact}
                imageUrl={play.revealCard.imageUrl}
              />
            </div>
          ) : (
            <ScoresWait
              phase={waitPhase}
              sectionTitle={play?.sectionTitle}
              myScore={play?.myScore}
              myRank={play?.myRank}
              isDemo={play?.isDemoSection}
            />
          )}
        </div>
      </main>
    );
  }

  if (phase === 'play' && play?.state === 'rules') {
    return (
      <main
        style={{
          minHeight: '100dvh',
          padding: 20,
          maxWidth: 480,
          margin: '0 auto',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <Bezel style={{ width: '100%' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', marginTop: 0 }}>
            Rules on the wall
          </h1>
          <p style={{ margin: '0 0 12px', lineHeight: 1.45 }}>
            Look up — scoring and how the night works are on the big screen.
          </p>
          <p style={{ margin: 0, color: 'var(--ink-muted)', lineHeight: 1.45 }}>
            Next you’ll play a short practice round (every answer type). Practice
            scores don’t count toward tonight’s total.
          </p>
        </Bezel>
      </main>
    );
  }

  if (phase === 'join') {
    return (
      <main
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: 20,
        }}
      >
        <Bezel style={{ width: 'min(440px, 100%)' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', marginTop: 0 }}>
            {info?.event.name ?? 'Join'}
          </h1>
          <form onSubmit={join} style={{ display: 'grid', gap: 12 }}>
            <label style={label}>
              Team name
              <input
                value={teamName}
                onChange={(e) => {
                  const name = e.target.value;
                  setTeamName(name);
                  const existing = info?.teams.find(
                    (t) => t.name.toLowerCase() === name.trim().toLowerCase(),
                  );
                  if (existing?.avatarId) {
                    setAvatarId(parseAvatarId(existing.avatarId));
                  }
                }}
                list="teams"
                style={input}
                required
              />
              <datalist id="teams">
                {info?.teams.map((t) => (
                  <option key={t.id} value={t.name} />
                ))}
              </datalist>
            </label>
            <label
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                fontSize: 14,
              }}
            >
              <input
                type="checkbox"
                checked={create}
                onChange={(e) => setCreate(e.target.checked)}
              />
              Register new team
            </label>
            <div style={{ display: 'grid', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {create ? 'Pick your avatar' : 'Avatar (optional on rejoin)'}
              </span>
              <AvatarPicker
                value={avatarId}
                onChange={setAvatarId}
                takenIds={takenAvatarIds}
              />
            </div>
            <label style={label}>
              Team members
              <textarea
                value={membersText}
                onChange={(e) => setMembersText(e.target.value)}
                style={{ ...input, minHeight: 88, resize: 'vertical' }}
                placeholder="One name per line"
                required={create}
              />
              <span style={{ fontSize: 12, color: 'var(--ink-muted)', fontWeight: 400 }}>
                Shown on the wall if you win. {create ? 'Required.' : 'Optional on rejoin.'}
              </span>
            </label>
            {!create ? (
              <label style={label}>
                Team PIN
                <input
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  style={input}
                  inputMode="numeric"
                  required
                />
              </label>
            ) : null}
            {create || !info?.event.nominations_locked ? (
              <label style={label}>
                Bonus section
                <select
                  value={bonusSectionId}
                  onChange={(e) => setBonusSectionId(e.target.value)}
                  style={input}
                  required={create}
                >
                  <option value="">Choose a bonus section…</option>
                  {info?.sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {error ? (
              <p style={{ color: 'var(--coral)', margin: 0 }}>{error}</p>
            ) : null}
            <Button type="submit" withArrow>
              Enter game
            </Button>
          </form>
        </Bezel>
      </main>
    );
  }

  if (showGetReady) {
    return (
      <main
        style={{
          minHeight: '100dvh',
          padding: 16,
          maxWidth: 480,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 8,
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <TeamAvatar avatarId={play?.avatarId} size={40} />
            <div>
              <div style={{ fontWeight: 700 }}>{play?.teamName ?? 'Team'}</div>
              <div
                style={{
                  fontSize: 13,
                  color: connected ? 'var(--teal)' : 'var(--coral)',
                }}
              >
                {connected ? 'Connected' : 'Reconnecting…'}
              </div>
            </div>
          </div>
        </header>
        <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
          <GetReady
            compact
            sectionTitle={play?.sectionTitle}
            topicImageUrls={play?.topicImageUrls}
            hint={
              play?.state === 'answer_closed'
                ? 'Answers locked — next question soon'
                : play?.isDemoSection
                  ? 'Practice only — scores do not count'
                  : null
            }
          />
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100dvh', padding: 16, maxWidth: 480, margin: '0 auto' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 12,
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <TeamAvatar avatarId={play?.avatarId} size={40} />
          <div>
            <div style={{ fontWeight: 700 }}>{play?.teamName ?? 'Team'}</div>
            <div
              style={{
                fontSize: 13,
                color: connected ? 'var(--teal)' : 'var(--coral)',
              }}
            >
              {connected ? 'Connected' : 'Reconnecting…'}
              {play?.submissionAuthority ? '' : ' · not active device'}
            </div>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            textAlign: 'right',
            fontSize: 13,
          }}
        >
          {play?.state === 'answer_open' && remainingMs != null ? (
            <CountdownRing
              remainingMs={remainingMs}
              durationMs={durationMs}
              size={44}
              urgent={urgent}
              paused={timerPaused}
            />
          ) : null}
          <div>
            <div>Q{play?.questionNumber ?? '—'}</div>
            <div
              className={urgent ? 'timer-urgent' : undefined}
              style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem' }}
            >
              {timerPaused ? 'Paused' : (seconds ?? '—')}
            </div>
          </div>
        </div>
      </header>

      {play?.isDemoSection ? (
        <p
          style={{
            margin: '0 0 12px',
            padding: '8px 12px',
            borderRadius: 10,
            background: 'var(--teal-soft)',
            fontSize: 13,
          }}
        >
          Practice round — try every answer type. Scores do not count.
        </p>
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, fontSize: 13, flexWrap: 'wrap', alignItems: 'center' }}>
        {!play?.isDemoSection ? (
          <>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 999,
                background: play?.wagerActive
                  ? 'var(--coral-soft)'
                  : 'var(--bg-elevated)',
                border: '1px solid var(--hairline)',
                fontWeight: 600,
              }}
            >
              <Coins
                size={16}
                weight={play?.wagerActive ? 'fill' : 'regular'}
                color={play?.wagerActive ? 'var(--coral)' : 'var(--ink-muted)'}
              />
              {play?.wagerActive
                ? 'Wager on this question'
                : `${play?.wagersRemaining ?? 0} wager${(play?.wagersRemaining ?? 0) === 1 ? '' : 's'} left`}
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--ink-muted)' }}>Wagers off in practice</span>
        )}
        {play?.inBonusSection ? (
          <span
            style={{
              color: 'var(--teal)',
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 999,
              background: 'var(--teal-soft)',
            }}
          >
            Bonus section
          </span>
        ) : null}
      </div>

      {play?.questionWording ? (
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(1.35rem, 5vw, 1.75rem)',
            lineHeight: 1.25,
            margin: '0 0 12px',
          }}
        >
          {play.questionWording}
        </h2>
      ) : null}

      {play?.mediaVideoUrl ? (
        <video
          key={play.mediaVideoUrl}
          src={play.mediaVideoUrl}
          controls
          playsInline
          style={{
            width: '100%',
            maxHeight: 220,
            borderRadius: 12,
            marginBottom: 12,
            background: '#0b0d10',
          }}
        />
      ) : null}

      {play?.mediaImageUrl && !play?.mediaVideoUrl ? (
        <img
          src={play.mediaImageUrl}
          alt=""
          style={{
            width: '100%',
            maxHeight: 200,
            objectFit: 'contain',
            borderRadius: 12,
            marginBottom: 12,
            background: 'var(--bg-0)',
          }}
        />
      ) : null}

      {play?.mediaAudioUrl ? (
        <audio
          controls
          src={play.mediaAudioUrl}
          style={{ width: '100%', marginBottom: 12 }}
        />
      ) : null}

      <Bezel>
        {!play?.answerWindowOpen ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
              {play?.state === 'question_revealed'
                ? 'Answers open soon…'
                : 'Waiting for the next question…'}
            </p>
            {play?.submissionAck ? (
              <SubmittedAnswer
                display={play.submissionAck.display}
                revision={play.submissionAck.revision}
              />
            ) : null}
          </div>
        ) : (
          <div className={ackFlash ? 'ack-pulse' : undefined}>
            {play.submissionAck && !revising ? (
              <div style={{ display: 'grid', gap: 12 }}>
                <SubmittedAnswer
                  display={play.submissionAck.display}
                  revision={play.submissionAck.revision}
                />
                <Button
                  variant="ghost"
                  disabled={!play.submissionAuthority}
                  onClick={startRevise}
                >
                  Revise
                </Button>
              </div>
            ) : (
              <>
                {play.questionFormat === 'multiple_choice' && play.optionLabels ? (
                  <div style={{ display: 'grid', gap: 10 }}>
                    {play.optionLabels.map((o) => (
                      <Button
                        key={o.id}
                        variant="ghost"
                        disabled={!play.submissionAuthority}
                        onClick={() => submit({ optionId: o.id })}
                        style={{ justifyContent: 'flex-start', width: '100%' }}
                      >
                        {o.label}
                      </Button>
                    ))}
                  </div>
                ) : null}

                {play.questionFormat === 'short_answer' ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submit({ text: localDraft });
                    }}
                    style={{ display: 'grid', gap: 12 }}
                  >
                    <input
                      value={localDraft}
                      onChange={(e) => setLocalDraft(e.target.value)}
                      placeholder="Type your answer"
                      style={input}
                      disabled={!play.submissionAuthority}
                    />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Button
                        type="submit"
                        disabled={!play.submissionAuthority}
                        withArrow
                      >
                        {revising ? 'Update answer' : 'Send answer'}
                      </Button>
                      {revising ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setRevising(false)}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </form>
                ) : null}

                {play.questionFormat === 'ordered_list' && play.orderItems ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {order.map((id, idx) => {
                      const item = play.orderItems!.find((i) => i.id === id)!;
                      return (
                        <div
                          key={id}
                          style={{
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                            padding: '0.65rem 0.75rem',
                            borderRadius: 12,
                            border: '1px solid var(--hairline)',
                          }}
                        >
                          <span style={{ width: 24 }}>{idx + 1}</span>
                          <span style={{ flex: 1 }}>{item.label}</span>
                          <Button
                            variant="ghost"
                            disabled={idx === 0 || !play.submissionAuthority}
                            onClick={() => {
                              const next = [...order];
                              [next[idx - 1], next[idx]] = [
                                next[idx]!,
                                next[idx - 1]!,
                              ];
                              setOrder(next);
                            }}
                          >
                            Up
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={
                              idx === order.length - 1 || !play.submissionAuthority
                            }
                            onClick={() => {
                              const next = [...order];
                              [next[idx + 1], next[idx]] = [
                                next[idx]!,
                                next[idx + 1]!,
                              ];
                              setOrder(next);
                            }}
                          >
                            Down
                          </Button>
                        </div>
                      );
                    })}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Button
                        disabled={!play.submissionAuthority}
                        onClick={() => submit({ order })}
                        withArrow
                      >
                        {revising ? 'Update order' : 'Submit order'}
                      </Button>
                      {revising ? (
                        <Button variant="ghost" onClick={() => setRevising(false)}>
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {play.questionFormat === 'matching' ? (
                  play.matchLeft?.length && play.matchRight?.length ? (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {play.matchLeft.map((l) => (
                        <label key={l.id} style={label}>
                          {l.label}
                          <select
                            style={input}
                            value={pairs[l.id] ?? ''}
                            disabled={!play.submissionAuthority}
                            onChange={(e) =>
                              setPairs((p) => ({ ...p, [l.id]: e.target.value }))
                            }
                          >
                            <option value="">Select…</option>
                            {play.matchRight!.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Button
                          disabled={!play.submissionAuthority}
                          onClick={() =>
                            submit({
                              pairs: Object.entries(pairs).map(
                                ([leftId, rightId]) => ({
                                  leftId,
                                  rightId,
                                }),
                              ),
                            })
                          }
                          withArrow
                        >
                          {revising ? 'Update matches' : 'Submit matches'}
                        </Button>
                        {revising ? (
                          <Button
                            variant="ghost"
                            onClick={() => setRevising(false)}
                          >
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p style={{ margin: 0, color: 'var(--coral)', fontSize: 13 }}>
                      Matching options unavailable — ask the host to edit this
                      question’s left/right columns.
                    </p>
                  )
                ) : null}

                {revising && play.questionFormat === 'multiple_choice' ? (
                  <Button
                    variant="ghost"
                    style={{ marginTop: 8 }}
                    onClick={() => setRevising(false)}
                  >
                    Cancel
                  </Button>
                ) : null}
              </>
            )}

            {!play.isDemoSection ? (
              <WagerControl
                active={play.wagerActive}
                remaining={play.wagersRemaining}
                inBonus={play.inBonusSection}
                disabled={
                  !play.submissionAuthority ||
                  play.wagerActive ||
                  play.wagersRemaining <= 0 ||
                  !play.answerWindowOpen ||
                  play.inBonusSection
                }
                onWager={wager}
              />
            ) : null}
          </div>
        )}
        {error && !play?.inBonusSection ? (
          <p style={{ color: 'var(--coral)' }}>{error}</p>
        ) : null}
      </Bezel>
    </main>
  );
}

function WagerControl({
  active,
  remaining,
  inBonus,
  disabled,
  onWager,
}: {
  active: boolean;
  remaining: number;
  inBonus: boolean;
  disabled: boolean;
  onWager: () => void;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <Button variant="ghost" disabled={disabled} onClick={onWager}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Coins size={18} weight={active ? 'fill' : 'regular'} />
          {active ? 'Wager locked' : 'Use wager'}
        </span>
      </Button>
      {inBonus ? (
        <p
          style={{
            margin: '8px 0 0',
            fontSize: 13,
            color: 'var(--ink-muted)',
          }}
        >
          Wagers can’t be used in your bonus section
        </p>
      ) : active ? (
        <p
          style={{
            margin: '8px 0 0',
            fontSize: 13,
            color: 'var(--coral)',
          }}
        >
          Wager locked on this question
        </p>
      ) : remaining <= 0 ? (
        <p
          style={{
            margin: '8px 0 0',
            fontSize: 13,
            color: 'var(--ink-muted)',
          }}
        >
          No wagers left
        </p>
      ) : null}
    </div>
  );
}

function SubmittedAnswer({
  display,
  revision,
}: {
  display: string;
  revision: number;
}) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Your answer</div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '1.35rem',
          lineHeight: 1.25,
          wordBreak: 'break-word',
        }}
      >
        {display}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
        Received · rev {revision}
      </div>
    </div>
  );
}

const label: CSSProperties = { display: 'grid', gap: 6, fontSize: 13 };
const input: CSSProperties = {
  padding: '0.85rem 1rem',
  borderRadius: 12,
  border: '1px solid var(--hairline)',
  background: 'var(--bg-0)',
};
