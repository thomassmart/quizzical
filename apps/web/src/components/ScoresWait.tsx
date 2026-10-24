import type { CSSProperties } from 'react';
import { formatScore } from '@quizzical/shared';

/** Whimsical phone idle while answers/scores are on the wall. */
export function ScoresWait({
  phase,
  sectionTitle,
  myScore,
  myRank,
  isDemo,
}: {
  phase: 'answers' | 'standings' | 'marking';
  sectionTitle?: string | null;
  myScore?: number | null;
  myRank?: number | null;
  isDemo?: boolean;
}) {
  const onStandings = phase === 'standings';
  const onMarking = phase === 'marking';

  return (
    <section
      className="stage-enter scores-wait"
      style={stage}
      aria-live="polite"
      aria-label={
        onMarking
          ? 'Marking in progress'
          : onStandings
            ? 'Scores on the wall'
            : 'Answers on the wall'
      }
    >
      <p style={eyebrow}>
        {onMarking ? 'Hold tight' : onStandings ? 'Look up' : 'Eyes on the wall'}
      </p>
      <h1 style={title}>
        {onMarking
          ? 'Marking in progress'
          : onStandings
            ? isDemo
              ? 'Practice scores up'
              : 'Scores are up'
            : 'Answers revealing'}
      </h1>
      <p style={sub}>
        {onMarking
          ? sectionTitle
            ? `Our robot is grading ${sectionTitle}`
            : 'Our robot is grading this section'
          : onStandings
            ? sectionTitle
              ? `Running totals for ${sectionTitle}`
              : 'Running totals are on the big screen'
            : sectionTitle
              ? `Correct answers for ${sectionTitle}`
              : 'Correct answers are on the big screen'}
      </p>

      <div className="scores-wait-scene" style={scene}>
        <svg
          viewBox="0 0 360 280"
          width="100%"
          height="100%"
          role="img"
          aria-hidden
        >
          <defs>
            <linearGradient id="swBoard" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1a1d22" />
              <stop offset="100%" stopColor="#2c313a" />
            </linearGradient>
          </defs>

          {/* floating confetti dots */}
          <circle className="sw-dot sw-dot-1" cx="48" cy="56" r="6" fill="#0d9488" />
          <circle className="sw-dot sw-dot-2" cx="310" cy="44" r="5" fill="#e11d48" />
          <circle className="sw-dot sw-dot-3" cx="330" cy="110" r="4" fill="#5eead4" />
          <circle className="sw-dot sw-dot-4" cx="40" cy="130" r="5" fill="#121417" />

          {/* scoreboard */}
          <g className="sw-board">
            <rect
              x="70"
              y="70"
              width="220"
              height="150"
              rx="22"
              fill="url(#swBoard)"
            />
            <rect x="88" y="90" width="184" height="14" rx="7" fill="#3a404a" />
            <rect
              className="sw-bar sw-bar-1"
              x="88"
              y="124"
              width="150"
              height="18"
              rx="9"
              fill="#0d9488"
            />
            <rect
              className="sw-bar sw-bar-2"
              x="88"
              y="156"
              width="110"
              height="18"
              rx="9"
              fill="#5eead4"
              opacity="0.85"
            />
            <rect
              className="sw-bar sw-bar-3"
              x="88"
              y="188"
              width="80"
              height="18"
              rx="9"
              fill="#e11d48"
              opacity="0.9"
            />
          </g>

          {/* bouncing trophy / stamp */}
          <g className="sw-badge">
            <circle cx="280" cy="78" r="28" fill="#0d9488" />
            <text
              x="280"
              y="86"
              textAnchor="middle"
              fill="#fff"
              fontSize="22"
              fontFamily="Fraunces, Georgia, serif"
            >
              {onMarking ? '✓' : onStandings ? '★' : '?'}
            </text>
          </g>
        </svg>
      </div>

      {onStandings && myRank != null && myScore != null ? (
        <div style={ownScore}>
          <div style={ownLabel}>Your place</div>
          <div style={ownValue}>
            #{myRank}
            <span style={ownPts}> · {formatScore(myScore)} pts</span>
          </div>
        </div>
      ) : (
        <p style={hint}>
          {onMarking
            ? 'Answers reveal next — then the score table'
            : onStandings
              ? 'Hang tight for the next section'
              : 'Keep phones down — no peeking at neighbours'}
        </p>
      )}
    </section>
  );
}

const stage: CSSProperties = {
  width: '100%',
  textAlign: 'center',
  padding: '0.5rem 0 1rem',
};

const eyebrow: CSSProperties = {
  fontSize: 13,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'var(--ink-muted)',
  margin: '0 0 8px',
};

const title: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'clamp(1.75rem, 8vw, 2.4rem)',
  margin: 0,
  lineHeight: 1.05,
};

const sub: CSSProperties = {
  fontSize: 'clamp(0.95rem, 3.5vw, 1.1rem)',
  color: 'var(--ink-muted)',
  margin: '0.6rem 0 0',
  lineHeight: 1.35,
};

const scene: CSSProperties = {
  width: 'min(100%, 320px)',
  margin: '1.25rem auto 0',
  aspectRatio: '360 / 280',
};

const hint: CSSProperties = {
  marginTop: '1rem',
  fontSize: 14,
  color: 'var(--ink-muted)',
  lineHeight: 1.4,
};

const ownScore: CSSProperties = {
  marginTop: '1.1rem',
  padding: '12px 16px',
  borderRadius: 16,
  background: 'var(--teal-soft)',
  border: '1px solid rgba(13,148,136,0.2)',
};

const ownLabel: CSSProperties = {
  fontSize: 12,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-muted)',
  fontWeight: 600,
};

const ownValue: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: '1.75rem',
  fontWeight: 700,
  color: 'var(--teal)',
  marginTop: 2,
};

const ownPts: CSSProperties = {
  fontSize: '1.15rem',
  color: 'var(--ink)',
  fontWeight: 600,
};
