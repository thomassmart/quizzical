import type { CSSProperties } from 'react';

/** Full-stage whimsical loop: a robot marking team scores. */
export function MarkingRobot({
  sectionTitle,
  compact = false,
}: {
  sectionTitle?: string | null;
  /** Phone-sized layout (team play) */
  compact?: boolean;
}) {
  return (
    <section
      className={`stage-enter marking-stage${compact ? ' compact' : ''}`}
      style={compact ? stageCompact : stage}
      aria-live="polite"
      aria-label="Marking section scores"
    >
      <p style={eyebrow}>Hold tight</p>
      <h1 style={compact ? titleCompact : title}>Marking in progress</h1>
      <p style={compact ? subCompact : sub}>
        {sectionTitle
          ? `Our robot is grading ${sectionTitle}`
          : 'Our robot is grading this section'}
      </p>

      <div
        className="marking-scene"
        style={compact ? sceneCompact : scene}
      >
        <svg
          viewBox="0 0 640 420"
          width="100%"
          height="100%"
          role="img"
          aria-hidden
        >
          <defs>
            <linearGradient id="deskGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#e8eaee" />
            </linearGradient>
            <linearGradient id="botGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#1a1d22" />
              <stop offset="100%" stopColor="#2c313a" />
            </linearGradient>
          </defs>

          {/* desk */}
          <rect
            x="40"
            y="300"
            width="560"
            height="90"
            rx="18"
            fill="url(#deskGrad)"
            stroke="rgba(18,20,23,0.08)"
          />
          <ellipse
            cx="320"
            cy="390"
            rx="210"
            ry="14"
            fill="rgba(18,20,23,0.06)"
          />

          {/* sliding score sheets */}
          <g className="marking-sheet marking-sheet-a">
            <rect x="70" y="250" width="150" height="100" rx="10" fill="#fff" stroke="rgba(18,20,23,0.1)" />
            <rect x="88" y="270" width="90" height="8" rx="4" fill="#c5cad3" />
            <rect x="88" y="288" width="70" height="8" rx="4" fill="#d7dbe2" />
            <rect x="88" y="306" width="80" height="8" rx="4" fill="#d7dbe2" />
            <text x="175" y="330" className="marking-tick" fill="#0d9488" fontSize="28" fontFamily="Fraunces, Georgia, serif">✓</text>
          </g>
          <g className="marking-sheet marking-sheet-b">
            <rect x="245" y="255" width="150" height="100" rx="10" fill="#fff" stroke="rgba(18,20,23,0.1)" />
            <rect x="263" y="275" width="95" height="8" rx="4" fill="#c5cad3" />
            <rect x="263" y="293" width="60" height="8" rx="4" fill="#d7dbe2" />
            <rect x="263" y="311" width="75" height="8" rx="4" fill="#d7dbe2" />
            <text x="350" y="335" className="marking-tick marking-tick-b" fill="#e11d48" fontSize="26" fontFamily="Fraunces, Georgia, serif">+2</text>
          </g>
          <g className="marking-sheet marking-sheet-c">
            <rect x="420" y="250" width="150" height="100" rx="10" fill="#fff" stroke="rgba(18,20,23,0.1)" />
            <rect x="438" y="270" width="85" height="8" rx="4" fill="#c5cad3" />
            <rect x="438" y="288" width="65" height="8" rx="4" fill="#d7dbe2" />
            <rect x="438" y="306" width="78" height="8" rx="4" fill="#d7dbe2" />
            <text x="525" y="330" className="marking-tick marking-tick-c" fill="#0d9488" fontSize="28" fontFamily="Fraunces, Georgia, serif">✓</text>
          </g>

          {/* robot body */}
          <g className="marking-bot">
            {/* antenna */}
            <line
              x1="320"
              y1="78"
              x2="320"
              y2="48"
              stroke="#121417"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <circle className="marking-antenna" cx="320" cy="40" r="8" fill="#0d9488" />

            {/* head */}
            <rect x="250" y="78" width="140" height="100" rx="28" fill="url(#botGrad)" />
            <rect x="268" y="108" width="104" height="48" rx="16" fill="#0b0d10" />
            <g className="marking-eyes">
              <circle cx="295" cy="132" r="10" fill="#5eead4" />
              <circle cx="345" cy="132" r="10" fill="#5eead4" />
            </g>
            <path
              d="M300 158 Q320 172 340 158"
              fill="none"
              stroke="#5eead4"
              strokeWidth="3"
              strokeLinecap="round"
            />

            {/* torso */}
            <rect x="235" y="185" width="170" height="120" rx="32" fill="url(#botGrad)" />
            <rect x="275" y="210" width="90" height="54" rx="14" fill="#0b0d10" />
            <text
              x="320"
              y="244"
              textAnchor="middle"
              fill="#0d9488"
              fontSize="18"
              fontFamily="Plus Jakarta Sans, sans-serif"
              fontWeight="700"
              className="marking-panel"
            >
              SCORE
            </text>

            {/* left arm (idle hold) */}
            <g className="marking-arm-left">
              <rect x="175" y="200" width="58" height="22" rx="11" fill="#2c313a" />
              <circle cx="175" cy="211" r="16" fill="#121417" />
            </g>

            {/* right arm + stamp */}
            <g className="marking-arm-right">
              <rect x="405" y="198" width="70" height="24" rx="12" fill="#2c313a" />
              <g className="marking-stamp">
                <rect x="470" y="185" width="48" height="56" rx="10" fill="#e11d48" />
                <rect x="478" y="195" width="32" height="22" rx="4" fill="#fff" opacity="0.9" />
                <text
                  x="494"
                  y="228"
                  textAnchor="middle"
                  fill="#fff"
                  fontSize="11"
                  fontFamily="Plus Jakarta Sans, sans-serif"
                  fontWeight="700"
                >
                  OK
                </text>
              </g>
            </g>
          </g>

          {/* floating chips */}
          <g className="marking-chip marking-chip-1">
            <rect x="90" y="90" width="72" height="36" rx="18" fill="#0d9488" />
            <text x="126" y="114" textAnchor="middle" fill="#fff" fontSize="16" fontFamily="Fraunces, Georgia, serif">+1</text>
          </g>
          <g className="marking-chip marking-chip-2">
            <rect x="480" y="70" width="78" height="36" rx="18" fill="#121417" />
            <text x="519" y="94" textAnchor="middle" fill="#5eead4" fontSize="15" fontFamily="Fraunces, Georgia, serif">✦</text>
          </g>
          <g className="marking-chip marking-chip-3">
            <rect x="520" y="150" width="72" height="36" rx="18" fill="#e11d48" />
            <text x="556" y="174" textAnchor="middle" fill="#fff" fontSize="16" fontFamily="Fraunces, Georgia, serif">+3</text>
          </g>
        </svg>
      </div>

      <p style={compact ? hintCompact : hint}>
        Answers reveal next — then the score table
      </p>
    </section>
  );
}

