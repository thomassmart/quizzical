import { useEffect, useRef } from 'react';
import {
  bindSfxUnlock,
  playSystem,
  stopSfx,
} from '../lib/sfx';

/**
 * Shared room SFX for wall + team play: unlock on gesture, answers-open chime,
 * last-5s urgency loop, and time-up buzzer.
 */
export function useRoomSfx(opts: {
  state?: string | null;
  critical: boolean;
  timerPaused: boolean;
}) {
  const { state, critical, timerPaused } = opts;
  const prevState = useRef<string | null | undefined>(undefined);
  const urgencyOn = useRef(false);
  const playedTimeUpFor = useRef<string | null>(null);

  useEffect(() => bindSfxUnlock(), []);

  useEffect(() => {
    const prev = prevState.current;
    prevState.current = state;

    if (state === 'answer_open' && prev != null && prev !== 'answer_open') {
      playSystem('answers_open');
      playedTimeUpFor.current = null;
    }

    if (
      state === 'answer_closed' &&
      prev === 'answer_open' &&
      playedTimeUpFor.current !== state
    ) {
      stopSfx('timer_urgency');
      urgencyOn.current = false;
      playSystem('timer_up');
      playedTimeUpFor.current = state;
    }

    if (state !== 'answer_open' && urgencyOn.current) {
      stopSfx('timer_urgency');
      urgencyOn.current = false;
    }
  }, [state]);

  useEffect(() => {
    if (state !== 'answer_open' || timerPaused || !critical) {
      if (urgencyOn.current) {
        stopSfx('timer_urgency');
        urgencyOn.current = false;
      }
      return;
    }
    if (!urgencyOn.current) {
      playSystem('timer_urgency', { loop: true, volume: 0.55 });
      urgencyOn.current = true;
    }
  }, [state, critical, timerPaused]);
}
