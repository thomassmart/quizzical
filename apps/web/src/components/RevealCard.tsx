import type { CSSProperties } from 'react';
import { Bezel } from './Bezel';

type MarkOutcome = 'correct' | 'incorrect' | 'partial' | 'unanswered' | null;

/** Team phone: correct answer vs yours during wall answer reveal. */
export function RevealCard({
  index,
  total,
  wording,
  correctDisplay,
  yourAnswerDisplay,
  markOutcome,
  revealFact,
  imageUrl,
}: {
  index: number;
  total: number;
  wording: string;
  correctDisplay: string;
  yourAnswerDisplay: string | null;
  markOutcome: MarkOutcome;
  revealFact?: string | null;
  imageUrl?: string | null;
}) {
  const outcome = markOutcome ?? 'unanswered';
  const outcomeColor =
    outcome === 'correct'
      ? 'var(--teal)'
      : outcome === 'incorrect'
        ? 'var(--coral)'
        : outcome === 'partial'
          ? 'var(--ink)'
          : 'var(--ink-muted)';
  const outcomeLabel =
    outcome === 'correct'
      ? 'Correct'
      : outcome === 'incorrect'
        ? 'Incorrect'
        : outcome === 'partial'
          ? 'Partial'
          : 'No answer';

  return (
    <Bezel className="stage-enter" style={{ width: '100%' }}>
      <p style={eyebrow}>
        Answer {index + 1} of {total}
      </p>
      <p style={wordingStyle}>{wording}</p>

      <div style={block}>
        <div style={label}>Correct</div>
        <div style={correctValue}>{correctDisplay}</div>
      </div>

      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          style={{
            marginTop: 14,
            width: '100%',
            maxHeight: 220,
            objectFit: 'contain',
            borderRadius: 14,
            background: 'var(--bg-0)',
          }}
        />
      ) : null}

      <div style={{ ...block, marginTop: 14 }}>
        <div style={{ ...label, color: outcomeColor }}>Your answer · {outcomeLabel}</div>
        <div
          style={{
            ...yourValue,
            color: outcomeColor,
          }}
        >
          {yourAnswerDisplay?.trim() || 'No answer'}
        </div>
      </div>

      {revealFact?.trim() ? (
        <div style={factBox}>
          <div style={factEyebrow}>Did you know</div>
          <p style={factBody}>{revealFact.trim()}</p>
        </div>
      ) : null}
    </Bezel>
  );
}

const eyebrow: CSSProperties = {
  margin: '0 0 8px',
  fontSize: 12,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-muted)',
  fontWeight: 600,
};

const wordingStyle: CSSProperties = {
  margin: '0 0 16px',
  fontSize: 15,
  lineHeight: 1.4,
  color: 'var(--ink-muted)',
};

const block: CSSProperties = {
  display: 'grid',
  gap: 4,
};

const label: CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-muted)',
  fontWeight: 600,
};

const correctValue: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: '1.55rem',
  fontWeight: 700,
  color: 'var(--teal)',
  lineHeight: 1.2,
  wordBreak: 'break-word',
};

const yourValue: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: '1.25rem',
  fontWeight: 600,
  lineHeight: 1.25,
  wordBreak: 'break-word',
};

const factBox: CSSProperties = {
  marginTop: 16,
  padding: '10px 12px',
  borderRadius: 14,
  background: 'var(--teal-soft)',
  border: '1px solid rgba(13,148,136,0.18)',
};

const factEyebrow: CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--teal)',
  fontWeight: 700,
  marginBottom: 4,
};

const factBody: CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.4,
  color: 'var(--ink)',
};
