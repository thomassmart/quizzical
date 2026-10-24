/** Stable team buzzer ids — UI assets live in apps/web. */
export const BUZZER_IDS = [
  'zoink',
  'fart',
  'bing',
  'boing',
  'honk',
  'quack',
  'pop',
  'blip',
  'thud',
  'sproing',
  'whistle',
  'clunk',
  'ping',
  'buzz',
  'chirp',
  'plop',
  'twang',
  'whoopee',
  'kazoo',
  'laser',
  'coin',
  'powerup',
  'rubber',
  'bubble',
  'sneeze',
  'gulp',
  'snare',
  'rimshot',
  'duck',
  'meep',
] as const;

export type BuzzerId = (typeof BUZZER_IDS)[number];

export const BUZZER_LABELS: Record<BuzzerId, string> = {
  zoink: 'Zoink',
  fart: 'Fart',
  bing: 'Bing',
  boing: 'Boing',
  honk: 'Honk',
  quack: 'Quack',
  pop: 'Pop',
  blip: 'Blip',
  thud: 'Thud',
  sproing: 'Sproing',
  whistle: 'Whistle',
  clunk: 'Clunk',
  ping: 'Ping',
  buzz: 'Buzz',
  chirp: 'Chirp',
  plop: 'Plop',
  twang: 'Twang',
  whoopee: 'Whoopee',
  kazoo: 'Kazoo',
  laser: 'Laser',
  coin: 'Coin',
  powerup: 'Power-up',
  rubber: 'Rubber band',
  bubble: 'Bubble',
  sneeze: 'Sneeze',
  gulp: 'Gulp',
  snare: 'Snare',
  rimshot: 'Rimshot',
  duck: 'Duck',
  meep: 'Meep',
};

export const DEFAULT_BUZZER_ID: BuzzerId = 'zoink';

export function isBuzzerId(value: unknown): value is BuzzerId {
  return (
    typeof value === 'string' &&
    (BUZZER_IDS as readonly string[]).includes(value)
  );
}

export function parseBuzzerId(
  value: unknown,
  fallback: BuzzerId = DEFAULT_BUZZER_ID,
): BuzzerId {
  return isBuzzerId(value) ? value : fallback;
}

/** Pick a random buzzer not already used on the event; reuse when all taken. */
export function pickBuzzerId(used: Iterable<string>): BuzzerId {
  const taken = new Set(
    [...used].filter((id): id is BuzzerId => isBuzzerId(id)),
  );
  const free = BUZZER_IDS.filter((id) => !taken.has(id));
  const pool = free.length > 0 ? free : [...BUZZER_IDS];
  return pool[Math.floor(Math.random() * pool.length)]!;
}

/** System / room SFX (not assigned per team). */
export const SYSTEM_SFX_IDS = [
  'timer_urgency',
  'timer_up',
  'answers_open',
  'wager',
  'reveal_answer',
  'speed_winner',
  'standings',
] as const;

export type SystemSfxId = (typeof SYSTEM_SFX_IDS)[number];

export type SfxId = BuzzerId | SystemSfxId;

export function isSystemSfxId(value: unknown): value is SystemSfxId {
  return (
    typeof value === 'string' &&
    (SYSTEM_SFX_IDS as readonly string[]).includes(value)
  );
}

export function isSfxId(value: unknown): value is SfxId {
  return isBuzzerId(value) || isSystemSfxId(value);
}
