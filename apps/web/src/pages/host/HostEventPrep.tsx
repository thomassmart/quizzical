import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Bezel } from '../../components/Bezel';
import { Button } from '../../components/Button';
import {
  QuestionEditor,
  type HostQuestion,
} from '../../components/QuestionEditor';
import { SectionTopicPhotos } from '../../components/SectionTopicPhotos';
import { api, getToken } from '../../lib/api';
import { eventStateLabel } from '../../lib/eventStateLabel';

type PrepData = {
  event: {
    id: string;
    name: string;
    code: string;
    state: string;
    wallboard_token: string;
  };
  sections: {
    id: string;
    title: string;
    theme: string;
    difficulty: string;
    auto_open_answers?: boolean;
    is_demo?: boolean;
  }[];
  questions: HostQuestion[];
};

type SectionSuggestion = {
  title: string;
  theme: string;
  difficulty: 'easy' | 'medium' | 'hard';
  blurb: string;
};

export function HostEventPrep() {
  const { eventId } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<PrepData | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [restartArmed, setRestartArmed] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const [testArmed, setTestArmed] = useState(false);
  const [showSectionForm, setShowSectionForm] = useState(false);
  const [sectionTitle, setSectionTitle] = useState('');
  const [sectionDifficulty, setSectionDifficulty] = useState<
    'easy' | 'medium' | 'hard'
  >('medium');
  const [sectionAutoOpen, setSectionAutoOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<SectionSuggestion[]>([]);
  const [suggestionsNote, setSuggestionsNote] = useState('');
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [manualForSection, setManualForSection] = useState<string | null>(null);
  const [manualWording, setManualWording] = useState('');
  const [manualAnswer, setManualAnswer] = useState('');
  const [expandedDismissed, setExpandedDismissed] = useState<
    Record<string, boolean>
  >({});
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDifficulty, setEditDifficulty] = useState<
    'easy' | 'medium' | 'hard'
  >('medium');
  const [editAutoOpen, setEditAutoOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    if (!getToken('host')) {
      nav('/host/login');
      return;
    }
    try {
      const res = await api<PrepData>(`/api/host/events/${eventId}`, {
        auth: 'host',
      });
      setData(res);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load event');
      if (String(err).includes('Unauthorized')) nav('/host/login');
    }
  }, [eventId, nav]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadSuggestions = useCallback(async () => {
    if (!eventId) return;
    setSuggestionsLoading(true);
    setSuggestionsNote('');
    try {
      const res = await api<{
        suggestions: SectionSuggestion[];
        note?: string;
        source?: string;
      }>(`/api/host/events/${eventId}/section-suggestions`, { auth: 'host' });
      setSuggestions(res.suggestions ?? []);
      setSuggestionsNote(
        res.note ??
          (res.source === 'llm'
            ? 'AI suggestions for this event'
            : 'Starter themes'),
      );
    } catch (err) {
      setSuggestions([]);
      setSuggestionsNote(
        err instanceof Error ? err.message : 'Could not load suggestions',
      );
    } finally {
      setSuggestionsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (showSectionForm) void loadSuggestions();
  }, [showSectionForm, loadSuggestions]);

  async function addSection(e: FormEvent) {
    e.preventDefault();
    const title = sectionTitle.trim();
    if (!title) {
      setError('Enter a section title');
      return;
    }
    setBusy(true);
    setError('');
    setMsg('Creating section and proposing questions…');
    try {
      const res = await api<{ note?: string | null }>(
        `/api/host/events/${eventId}/sections`,
        {
          method: 'POST',
          auth: 'host',
          body: JSON.stringify({
            title,
            theme: title,
            questionCountTarget: 5,
            difficulty: sectionDifficulty,
            autoOpenAnswers: sectionAutoOpen,
          }),
        },
      );
      setSectionTitle('');
      setSectionDifficulty('medium');
      setSectionAutoOpen(false);
      setShowSectionForm(false);
      setMsg(res.note ?? `Section “${title}” added`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add section');
      setMsg('');
    } finally {
      setBusy(false);
    }
  }

  async function createFromSuggestion(s: SectionSuggestion) {
    setBusy(true);
    setError('');
    setMsg('Creating section and proposing questions…');
    try {
      const res = await api<{ note?: string | null }>(
        `/api/host/events/${eventId}/sections`,
        {
          method: 'POST',
          auth: 'host',
          body: JSON.stringify({
            title: s.title,
            theme: s.theme,
            questionCountTarget: 5,
            difficulty: s.difficulty,
            autoOpenAnswers: sectionAutoOpen,
          }),
        },
      );
      setShowSectionForm(false);
      setSectionTitle('');
      setSectionAutoOpen(false);
      setMsg(res.note ?? `Section “${s.title}” added`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add section');
      setMsg('');
    } finally {
      setBusy(false);
    }
  }

  async function addManualQuestion(e: FormEvent) {
    e.preventDefault();
    if (!manualForSection) return;
    const wording = manualWording.trim();
    const answer = manualAnswer.trim();
    if (!wording || !answer) {
      setError('Question wording and answer are required');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/api/host/sections/${manualForSection}/questions`, {
        method: 'POST',
        auth: 'host',
        body: JSON.stringify({
          format: 'short_answer',
          wording,
          answerSpec: {
            format: 'short_answer',
            data: { acceptedAnswers: [answer] },
          },
          rubric: answer,
          approve: true,
        }),
      });
      setManualForSection(null);
      setManualWording('');
      setManualAnswer('');
      setMsg('Question added');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add question');
    } finally {
      setBusy(false);
    }
  }

  async function generate(sectionId: string) {
    setMsg('Generating…');
    setError('');
    setBusy(true);
    try {
      const res = await api<{ note: string }>(
        `/api/host/sections/${sectionId}/generate`,
        { method: 'POST', auth: 'host', body: '{}' },
      );
      setMsg(res.note);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generate failed');
      setMsg('');
    } finally {
      setBusy(false);
    }
  }

  function startEditSection(s: {
    id: string;
    title: string;
    difficulty: string;
    auto_open_answers?: boolean;
  }) {
    setEditingSectionId(s.id);
    setEditTitle(s.title);
    setEditDifficulty(
      (s.difficulty as 'easy' | 'medium' | 'hard') || 'medium',
    );
    setEditAutoOpen(Boolean(s.auto_open_answers));
    setError('');
  }

  async function saveSection(e: FormEvent) {
    e.preventDefault();
    if (!editingSectionId) return;
    const title = editTitle.trim();
    if (!title) {
      setError('Section title is required');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/api/host/sections/${editingSectionId}`, {
        method: 'PATCH',
        auth: 'host',
        body: JSON.stringify({
          title,
          theme: title,
          difficulty: editDifficulty,
          autoOpenAnswers: editAutoOpen,
        }),
      });
      setEditingSectionId(null);
      setMsg(`Section “${title}” updated`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update section');
    } finally {
      setBusy(false);
    }
  }

  async function deleteSection(sectionId: string, title: string) {
    if (
      !confirm(
        `Delete section “${title}”? Questions will be unlinked from this section.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/api/host/sections/${sectionId}`, {
        method: 'DELETE',
        auth: 'host',
      });
      setMsg(`Section “${title}” deleted`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete section');
    } finally {
      setBusy(false);
    }
  }

  async function approve(qid: string) {
    setError('');
    try {
      await api(`/api/host/questions/${qid}/approve`, {
        method: 'POST',
        auth: 'host',
        body: '{}',
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    }
  }

  async function dismiss(qid: string) {
    setError('');
    try {
      await api(`/api/host/questions/${qid}/dismiss`, {
        method: 'POST',
        auth: 'host',
        body: '{}',
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dismiss failed');
    }
  }

  async function restartNight() {
    setBusy(true);
    setError('');
    setMsg('');
    setRestartArmed(false);
    try {
      await api(`/api/host/events/${eventId}/restart`, {
        method: 'POST',
        auth: 'host',
        body: '{}',
      });
      setMsg('Night restarted — teams kept, scores cleared. Open Live console when ready.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restart failed');
    } finally {
      setBusy(false);
    }
  }

  /** Wipe teams + scores; keep questions/sections for a clean live run. */
  async function resetForLive() {
    setBusy(true);
    setError('');
    setMsg('');
    setResetArmed(false);
    try {
      await api(`/api/host/events/${eventId}/reset`, {
        method: 'POST',
        auth: 'host',
        body: '{}',
      });
      setMsg('Event reset — teams and scores cleared. Questions kept. Ready for the live run.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  /** Solo run — no teams needed. Opens wall + live console on practice. */
  async function runTestNight() {
    if (!eventId || !data) return;
    setBusy(true);
    setError('');
    setMsg('');
    setTestArmed(false);
    try {
      await api(`/api/host/events/${eventId}/test`, {
        method: 'POST',
        auth: 'host',
        body: '{}',
      });
      window.open(
        `/wall/${data.event.code}?token=${data.event.wallboard_token}`,
        '_blank',
        'noopener,noreferrer',
      );
      setMsg(
        'Test run started — practice is live. Mid-night Test restarts first (teams kept).',
      );
      nav(`/host/events/${eventId}/live`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test run failed');
    } finally {
      setBusy(false);
    }
  }

  async function downloadJson() {
    if (!eventId || !data) return;
    setBusy(true);
    setError('');
    try {
      const pack = await api<Record<string, unknown>>(
        `/api/host/events/${eventId}/export`,
        { auth: 'host' },
      );
      const blob = new Blob([JSON.stringify(pack, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const slug = data.event.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      a.href = url;
      a.download = `${slug || 'event'}-${data.event.code}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg('Downloaded question dictionary JSON');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setBusy(false);
    }
  }

  async function importQuestionsFile(file: File) {
    setBusy(true);
    setError('');
    setMsg('Importing questions…');
    try {
      const text = await file.text();
      let pack: unknown;
      try {
        pack = JSON.parse(text);
      } catch {
        throw new Error('File is not valid JSON');
      }
      const res = await api<{
        note?: string;
        questionsCreated?: number;
        errors?: string[];
      }>(`/api/host/events/${eventId}/import`, {
        method: 'POST',
        auth: 'host',
        body: JSON.stringify({ pack, approve: true }),
      });
      setMsg(res.note ?? 'Import complete');
      if (res.errors?.length) {
        setError(res.errors.slice(0, 3).join(' · '));
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setMsg('');
    } finally {
      setBusy(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  if (!data) {
    return (
      <main style={{ padding: 32 }}>
        {error ? <p style={{ color: 'var(--coral)' }}>{error}</p> : 'Loading…'}
      </main>
    );
  }

  return (
    <main style={{ padding: '2rem clamp(1rem,4vw,3rem)', maxWidth: 1100, margin: '0 auto' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '1.25rem 1.5rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0, flex: '1 1 240px' }}>
          <Link
            to="/host"
            style={{
              color: 'var(--ink-muted)',
              fontSize: 14,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              lineHeight: 1.3,
            }}
          >
            ← Series
          </Link>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              margin: '0.75rem 0 0.4rem',
              fontSize: 'clamp(1.75rem, 4vw, 2.35rem)',
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
            }}
          >
            {data.event.name}
          </h1>
          <p
            style={{
              margin: 0,
              color: 'var(--ink-muted)',
              fontSize: 14,
              lineHeight: 1.4,
            }}
          >
            Code <strong style={{ color: 'var(--ink)' }}>{data.event.code}</strong>{' '}
            · {eventStateLabel(data.event.state)}
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            alignItems: 'flex-end',
            flex: '1 1 auto',
            minWidth: 0,
          }}
        >
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importQuestionsFile(file);
            }}
          />
          <div style={prepBtnRow}>
            <Button
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                setShowSectionForm((v) => !v);
                setError('');
              }}
            >
              {showSectionForm ? 'Cancel' : 'Add section'}
            </Button>
            <Button
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => importInputRef.current?.click()}
            >
              Import
            </Button>
            <Button
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => void downloadJson()}
            >
              Download JSON
            </Button>
            <Button
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() =>
                window.open(
                  `/wall/${data.event.code}?token=${data.event.wallboard_token}`,
                  '_blank',
                  'noopener,noreferrer',
                )
              }
            >
              Preview wall
            </Button>
          </div>
          <div style={prepBtnRow}>
            <Button
              withArrow
              type="button"
              onClick={() => nav(`/host/events/${eventId}/live`)}
            >
              Live console
            </Button>
            {testArmed ? (
              <>
                <Button
                  variant="danger"
                  type="button"
                  disabled={busy}
                  onClick={() => void runTestNight()}
                  title="Solo practice; mid-night Test restarts first (teams kept)"
                >
                  Confirm test run
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => setTestArmed(false)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                type="button"
                disabled={busy || restartArmed || resetArmed}
                onClick={() => {
                  setRestartArmed(false);
                  setResetArmed(false);
                  setTestArmed(true);
                }}
                title="Solo practice on the wall — confirms before starting"
              >
                Test
              </Button>
            )}
          </div>
          <div style={prepBtnRow}>
            {restartArmed ? (
              <>
                <Button
                  variant="danger"
                  type="button"
                  disabled={busy}
                  onClick={() => void restartNight()}
                >
                  Confirm restart
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => setRestartArmed(false)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                type="button"
                disabled={busy || resetArmed || testArmed}
                onClick={() => {
                  setResetArmed(false);
                  setTestArmed(false);
                  setRestartArmed(true);
                }}
                title="Clear scores; keep teams → lobby"
              >
                Restart
              </Button>
            )}
            {resetArmed ? (
              <>
                <Button
                  variant="danger"
                  type="button"
                  disabled={busy}
                  onClick={() => void resetForLive()}
                >
                  Confirm reset
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => setResetArmed(false)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                type="button"
                disabled={busy || restartArmed || testArmed}
                onClick={() => {
                  setRestartArmed(false);
                  setTestArmed(false);
                  setResetArmed(true);
                }}
                title="Clear teams and scores; keep questions → Prep"
              >
                Reset
              </Button>
            )}
          </div>
        </div>
      </header>

      {error ? (
        <p
          style={{ marginTop: 20, marginBottom: 0, color: 'var(--coral)' }}
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {msg ? (
        <p style={{ marginTop: 20, marginBottom: 0, color: 'var(--teal)' }}>
          {msg}
        </p>
      ) : null}

      {showSectionForm ? (
        <Bezel style={{ marginTop: 20 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-muted)',
                }}
              >
                AI suggested themes
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-muted)' }}>
                {suggestionsLoading
                  ? 'Asking the model…'
                  : suggestionsNote || 'Pick one or type your own'}
              </p>
            </div>
            <Button
              variant="ghost"
              type="button"
              disabled={suggestionsLoading || busy}
              onClick={() => void loadSuggestions()}
            >
              Refresh
            </Button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 10,
              marginBottom: 18,
            }}
          >
            {suggestions.map((s) => (
              <button
                key={`${s.title}-${s.difficulty}`}
                type="button"
                disabled={busy}
                onClick={() => void createFromSuggestion(s)}
                onMouseEnter={() => {
                  setSectionTitle(s.title);
                  setSectionDifficulty(s.difficulty);
                }}
                style={{
                  textAlign: 'left',
                  padding: '0.9rem 1rem',
                  borderRadius: 14,
                  border: '1px solid var(--hairline)',
                  background:
                    sectionTitle === s.title ? 'var(--teal-soft)' : 'var(--bg-0)',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  transition:
                    'transform 400ms var(--ease-spring), background 400ms var(--ease-spring)',
                }}
              >
                <div style={{ fontWeight: 650 }}>{s.title}</div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--ink-muted)',
                    marginTop: 4,
                    textTransform: 'capitalize',
                  }}
                >
                  {s.difficulty}
                </div>
                <div style={{ fontSize: 13, marginTop: 6, color: 'var(--ink)' }}>
                  {s.blurb}
                </div>
              </button>
            ))}
          </div>

          <form
            onSubmit={addSection}
            style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}
          >
            <input
              placeholder="Section title / theme"
              value={sectionTitle}
              onChange={(e) => setSectionTitle(e.target.value)}
              autoFocus
              style={{
                flex: 1,
                minWidth: 220,
                padding: '0.75rem 1rem',
                borderRadius: 12,
                border: '1px solid var(--hairline)',
              }}
            />
            <select
              value={sectionDifficulty}
              onChange={(e) =>
                setSectionDifficulty(
                  e.target.value as 'easy' | 'medium' | 'hard',
                )
              }
              style={{
                padding: '0.75rem 1rem',
                borderRadius: 12,
                border: '1px solid var(--hairline)',
                background: 'var(--bg-0)',
              }}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
            <label
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={sectionAutoOpen}
                onChange={(e) => setSectionAutoOpen(e.target.checked)}
              />
              Auto-open answers
            </label>
            <Button type="submit" disabled={busy} withArrow>
              Create section
            </Button>
          </form>
        </Bezel>
      ) : null}

      <div style={{ display: 'grid', gap: 20, marginTop: 28 }}>
        {data.sections.length === 0 ? (
          <p style={{ color: 'var(--ink-muted)' }}>
            No sections yet — use Add section to create the first one.
          </p>
        ) : null}
        {data.sections.map((s) => {
          const sectionQuestions = data.questions.filter(
            (q) => q.section_id === s.id,
          );
          const activeQuestions = sectionQuestions.filter(
            (q) => q.status !== 'dismissed',
          );
          const dismissedQuestions = sectionQuestions.filter(
            (q) => q.status === 'dismissed',
          );
          const dismissedOpen = Boolean(expandedDismissed[s.id]);

          return (
            <Bezel key={s.id}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ flex: 1, minWidth: 200 }}>
                  {editingSectionId === s.id ? (
                    <form
                      onSubmit={saveSection}
                      style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                    >
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        style={{ ...inputStyle, flex: 1, minWidth: 180 }}
                        autoFocus
                      />
                      <select
                        value={editDifficulty}
                        onChange={(e) =>
                          setEditDifficulty(
                            e.target.value as 'easy' | 'medium' | 'hard',
                          )
                        }
                        style={{
                          padding: '0.75rem 1rem',
                          borderRadius: 12,
                          border: '1px solid var(--hairline)',
                          background: 'var(--bg-0)',
                        }}
                      >
                        <option value="easy">Easy</option>
                        <option value="medium">Medium</option>
                        <option value="hard">Hard</option>
                      </select>
                      <label
                        style={{
                          display: 'flex',
                          gap: 8,
                          alignItems: 'center',
                          fontSize: 13,
                          width: '100%',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={editAutoOpen}
                          onChange={(e) => setEditAutoOpen(e.target.checked)}
                        />
                        Auto-open answers when question appears
                      </label>
                      <Button type="submit" disabled={busy}>
                        Save
                      </Button>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => setEditingSectionId(null)}
                      >
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <>
                      <h2
                        style={{
                          margin: 0,
                          fontFamily: 'var(--font-display)',
                        }}
                      >
                        {s.title}
                        {s.is_demo ? ' · Practice' : ''}
                      </h2>
                      <p
                        style={{
                          margin: '4px 0 0',
                          color: 'var(--ink-muted)',
                          fontSize: 14,
                        }}
                      >
                        {s.is_demo
                          ? 'Auto-added · every answer type · scores do not count'
                          : `${s.theme} · ${s.difficulty}${
                              s.auto_open_answers ? ' · auto-open answers' : ''
                            }`}
                      </p>
                      {!s.is_demo ? (
                        <SectionTopicPhotos
                          sectionId={s.id}
                          disabled={busy}
                        />
                      ) : null}
                    </>
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                    alignItems: 'center',
                  }}
                >
                  {!s.is_demo && editingSectionId !== s.id ? (
                    <>
                      <Button
                        variant="ghost"
                        type="button"
                        disabled={busy}
                        onClick={() => startEditSection(s)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        type="button"
                        disabled={busy}
                        onClick={() => void deleteSection(s.id, s.title)}
                      >
                        Delete
                      </Button>
                    </>
                  ) : null}
                  {!s.is_demo ? (
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setManualForSection(
                        manualForSection === s.id ? null : s.id,
                      );
                      setError('');
                    }}
                  >
                    Manual Q
                  </Button>
                  ) : null}
                  {!s.is_demo ? (
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => void generate(s.id)}
                    >
                      LLM propose
                    </Button>
                  ) : null}
                </div>
              </div>

              {manualForSection === s.id ? (
                <form
                  onSubmit={addManualQuestion}
                  style={{ display: 'grid', gap: 10, marginTop: 16 }}
                >
                  <input
                    placeholder="Question wording"
                    value={manualWording}
                    onChange={(e) => setManualWording(e.target.value)}
                    style={inputStyle}
                    autoFocus
                  />
                  <input
                    placeholder="Accepted short answer"
                    value={manualAnswer}
                    onChange={(e) => setManualAnswer(e.target.value)}
                    style={inputStyle}
                  />
                  <div>
                    <Button type="submit" disabled={busy} withArrow>
                      Save question
                    </Button>
                  </div>
                </form>
              ) : null}

              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: '16px 0 0',
                  display: 'grid',
                  gap: 8,
                }}
              >
                {activeQuestions.map((q) => (
                  <QuestionEditor
                    key={q.id}
                    question={q}
                    busy={busy}
                    onSaved={load}
                    onApprove={() => approve(q.id)}
                    onDismiss={() => dismiss(q.id)}
                  />
                ))}
              </ul>

              {dismissedQuestions.length > 0 ? (
                <div style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedDismissed((prev) => ({
                        ...prev,
                        [s.id]: !prev[s.id],
                      }))
                    }
                    style={{
                      width: '100%',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.75rem 1rem',
                      borderRadius: 12,
                      border: '1px solid var(--hairline)',
                      background: 'rgba(18,20,23,0.03)',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: 13,
                      color: 'var(--ink-muted)',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}
                    aria-expanded={dismissedOpen}
                  >
                    <span>Dismissed ({dismissedQuestions.length})</span>
                    <span aria-hidden>{dismissedOpen ? '−' : '+'}</span>
                  </button>
                  {dismissedOpen ? (
                    <ul
                      style={{
                        listStyle: 'none',
                        padding: 0,
                        margin: '8px 0 0',
                        display: 'grid',
                        gap: 8,
                      }}
                    >
                      {dismissedQuestions.map((q) => (
                        <QuestionEditor
                          key={q.id}
                          question={q}
                          busy={busy}
                          onSaved={load}
                          onApprove={() => approve(q.id)}
                          onDismiss={() => dismiss(q.id)}
                        />
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </Bezel>
          );
        })}
      </div>
    </main>
  );
}

const inputStyle = {
  padding: '0.75rem 1rem',
  borderRadius: 12,
  border: '1px solid var(--hairline)',
  width: '100%',
} as const;

const prepBtnRow = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'flex-end',
} as const;
