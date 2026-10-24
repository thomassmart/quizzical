import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ArrowUpRight } from '@phosphor-icons/react';

export function Button({
  children,
  variant = 'primary',
  withArrow,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
  withArrow?: boolean;
  children: ReactNode;
}) {
  const bg =
    variant === 'primary'
      ? 'var(--ink)'
      : variant === 'danger'
        ? 'var(--coral)'
        : 'transparent';
  const color =
    variant === 'ghost' ? 'var(--ink)' : '#fff';
  const {
    style: restStyle,
    onMouseDown,
    onMouseUp,
    onMouseLeave,
    type = 'button',
    ...buttonProps
  } = rest;

  return (
    <button
      type={type}
      {...buttonProps}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: withArrow ? '0.65rem' : '0.5rem',
        minHeight: 44,
        padding: withArrow ? '0.5rem 0.5rem 0.5rem 1.15rem' : '0.5rem 1.15rem',
        borderRadius: 'var(--radius-cta)',
        border:
          variant === 'ghost' ? '1px solid var(--hairline)' : '1px solid transparent',
        background: bg,
        color,
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        opacity: rest.disabled ? 0.45 : 1,
        transition: 'transform 400ms var(--ease-spring), opacity 400ms var(--ease-spring)',
        fontWeight: 600,
        fontSize: 14,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
        ...(restStyle as object),
      }}
      onMouseDown={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.98)';
        onMouseDown?.(e);
      }}
      onMouseUp={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
        onMouseUp?.(e);
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
        onMouseLeave?.(e);
      }}
    >
      <span>{children}</span>
      {withArrow ? (
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: '999px',
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(255,255,255,0.12)',
          }}
        >
          <ArrowUpRight size={16} weight="light" />
        </span>
      ) : null}
    </button>
  );
}
