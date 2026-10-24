import type { CSSProperties } from 'react';

/**
 * Circular countdown progress next to the numeric timer.
 * progress 1 = full time left, 0 = expired.
 */
export function CountdownRing({
  remainingMs,
  durationMs,
  size = 56,
  urgent = false,
  paused = false,
  label,
}: {
  remainingMs: number | null;
  durationMs?: number | null;
  size?: number;
  urgent?: boolean;
  paused?: boolean;
  /** Accessible label; defaults to remaining seconds */
  label?: string;
}) {
  if (remainingMs == null || remainingMs < 0) return null;

  const total = Math.max(durationMs ?? remainingMs, remainingMs, 1);
  const progress = Math.min(1, Math.max(0, remainingMs / total));
  const stroke = Math.max(3, Math.round(size * 0.09));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - progress);
  const color = urgent ? 'var(--coral)' : 'var(--teal)';
  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <div
      role="img"
      aria-label={label ?? `${seconds} seconds remaining${paused ? ', paused' : ''}`}
      style={
        {
          width: size,
          height: size,
          flexShrink: 0,
          position: 'relative',
          opacity: paused ? 0.55 : 1,
          transition: 'opacity 200ms',
        } satisfies CSSProperties
      }
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: 'block', transform: 'rotate(-90deg)' }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--hairline)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{
            transition: paused
              ? 'none'
              : 'stroke-dashoffset 200ms linear, stroke 200ms',
          }}
        />
      </svg>
    </div>
  );
}
