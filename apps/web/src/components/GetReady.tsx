import type { CSSProperties } from 'react';

export function GetReady({
  sectionTitle,
  topicImageUrls,
  hint,
  compact = false,
}: {
  sectionTitle?: string | null;
  /** Prefetched at section create — local /media URLs */
  topicImageUrls?: string[] | null;
  /** Optional context only — omit when it would repeat “Get ready” */
  hint?: string | null;
  /** Phone-sized layout (team play) */
  compact?: boolean;
}) {
  // Must match grid-template-areas tile count (wall: 9, compact: 6)
  const slotCount = compact ? 6 : 9;
  const images = fillSlots(uniqueUrls(topicImageUrls), slotCount);
  const showHint = Boolean(hint?.trim());
  const usePlaceholders = images.length === 0;

  return (
    <section
      className="stage-enter get-ready"
      style={{
        ...stage,
        ...(compact
          ? { minHeight: '52dvh', width: '100%', position: 'relative' }
          : {
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              maxHeight: '100dvh',
              minHeight: '100dvh',
            }),
      }}
      aria-live="polite"
      aria-label={`Get ready for ${sectionTitle ?? 'the next section'}`}
    >
      <div
        className={compact ? 'get-ready-mosaic compact' : 'get-ready-mosaic'}
        aria-hidden
      >
        {usePlaceholders
          ? Array.from({ length: slotCount }, (_, i) => (
              <div
                key={`ph-${i}`}
                className="get-ready-tile placeholder"
                style={{
                  animationDelay: `${50 + i * 55}ms`,
                  background: PLACEHOLDER_COLORS[i % PLACEHOLDER_COLORS.length],
                }}
              />
            ))
          : images.map((src, i) => (
              <div
                key={`${src}-${i}`}
                className="get-ready-tile"
                style={{ animationDelay: `${50 + i * 55}ms` }}
              >
                <img
                  src={src}
                  alt=""
                  onError={(e) => {
                    (
                      e.currentTarget.parentElement as HTMLElement | null
                    )?.classList.add('broken');
                  }}
                />
              </div>
            ))}
      </div>
      <div className="get-ready-veil" aria-hidden />

      <div className={`get-ready-copy${compact ? ' compact' : ''}`}>
        <p className="get-ready-kicker">Get ready</p>
        <h1
          className="get-ready-title"
          style={{
            fontSize: compact
              ? 'clamp(1.85rem, 8vw, 2.6rem)'
              : 'clamp(2.75rem, 6.5vw, 5rem)',
          }}
        >
          {sectionTitle?.trim() || 'Next section'}
        </h1>
        {showHint ? (
          <p
            className="get-ready-hint"
            style={{
              fontSize: compact
                ? 'clamp(0.95rem, 3.5vw, 1.1rem)'
                : 'clamp(1.05rem, 2vw, 1.35rem)',
            }}
          >
            {hint}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function uniqueUrls(urls?: string[] | null): string[] {
  if (!urls?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

/** Repeat unique URLs so every mosaic cell has an image. */
function fillSlots(urls: string[], count: number): string[] {
  if (!urls.length || count <= 0) return [];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(urls[i % urls.length]!);
  }
  return out;
}

const PLACEHOLDER_COLORS = [
  'linear-gradient(145deg, #0d9488 0%, #134e4a 100%)',
  'linear-gradient(145deg, #0369a1 0%, #0c4a6e 100%)',
  'linear-gradient(145deg, #b45309 0%, #78350f 100%)',
  'linear-gradient(145deg, #be123c 0%, #881337 100%)',
  'linear-gradient(145deg, #4f46e5 0%, #312e81 100%)',
  'linear-gradient(145deg, #15803d 0%, #14532d 100%)',
  'linear-gradient(145deg, #a16207 0%, #713f12 100%)',
  'linear-gradient(145deg, #0e7490 0%, #164e63 100%)',
  'linear-gradient(145deg, #c2410c 0%, #7c2d12 100%)',
];

const stage: CSSProperties = {
  minHeight: '100dvh',
  display: 'grid',
  placeContent: 'center',
  textAlign: 'center',
  position: 'relative',
  overflow: 'hidden',
};
