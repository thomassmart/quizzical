import type { CSSProperties } from 'react';

/** Lightweight CSS confetti for Final standings — no npm dependency. */
export function FinalConfetti({ compact = false }: { compact?: boolean }) {
  const pieces = Array.from({ length: compact ? 18 : 36 }, (_, i) => i);
  return (
    <div
      className={`final-confetti${compact ? ' compact' : ''}`}
      aria-hidden
    >
      {pieces.map((i) => (
        <span
          key={i}
          className={`final-confetti-piece tone-${i % 4} shape-${i % 3}`}
          style={
            {
              ['--fc-left' as string]: `${(i * 37) % 100}%`,
              ['--fc-delay' as string]: `${(i % 12) * 0.08}s`,
              ['--fc-dur' as string]: `${2.2 + (i % 5) * 0.25}s`,
              ['--fc-rot' as string]: `${(i * 47) % 360}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
