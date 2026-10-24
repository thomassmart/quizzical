import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { api, getToken } from '../lib/api';
import { Button } from './Button';

type TopicImage = {
  index: number;
  mediaId: string;
  url: string;
  thumb: string;
  alt: string;
};

export function SectionTopicPhotos({
  sectionId,
  disabled = false,
}: {
  sectionId: string;
  disabled?: boolean;
}) {
  const [images, setImages] = useState<TopicImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const replaceIndexRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!getToken('host')) return;
    try {
      const res = await api<{ images: TopicImage[] }>(
        `/api/host/sections/${sectionId}/topic-images`,
        { auth: 'host' },
      );
      setImages(res.images ?? []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load photos');
    }
  }, [sectionId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function uploadFile(file: File): Promise<string> {
    const form = new FormData();
    form.append('file', file);
    const token = getToken('host');
    const res = await fetch('/api/host/media', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const body = (await res.json()) as {
      media?: { id: string };
      error?: string;
    };
    if (!res.ok || !body.media?.id) {
      throw new Error(body.error ?? 'Upload failed');
    }
    return body.media.id;
  }

  async function onFilePicked(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const mediaId = await uploadFile(file);
      const idx = replaceIndexRef.current;
      if (idx === null) {
        await api(`/api/host/sections/${sectionId}/topic-images`, {
          method: 'POST',
          auth: 'host',
          body: JSON.stringify({ mediaId, alt: file.name }),
        });
      } else {
        await api(`/api/host/sections/${sectionId}/topic-images/${idx}`, {
          method: 'PUT',
          auth: 'host',
          body: JSON.stringify({ mediaId, alt: file.name }),
        });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      replaceIndexRef.current = null;
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeAt(index: number) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/host/sections/${sectionId}/topic-images/${index}`, {
        method: 'DELETE',
        auth: 'host',
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError('');
    try {
      await api(`/api/host/sections/${sectionId}/topic-images/refresh`, {
        method: 'POST',
        auth: 'host',
        body: '{}',
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <Button
          variant="ghost"
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Hide section photos' : 'Section photos'}
        </Button>
        {open ? (
          <>
            <Button
              variant="ghost"
              type="button"
              disabled={busy || disabled}
              onClick={() => {
                replaceIndexRef.current = null;
                fileRef.current?.click();
              }}
            >
              Add photo
            </Button>
            <Button
              variant="ghost"
              type="button"
              disabled={busy || disabled}
              onClick={() => void refresh()}
            >
              Refresh from theme
            </Button>
          </>
        ) : null}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        hidden
        onChange={(e) => void onFilePicked(e.target.files?.[0])}
      />

      {open ? (
        <div style={{ marginTop: 12 }}>
          {error ? (
            <p style={{ color: 'var(--coral)', margin: '0 0 8px' }} role="alert">
              {error}
            </p>
          ) : null}
          {images.length === 0 ? (
            <p style={{ color: 'var(--ink-muted)', margin: 0, fontSize: 13 }}>
              No photos yet — add some or refresh from the section theme.
            </p>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
                gap: 10,
              }}
            >
              {images.map((img) => (
                <div
                  key={`${img.mediaId}-${img.index}`}
                  style={{
                    border: '1px solid var(--hairline)',
                    borderRadius: 12,
                    overflow: 'hidden',
                    background: 'var(--bg-0)',
                  }}
                >
                  <img
                    src={img.thumb || img.url}
                    alt={img.alt || ''}
                    style={{
                      display: 'block',
                      width: '100%',
                      aspectRatio: '4 / 3',
                      objectFit: 'cover',
                    }}
                  />
                  <div
                    style={{
                      display: 'flex',
                      gap: 4,
                      padding: 6,
                      justifyContent: 'center',
                    }}
                  >
                    <button
                      type="button"
                      disabled={busy || disabled}
                      onClick={() => {
                        replaceIndexRef.current = img.index;
                        fileRef.current?.click();
                      }}
                      style={miniBtn}
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      disabled={busy || disabled}
                      onClick={() => void removeAt(img.index)}
                      style={miniBtn}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p
            style={{
              margin: '10px 0 0',
              fontSize: 12,
              color: 'var(--ink-muted)',
            }}
          >
            These photos appear on the wall Get Ready screen for this section.
          </p>
        </div>
      ) : null}
    </div>
  );
}

const miniBtn: CSSProperties = {
  fontSize: 11,
  padding: '4px 6px',
  borderRadius: 8,
  border: '1px solid var(--hairline)',
  background: 'transparent',
  color: 'var(--ink)',
  cursor: 'pointer',
};
