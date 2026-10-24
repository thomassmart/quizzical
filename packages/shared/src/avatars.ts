/** Stable team avatar ids — UI assets live in apps/web. */
export const AVATAR_IDS = [
  'red-panda',
  'blue-whale',
  'fox',
  'owl',
  'koala',
  'kangaroo',
  'emu',
  'platypus',
  'cockatoo',
  'wombat',
  'shark',
  'octopus',
  'flamingo',
  'raccoon',
  'cat',
  'dog',
  'parrot',
  'penguin',
  'frog',
  'bee',
] as const;

export type AvatarId = (typeof AVATAR_IDS)[number];

export const AVATAR_LABELS: Record<AvatarId, string> = {
  'red-panda': 'Red Panda',
  'blue-whale': 'Blue Whale',
  fox: 'Fox',
  owl: 'Owl',
  koala: 'Koala',
  kangaroo: 'Kangaroo',
  emu: 'Emu',
  platypus: 'Platypus',
  cockatoo: 'Cockatoo',
  wombat: 'Wombat',
  shark: 'Shark',
  octopus: 'Octopus',
  flamingo: 'Flamingo',
  raccoon: 'Raccoon',
  cat: 'Cat',
  dog: 'Dog',
  parrot: 'Parrot',
  penguin: 'Penguin',
  frog: 'Frog',
  bee: 'Bee',
};

export const DEFAULT_AVATAR_ID: AvatarId = 'red-panda';

export function isAvatarId(value: unknown): value is AvatarId {
  return (
    typeof value === 'string' &&
    (AVATAR_IDS as readonly string[]).includes(value)
  );
}

export function parseAvatarId(
  value: unknown,
  fallback: AvatarId = DEFAULT_AVATAR_ID,
): AvatarId {
  return isAvatarId(value) ? value : fallback;
}
