import { useEffect, useState } from 'react';
import type { TimerSnapshot } from '@quizzical/shared';

/**
 * Local countdown from the shared deadline so wall / host / team stay in sync
 * without waiting for a WebSocket tick every second.
 */
export function useLiveTimer(timer?: TimerSnapshot | null) {
  const [now, setNow] = useState(() => Date.now());
  const deadlineAt = timer?.deadlineAt ?? null;
  const paused = Boolean(timer?.paused);
  const running = Boolean(timer && !paused && deadlineAt != null);

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [running, deadlineAt]);

  if (!timer) {
    return {
      remainingMs: null as number | null,
      seconds: null as number | null,
      durationMs: null as number | null,
      paused: false,
      urgent: false,
      critical: false,
    };
  }

  const remainingMs =
    running && deadlineAt != null
      ? Math.max(0, deadlineAt - now)
      : Math.max(0, timer.remainingMs);

  return {
    remainingMs,
    seconds: Math.ceil(remainingMs / 1000),
    // Prefer server duration; fall back so the ring still animates
    durationMs:
      timer.durationMs != null && timer.durationMs > 0
        ? timer.durationMs
        : null,
    paused,
    urgent: remainingMs > 0 && remainingMs <= 10_000,
    /** Last 5 seconds — urgency SFX threshold */
    critical: remainingMs > 0 && remainingMs <= 5_000,
  };
}
