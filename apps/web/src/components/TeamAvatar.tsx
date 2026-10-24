import {
  AVATAR_IDS,
  AVATAR_LABELS,
  parseAvatarId,
  type AvatarId,
} from '@quizzical/shared';
import type { CSSProperties } from 'react';

import bee from '../assets/avatars/bee.svg';
import blueWhale from '../assets/avatars/blue-whale.svg';
import cat from '../assets/avatars/cat.svg';
import cockatoo from '../assets/avatars/cockatoo.svg';
import dog from '../assets/avatars/dog.svg';
import emu from '../assets/avatars/emu.svg';
import flamingo from '../assets/avatars/flamingo.svg';
import fox from '../assets/avatars/fox.svg';
import frog from '../assets/avatars/frog.svg';
import kangaroo from '../assets/avatars/kangaroo.svg';
import koala from '../assets/avatars/koala.svg';
import octopus from '../assets/avatars/octopus.svg';
import owl from '../assets/avatars/owl.svg';
import parrot from '../assets/avatars/parrot.svg';
import penguin from '../assets/avatars/penguin.svg';
import platypus from '../assets/avatars/platypus.svg';
import raccoon from '../assets/avatars/raccoon.svg';
import redPanda from '../assets/avatars/red-panda.svg';
import shark from '../assets/avatars/shark.svg';
import wombat from '../assets/avatars/wombat.svg';

const SRC: Record<AvatarId, string> = {
  'red-panda': redPanda,
  'blue-whale': blueWhale,
  fox,
  owl,
  koala,
  kangaroo,
  emu,
  platypus,
  cockatoo,
  wombat,
  shark,
  octopus,
  flamingo,
  raccoon,
  cat,
  dog,
  parrot,
  penguin,
  frog,
  bee,
};

export function TeamAvatar({
  avatarId,
  size = 40,
  label,
  style,
}: {
  avatarId?: string | null;
  size?: number;
  /** Override accessible name; defaults to catalog label */
  label?: string;
  style?: CSSProperties;
}) {
  const id = parseAvatarId(avatarId);
  const alt = label ?? AVATAR_LABELS[id];
  return (
    <img
      src={SRC[id]}
      alt={alt}
      width={size}
      height={size}
      draggable={false}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'block',
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

export function AvatarPicker({
  value,
  onChange,
  takenIds,
}: {
  value: AvatarId;
  onChange: (id: AvatarId) => void;
  /** Avatars already used by other teams on this event — not selectable */
  takenIds?: Iterable<string>;
}) {
  const taken = new Set(takenIds ?? []);
  return (
    <div
      role="listbox"
      aria-label="Team avatar"
      className="avatar-picker"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 8,
      }}
    >
      {AVATAR_IDS.map((id) => {
        const selected = id === value;
        const isTaken = taken.has(id);
        const label = isTaken
          ? `${AVATAR_LABELS[id]} (taken)`
          : AVATAR_LABELS[id];
        return (
          <button
            key={id}
            type="button"
            role="option"
            aria-selected={selected}
            aria-disabled={isTaken}
            aria-label={label}
            title={label}
            disabled={isTaken}
            onClick={() => {
              if (!isTaken) onChange(id);
            }}
            style={{
              appearance: 'none',
              border: selected
                ? '2px solid var(--teal)'
                : '2px solid transparent',
              background: selected ? 'var(--teal-soft)' : 'var(--bg-elevated)',
              borderRadius: 12,
              padding: 6,
              cursor: isTaken ? 'not-allowed' : 'pointer',
              opacity: isTaken ? 0.35 : 1,
              filter: isTaken ? 'grayscale(0.7)' : 'none',
              boxShadow: selected ? '0 0 0 1px var(--teal)' : 'none',
              transition:
                'border-color 120ms, opacity 120ms, box-shadow 120ms, filter 120ms',
            }}
          >
            <TeamAvatar avatarId={id} size={48} style={{ margin: '0 auto' }} />
          </button>
        );
      })}
    </div>
  );
}
