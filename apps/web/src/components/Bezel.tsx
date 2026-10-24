import type { ReactNode, CSSProperties } from 'react';

export function Bezel({
  children,
  style,
  className = '',
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={`bezel-shell ${className}`}
      style={{
        padding: '0.375rem',
        borderRadius: 'var(--radius-shell)',
        background: 'rgba(18,20,23,0.04)',
        boxShadow: 'inset 0 0 0 1px var(--hairline)',
        ...style,
      }}
    >
      <div
        className="bezel-core"
        style={{
          borderRadius: 'var(--radius-core)',
          background: 'var(--bg-elevated)',
          boxShadow:
            'inset 0 1px 1px rgba(255,255,255,0.7), var(--shadow-ambient)',
          padding: '1.25rem',
        }}
      >
        {children}
      </div>
    </div>
  );
}
