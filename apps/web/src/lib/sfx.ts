import {
  isBuzzerId,
  isSystemSfxId,
  type BuzzerId,
  type SfxId,
  type SystemSfxId,
} from '@quizzical/shared';
import { sfxUrl } from './sfxAssets';

type PlayOpts = {
  volume?: number;
  loop?: boolean;
};

let unlocked = false;
let unlockBound = false;
const looping = new Map<SfxId, HTMLAudioElement>();

function resolveUrl(id: SfxId): string | undefined {
  if (isBuzzerId(id) || isSystemSfxId(id)) return sfxUrl(id);
  return undefined;
}

/** Call once from wall/play so later plays are allowed under autoplay policy. */
export function unlockSfx(): void {
  if (unlocked) return;
  unlocked = true;
  try {
    const a = new Audio();
    a.src =
      sfxUrl('blip') ??
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
    a.volume = 0.001;
    void a.play().then(() => {
      a.pause();
    }).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

/** Bind one-time gesture listeners so SFX unlock without a dedicated button. */
export function bindSfxUnlock(): () => void {
  if (unlockBound || typeof window === 'undefined') return () => undefined;
  unlockBound = true;
  const onGesture = () => {
    unlockSfx();
    window.removeEventListener('pointerdown', onGesture);
    window.removeEventListener('keydown', onGesture);
  };
  window.addEventListener('pointerdown', onGesture, { passive: true });
  window.addEventListener('keydown', onGesture);
  return () => {
    window.removeEventListener('pointerdown', onGesture);
    window.removeEventListener('keydown', onGesture);
  };
}

export function playSfx(id: SfxId | string, opts: PlayOpts = {}): void {
  if (!isBuzzerId(id) && !isSystemSfxId(id)) return;
  const url = resolveUrl(id);
  if (!url) return;

  const volume = opts.volume ?? 0.7;
  const loop = Boolean(opts.loop);

  if (loop) {
    stopSfx(id);
    try {
      const audio = new Audio(url);
      audio.loop = true;
      audio.volume = Math.max(0, Math.min(1, volume));
      looping.set(id, audio);
      void audio.play().catch(() => undefined);
    } catch {
      /* ignore */
    }
    return;
  }

  try {
    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, volume));
    void audio.play().catch(() => undefined);
  } catch {
    /* ignore */
  }
}

export function stopSfx(id: SfxId | string): void {
  const audio = looping.get(id as SfxId);
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch {
    /* ignore */
  }
  looping.delete(id as SfxId);
}

export function stopAllLoopingSfx(): void {
  for (const id of [...looping.keys()]) stopSfx(id);
}

export function playBuzzer(id: BuzzerId | string | null | undefined): void {
  if (!id || !isBuzzerId(id)) return;
  playSfx(id, { volume: 0.85 });
}

export function playSystem(
  id: SystemSfxId,
  opts: PlayOpts = {},
): void {
  playSfx(id, opts);
}