const stage: CSSProperties = {
  width: 'min(960px, 94vw)',
  maxHeight: 'calc(100dvh - 4vh)',
  textAlign: 'center',
  padding: 'clamp(1.5vh, 3vh, 4vh) 0',
  overflow: 'hidden',
};

const stageCompact: CSSProperties = {
  width: '100%',
  maxHeight: 'none',
  textAlign: 'center',
  padding: '0.5rem 0 1rem',
  overflow: 'hidden',
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
  fontSize: 'clamp(2rem, 6vmin, 3.75rem)',
  margin: 0,
  lineHeight: 1,
};

const titleCompact: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'clamp(1.75rem, 8vw, 2.4rem)',
  margin: 0,
  lineHeight: 1.05,
};

const sub: CSSProperties = {
  fontSize: 'clamp(1rem, 2.4vmin, 1.4rem)',
  color: 'var(--ink-muted)',
  margin: '0.75rem 0 0',
};

const subCompact: CSSProperties = {
  fontSize: 'clamp(0.95rem, 3.5vw, 1.1rem)',
  color: 'var(--ink-muted)',
  margin: '0.6rem 0 0',
  lineHeight: 1.35,
};

const scene: CSSProperties = {
  width: 'min(640px, 70vw, 48vh)',
  margin: 'clamp(1rem, 3vh, 2rem) auto 0',
  aspectRatio: '640 / 420',
};

const sceneCompact: CSSProperties = {
  width: 'min(100%, 360px)',
  margin: '1.25rem auto 0',
  aspectRatio: '640 / 420',
};

const hint: CSSProperties = {
  marginTop: 'clamp(0.85rem, 2vh, 1.5rem)',
  fontSize: 'clamp(0.95rem, 2.2vmin, 1.05rem)',
  color: 'var(--ink-muted)',
};

const hintCompact: CSSProperties = {
  marginTop: '1rem',
  fontSize: 14,
  color: 'var(--ink-muted)',
  lineHeight: 1.4,
};
