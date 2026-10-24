import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bezel } from '../../components/Bezel';
import { Button } from '../../components/Button';
import { api, getToken } from '../../lib/api';
import { eventStateLabel } from '../../lib/eventStateLabel';

interface Series {
  id: string;
  name: string;
  description?: string;
}

interface EventRow {
  id: string;
  name: string;
  code: string;
  state: string;
}

export function HostHome() {
  const nav = useNavigate();
  const [series, setSeries] = useState<Series[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [eventName, setEventName] = useState('');
  const [seriesName, setSeriesName] = useState('');
  const [showSeriesForm, setShowSeriesForm] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getToken('host')) {
      nav('/host/login');
      return;
    }
    void load();
  }, [nav]);

  async function load() {
    setError('');
    try {
      const res = await api<{ series: Series[] }>('/api/host/series', {
        auth: 'host',
      });
      setSeries(res.series);
      const first = res.series[0];
      if (first) {
        setSelected((prev) => prev ?? first.id);
        const id = selected && res.series.some((s) => s.id === selected)
          ? selected
          : first.id;
        setSelected(id);
        const ev = await api<{ events: EventRow[] }>(
          `/api/host/series/${id}/events`,
          { auth: 'host' },
        );
        setEvents(ev.events);
      } else {
        setEvents([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load console');
      if (String(err).includes('Unauthorized')) {
        nav('/host/login');
      }
    }
  }

  async function createSeries(e: FormEvent) {
    e.preventDefault();
    const n = seriesName.trim();
    if (!n) {
      setError('Enter a series name');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api<{ series: Series }>('/api/host/series', {
        method: 'POST',
        auth: 'host',
        body: JSON.stringify({ name: n }),
      });
      setSeriesName('');
      setShowSeriesForm(false);
      setSelected(res.series.id);
      await load();
      setSelected(res.series.id);
      const ev = await api<{ events: EventRow[] }>(
        `/api/host/series/${res.series.id}/events`,
        { auth: 'host' },
      );
      setEvents(ev.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create series');
    } finally {
      setBusy(false);
    }
  }

  async function createEvent() {
    if (!selected || !eventName.trim()) {
      setError('Select a series and enter an event name');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api<{ event: EventRow }>(
        `/api/host/series/${selected}/events`,
        {
          method: 'POST',
          auth: 'host',
          body: JSON.stringify({ name: eventName.trim() }),
        },
      );
      nav(`/host/events/${res.event.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create event');
      setBusy(false);
    }
  }

  async function selectSeries(id: string) {
    setSelected(id);
    setError('');
    try {
      const ev = await api<{ events: EventRow[] }>(
        `/api/host/series/${id}/events`,
        { auth: 'host' },
      );
      setEvents(ev.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    }
  }

  return (
    <main style={{ padding: '2rem clamp(1rem,4vw,3rem)', maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
            Host console
          </p>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.75rem', margin: '0.25rem 0 0' }}>
            Quizzical
          </h1>
        </div>
        <Button
          variant="ghost"
          type="button"
          onClick={() => {
            setShowSeriesForm((v) => !v);
            setError('');
          }}
        >
          {showSeriesForm ? 'Cancel' : 'New series'}
        </Button>
      </header>

      {error ? (
        <p style={{ color: 'var(--coral)', marginTop: 0 }} role="alert">
          {error}
        </p>
      ) : null}

      {showSeriesForm ? (
        <Bezel style={{ marginBottom: 24 }}>
          <form onSubmit={createSeries} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <input
              placeholder="Series name"
              value={seriesName}
              onChange={(e) => setSeriesName(e.target.value)}
              autoFocus
              style={{
                flex: 1,
                minWidth: 220,
                padding: '0.75rem 1rem',
                borderRadius: 12,
                border: '1px solid var(--hairline)',
              }}
            />
            <Button type="submit" disabled={busy} withArrow>
              Create series
            </Button>
          </form>
        </Bezel>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr)',
          gap: 24,
        }}
        className="host-grid"
      >
        <Bezel>
          <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Series</h2>
          {series.length === 0 ? (
            <p style={{ color: 'var(--ink-muted)', margin: 0 }}>
              No series yet — create one to get started.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {series.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => void selectSeries(s.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.85rem 1rem',
                      borderRadius: 12,
                      border: '1px solid var(--hairline)',
                      background: selected === s.id ? 'var(--teal-soft)' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    {s.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Bezel>

        <Bezel>
          <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Events</h2>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <input
              placeholder="New event name"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              style={{
                flex: 1,
                minWidth: 180,
                padding: '0.75rem 1rem',
                borderRadius: 12,
                border: '1px solid var(--hairline)',
              }}
            />
            <Button type="button" onClick={() => void createEvent()} disabled={busy || !selected}>
              Create
            </Button>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
            {events.map((e) => (
              <li key={e.id}>
                <Link
                  to={`/host/events/${e.id}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '1rem',
                    borderRadius: 14,
                    border: '1px solid var(--hairline)',
                  }}
                >
                  <span>
                    <strong>{e.name}</strong>
                    <span style={{ color: 'var(--ink-muted)', marginLeft: 8 }}>
                      {e.code}
                    </span>
                  </span>
                  <span style={{ color: 'var(--teal)', fontSize: 13 }}>
                    {eventStateLabel(e.state)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Bezel>
      </div>
      <style>{`
        @media (max-width: 768px) {
          .host-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </main>
  );
}
