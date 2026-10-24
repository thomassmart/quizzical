import { useMemo, useState, type CSSProperties } from 'react';
import { X } from '@phosphor-icons/react';
import { Button } from './Button';
import { api, getToken } from '../lib/api';
import { questionStatusLabel } from '../lib/questionStatusLabel';

export type HostQuestion = {
  id: string;
  section_id: string;
  format: string;
  wording: string;
  status: string;
  llm_proposed: boolean;
  answer_spec: unknown;
  rubric: string;
  difficulty: string;
  points: number;
  timing_seconds: number;
  source_references?: string[] | null;
  sources_verified?: boolean;
  media_image_id?: string | null;
  media_audio_id?: string | null;
  media_video_id?: string | null;
  host_notes?: string | null;
  reveal_fact?: string | null;
  reveal_image_id?: string | null;
};

type Props = {
  question: HostQuestion;
  busy?: boolean;
  onSaved: () => void | Promise<void>;
  onApprove: () => void | Promise<void>;
  onDismiss: () => void | Promise<void>;
};

function normalizeSpec(format: string, raw: unknown): Record<string, unknown> {
  const spec = (raw ?? {}) as { format?: string; data?: Record<string, unknown> };
  if (spec.data) return spec.data;
  // LLM sometimes returns flat answerSpec
  return (raw as Record<string, unknown>) ?? {};
}

function wrapSpec(format: string, data: Record<string, unknown>) {
  return { format, data };
}

export function QuestionEditor({
  question,
  busy,
  onSaved,
  onApprove,
  onDismiss,
}: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [wording, setWording] = useState(question.wording);
  const [rubric, setRubric] = useState(question.rubric ?? '');
  const [points, setPoints] = useState(question.points ?? 1);
  const [timingSeconds, setTimingSeconds] = useState(
    question.timing_seconds ?? 30,
  );
  const [difficulty, setDifficulty] = useState(question.difficulty ?? 'medium');
  const [hostNotes, setHostNotes] = useState(question.host_notes ?? '');
  const [revealFact, setRevealFact] = useState(question.reveal_fact ?? '');
  const [revealImageId, setRevealImageId] = useState(
    question.reveal_image_id ?? null,
  );
  const [sourcesVerified, setSourcesVerified] = useState(
    Boolean(question.sources_verified),
  );
  const [mediaImageId, setMediaImageId] = useState(
    question.media_image_id ?? null,
  );
  const [mediaAudioId, setMediaAudioId] = useState(
    question.media_audio_id ?? null,
  );
  const [mediaVideoId, setMediaVideoId] = useState(
    question.media_video_id ?? null,
  );
  const [uploading, setUploading] = useState<
    'image' | 'audio' | 'video' | 'reveal' | null
  >(null);

  const initialData = useMemo(
    () => normalizeSpec(question.format, question.answer_spec),
    [question.format, question.answer_spec],
  );

  const [mcOptions, setMcOptions] = useState(
    () =>
      (initialData.options as { id: string; label: string }[]) ?? [
        { id: 'a', label: '' },
        { id: 'b', label: '' },
      ],
  );
  const [mcCorrect, setMcCorrect] = useState(
    () => new Set((initialData.correctOptionIds as string[]) ?? []),
  );
  const [shortAnswers, setShortAnswers] = useState(() =>
    ((initialData.acceptedAnswers as string[]) ?? ['']).join('\n'),
  );
  const [orderItems, setOrderItems] = useState(
    () =>
      (initialData.items as { id: string; label: string }[]) ?? [
        { id: '1', label: '' },
      ],
  );
  const [orderCorrect, setOrderCorrect] = useState(() =>
    ((initialData.correctOrder as string[]) ?? []).join(', '),
  );
  const [matchLeft, setMatchLeft] = useState(
    () =>
      (initialData.left as { id: string; label: string }[]) ?? [
        { id: 'l1', label: '' },
      ],
  );
  const [matchRight, setMatchRight] = useState(
    () =>
      (initialData.right as { id: string; label: string }[]) ?? [
        { id: 'r1', label: '' },
      ],
  );
  const [matchPairs, setMatchPairs] = useState(() =>
    ((initialData.pairs as { leftId: string; rightId: string }[]) ?? [])
      .map((p) => `${p.leftId}=${p.rightId}`)
      .join('\n'),
  );

  const answerPreview = useMemo(
    () => summarizeAnswer(question.format, initialData),
    [question.format, initialData],
  );

  function buildAnswerSpec() {
    switch (question.format) {
      case 'multiple_choice':
        return wrapSpec('multiple_choice', {
          options: mcOptions,
          correctOptionIds: [...mcCorrect],
        });
      case 'short_answer':
        return wrapSpec('short_answer', {
          acceptedAnswers: shortAnswers
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
        });
      case 'ordered_list':
        return wrapSpec('ordered_list', {
          items: orderItems,
          correctOrder: orderCorrect
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        });
      case 'matching':
        return wrapSpec('matching', {
          left: matchLeft,
          right: matchRight,
          pairs: matchPairs
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
              const [leftId, rightId] = line.split('=').map((s) => s.trim());
              return { leftId, rightId };
            }),
        });
      default:
        return question.answer_spec;
    }
  }

  function matchingError(): string | null {
    if (question.format !== 'matching') return null;
    const leftIds = new Set(
      matchLeft.map((l) => l.id.trim()).filter(Boolean),
    );
    const rightIds = new Set(
      matchRight.map((r) => r.id.trim()).filter(Boolean),
    );
    if (!leftIds.size || !rightIds.size) {
      return 'Matching needs at least one left and one right item';
    }
    const pairs = matchPairs
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [leftId, rightId] = line.split('=').map((s) => s.trim());
        return { leftId, rightId };
      });
    if (!pairs.length) return 'Add at least one leftId=rightId pair';
    for (const p of pairs) {
      if (!p.leftId || !p.rightId) {
        return 'Each pair must look like leftId=rightId';
      }
      if (!leftIds.has(p.leftId) || !rightIds.has(p.rightId)) {
        return `Pair ${p.leftId}=${p.rightId} does not match left/right ids`;
      }
    }
    return null;
  }

  async function save() {
    setSaving(true);
    setError('');
    const matchErr = matchingError();
    if (matchErr) {
      setError(matchErr);
      setSaving(false);
      return;
    }
    try {
      await api(`/api/host/questions/${question.id}`, {
        method: 'PATCH',
        auth: 'host',
        body: JSON.stringify({
          wording,
          answerSpec: buildAnswerSpec(),
          rubric,
          points,
          timingSeconds,
          difficulty,
          hostNotes: hostNotes || null,
          revealFact: revealFact.trim() || null,
          revealImageId,
          sourcesVerified,
          mediaImageId,
          mediaAudioId,
          mediaVideoId,
          status:
            question.status === 'proposed' || question.status === 'draft'
              ? 'approved'
              : undefined,
        }),
      });
      await onSaved();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function upload(
    kind: 'image' | 'audio' | 'video' | 'reveal',
    file: File,
  ) {
    setUploading(kind);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const token = getToken('host');
      const res = await fetch('/api/host/media', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      if (kind === 'image') setMediaImageId(data.media.id);
      else if (kind === 'audio') setMediaAudioId(data.media.id);
      else if (kind === 'video') setMediaVideoId(data.media.id);
      else setRevealImageId(data.media.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(null);
    }
  }

  return (
    <li
      style={{
        padding: '0.85rem 1rem',
        borderRadius: 12,
        border: '1px solid var(--hairline)',
        display: 'grid',
        gap: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
            {question.format} · {questionStatusLabel(question.status)}
            {question.llm_proposed ? ' · AI' : ''}
            {' · '}
            {question.points} pt · {question.timing_seconds}s
          </div>
          <div style={{ marginTop: 4, fontWeight: 600 }}>{question.wording}</div>
          <div style={{ marginTop: 6, fontSize: 13, color: 'var(--ink-muted)' }}>
            Answer: {answerPreview}
          </div>
          {(question.media_image_id ||
            question.media_audio_id ||
            question.media_video_id) && (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--teal)' }}>
              {[
                question.media_image_id ? 'Picture' : null,
                question.media_video_id ? 'Video' : null,
                question.media_audio_id ? 'Music' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            variant="ghost"
            type="button"
            disabled={busy}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Close' : 'Edit'}
          </Button>
          {question.status === 'proposed' || question.status === 'draft' ? (
            <>
              <Button
                variant="ghost"
                type="button"
                disabled={busy}
                onClick={() => void onApprove()}
              >
                Approve
              </Button>
              <Button
                variant="danger"
                type="button"
                disabled={busy}
                onClick={() => void onDismiss()}
              >
                Dismiss
              </Button>
            </>
          ) : null}
          {question.status === 'dismissed' ? (
            <Button
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => void onApprove()}
            >
              Restore
            </Button>
          ) : null}
          {(question.status === 'approved' || question.status === 'reserved') && (
            <button
              type="button"
              aria-label="Dismiss"
              title="Dismiss"
              disabled={busy}
              onClick={() => void onDismiss()}
              style={{
                width: 32,
                height: 32,
                display: 'inline-grid',
                placeItems: 'center',
                borderRadius: 10,
                border: '1px solid var(--hairline)',
                background: 'transparent',
                color: 'var(--ink-muted)',
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.45 : 1,
                transition:
                  'color 400ms var(--ease-spring), background 400ms var(--ease-spring), transform 400ms var(--ease-spring)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--coral)';
                e.currentTarget.style.background = 'var(--coral-soft)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--ink-muted)';
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <X size={16} weight="light" />
            </button>
          )}
        </div>
      </div>

      {open ? (
        <div
          style={{
            display: 'grid',
            gap: 12,
            paddingTop: 8,
            borderTop: '1px solid var(--hairline)',
          }}
        >
          <label style={labelStyle}>
            Question wording
            <textarea
              value={wording}
              onChange={(e) => setWording(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </label>

          {question.format === 'multiple_choice' ? (
            <fieldset style={fieldsetStyle}>
              <legend style={legendStyle}>Choices (tick correct)</legend>
              {mcOptions.map((opt, idx) => (
                <div
                  key={opt.id}
                  style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                >
                  <input
                    type="checkbox"
                    checked={mcCorrect.has(opt.id)}
                    onChange={(e) => {
                      const next = new Set(mcCorrect);
                      if (e.target.checked) next.add(opt.id);
                      else next.delete(opt.id);
                      setMcCorrect(next);
                    }}
                  />
                  <span style={{ width: 20, color: 'var(--ink-muted)' }}>
                    {opt.id}
                  </span>
                  <input
                    value={opt.label}
                    onChange={(e) => {
                      const next = [...mcOptions];
                      next[idx] = { ...opt, label: e.target.value };
                      setMcOptions(next);
                    }}
                    style={inputStyle}
                  />
                </div>
              ))}
              <Button
                variant="ghost"
                type="button"
                onClick={() =>
                  setMcOptions((opts) => [
                    ...opts,
                    {
                      id: String.fromCharCode(97 + opts.length),
                      label: '',
                    },
                  ])
                }
              >
                Add option
              </Button>
            </fieldset>
          ) : null}

          {question.format === 'short_answer' ? (
            <label style={labelStyle}>
              Accepted answers (one per line)
              <textarea
                value={shortAnswers}
                onChange={(e) => setShortAnswers(e.target.value)}
                rows={4}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </label>
          ) : null}

          {question.format === 'ordered_list' ? (
            <fieldset style={fieldsetStyle}>
              <legend style={legendStyle}>Ordered list</legend>
              {orderItems.map((item, idx) => (
                <input
                  key={item.id}
                  value={item.label}
                  placeholder={`Item ${item.id}`}
                  onChange={(e) => {
                    const next = [...orderItems];
                    next[idx] = { ...item, label: e.target.value };
                    setOrderItems(next);
                  }}
                  style={inputStyle}
                />
              ))}
              <label style={labelStyle}>
                Correct order (comma-separated ids)
                <input
                  value={orderCorrect}
                  onChange={(e) => setOrderCorrect(e.target.value)}
                  style={inputStyle}
                  placeholder={orderItems.map((i) => i.id).join(', ')}
                />
              </label>
            </fieldset>
          ) : null}

          {question.format === 'matching' ? (
            <fieldset style={fieldsetStyle}>
              <legend style={legendStyle}>Matching</legend>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 10,
                }}
              >
                <div style={{ display: 'grid', gap: 6 }}>
                  <strong style={{ fontSize: 12 }}>Left</strong>
                  {matchLeft.map((item, idx) => (
                    <input
                      key={item.id}
                      value={item.label}
                      placeholder={item.id}
                      onChange={(e) => {
                        const next = [...matchLeft];
                        next[idx] = { ...item, label: e.target.value };
                        setMatchLeft(next);
                      }}
                      style={inputStyle}
                    />
                  ))}
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  <strong style={{ fontSize: 12 }}>Right</strong>
                  {matchRight.map((item, idx) => (
                    <input
                      key={item.id}
                      value={item.label}
                      placeholder={item.id}
                      onChange={(e) => {
                        const next = [...matchRight];
                        next[idx] = { ...item, label: e.target.value };
                        setMatchRight(next);
                      }}
                      style={inputStyle}
                    />
                  ))}
                </div>
              </div>
              <label style={labelStyle}>
                Pairs (leftId=rightId, one per line)
                <textarea
                  value={matchPairs}
                  onChange={(e) => setMatchPairs(e.target.value)}
                  rows={3}
                  style={{ ...inputStyle, resize: 'vertical' }}
                  placeholder="l1=r1"
                />
              </label>
            </fieldset>
          ) : null}

          <label style={labelStyle}>
            Rubric / marking notes
            <textarea
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </label>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 10,
            }}
          >
            <label style={labelStyle}>
              Points
              <input
                type="number"
                min={1}
                value={points}
                onChange={(e) => setPoints(Number(e.target.value) || 1)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Seconds
              <input
                type="number"
                min={5}
                value={timingSeconds}
                onChange={(e) => setTimingSeconds(Number(e.target.value) || 30)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Difficulty
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                style={inputStyle}
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </label>
          </div>

          <label style={labelStyle}>
            Wall reveal fact (public)
            <textarea
              value={revealFact}
              onChange={(e) => setRevealFact(e.target.value)}
              rows={2}
              placeholder="One or two sentences of colour for the answer reveal"
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </label>

          <fieldset style={fieldsetStyle}>
            <legend style={legendStyle}>Answer sheet image</legend>
            <p
              style={{
                margin: '0 0 12px',
                fontSize: 13,
                color: 'var(--ink-muted)',
              }}
            >
              Shown when revealing answers — not during the question. Images
              only.
            </p>
            {revealImageId ? (
              <img
                src={`/media/${revealImageId}`}
                alt=""
                style={{
                  maxWidth: '100%',
                  maxHeight: 180,
                  objectFit: 'contain',
                  borderRadius: 12,
                  marginBottom: 8,
                  background: 'var(--bg-0)',
                }}
              />
            ) : (
              <p
                style={{
                  margin: '0 0 8px',
                  color: 'var(--ink-muted)',
                  fontSize: 13,
                }}
              >
                No answer sheet image
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ ...fileBtnStyle, opacity: uploading ? 0.5 : 1 }}>
                {uploading === 'reveal' ? 'Uploading…' : 'Upload image'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  hidden
                  disabled={!!uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload('reveal', f);
                  }}
                />
              </label>
              {revealImageId ? (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setRevealImageId(null)}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          </fieldset>

          <label style={labelStyle}>
            Host notes (private)
            <input
              value={hostNotes}
              onChange={(e) => setHostNotes(e.target.value)}
              style={inputStyle}
            />
          </label>

          <label
            style={{
              ...labelStyle,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <input
              type="checkbox"
              checked={sourcesVerified}
              onChange={(e) => setSourcesVerified(e.target.checked)}
            />
            Sources verified
          </label>

          <fieldset style={fieldsetStyle}>
            <legend style={legendStyle}>
              Prompt media — picture, video, or music
            </legend>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ink-muted)' }}>
              Upload a picture only when the image is the question (“what is this?”).
              Text questions stay picture-free unless you add one — we do not auto-pick
              random stock photos. Music themes may still get ambience audio. Video is
              host-upload only. Max 50MB; save after uploading.
            </p>
            <div style={{ display: 'grid', gap: 16 }}>
              <div>
                <div style={{ fontSize: 13, marginBottom: 6, fontWeight: 600 }}>
                  Picture
                </div>
                {mediaImageId ? (
                  <img
                    src={`/media/${mediaImageId}`}
                    alt=""
                    style={{
                      maxWidth: '100%',
                      maxHeight: 180,
                      objectFit: 'contain',
                      borderRadius: 12,
                      marginBottom: 8,
                      background: 'var(--bg-0)',
                    }}
                  />
                ) : (
                  <p style={{ margin: '0 0 8px', color: 'var(--ink-muted)', fontSize: 13 }}>
                    No picture
                  </p>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <label style={{ ...fileBtnStyle, opacity: uploading ? 0.5 : 1 }}>
                    {uploading === 'image' ? 'Uploading…' : 'Upload picture'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      hidden
                      disabled={!!uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void upload('image', f);
                      }}
                    />
                  </label>
                  {mediaImageId ? (
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => setMediaImageId(null)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 13, marginBottom: 6, fontWeight: 600 }}>
                  Video
                </div>
                {mediaVideoId ? (
                  <video
                    controls
                    src={`/media/${mediaVideoId}`}
                    style={{
                      width: '100%',
                      maxHeight: 220,
                      borderRadius: 12,
                      marginBottom: 8,
                      background: '#000',
                    }}
                  />
                ) : (
                  <p style={{ margin: '0 0 8px', color: 'var(--ink-muted)', fontSize: 13 }}>
                    No video
                  </p>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <label style={{ ...fileBtnStyle, opacity: uploading ? 0.5 : 1 }}>
                    {uploading === 'video' ? 'Uploading…' : 'Upload video'}
                    <input
                      type="file"
                      accept="video/mp4,video/webm,video/quicktime"
                      hidden
                      disabled={!!uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void upload('video', f);
                      }}
                    />
                  </label>
                  {mediaVideoId ? (
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => setMediaVideoId(null)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 13, marginBottom: 6, fontWeight: 600 }}>
                  Music / audio
                </div>
                {mediaAudioId ? (
                  <audio
                    controls
                    src={`/media/${mediaAudioId}`}
                    style={{ width: '100%', marginBottom: 8 }}
                  />
                ) : (
                  <p style={{ margin: '0 0 8px', color: 'var(--ink-muted)', fontSize: 13 }}>
                    No audio
                  </p>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <label style={{ ...fileBtnStyle, opacity: uploading ? 0.5 : 1 }}>
                    {uploading === 'audio' ? 'Uploading…' : 'Upload music'}
                    <input
                      type="file"
                      accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/webm,audio/mp4"
                      hidden
                      disabled={!!uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void upload('audio', f);
                      }}
                    />
                  </label>
                  {mediaAudioId ? (
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => setMediaAudioId(null)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </fieldset>

          {error ? (
            <p style={{ color: 'var(--coral)', margin: 0 }} role="alert">
              {error}
            </p>
          ) : null}

          <div>
            <Button
              type="button"
              disabled={saving || !!uploading}
              onClick={() => void save()}
              withArrow
            >
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function summarizeAnswer(
  format: string,
  data: Record<string, unknown>,
): string {
  try {
    if (format === 'multiple_choice') {
      const options = (data.options as { id: string; label: string }[]) ?? [];
      const correct = new Set((data.correctOptionIds as string[]) ?? []);
      const labels = options
        .filter((o) => correct.has(o.id))
        .map((o) => o.label || o.id);
      return labels.length ? labels.join(', ') : '(no correct option set)';
    }
    if (format === 'short_answer') {
      const answers = (data.acceptedAnswers as string[]) ?? [];
      return answers.length ? answers.join(' / ') : '(no answers)';
    }
    if (format === 'ordered_list') {
      const items = (data.items as { id: string; label: string }[]) ?? [];
      const order = (data.correctOrder as string[]) ?? [];
      return order
        .map((id) => items.find((i) => i.id === id)?.label ?? id)
        .join(' → ');
    }
    if (format === 'matching') {
      const left = (data.left as { id: string; label: string }[]) ?? [];
      const right = (data.right as { id: string; label: string }[]) ?? [];
      const pairs = (data.pairs as { leftId: string; rightId: string }[]) ?? [];
      return pairs
        .map((p) => {
          const l = left.find((x) => x.id === p.leftId)?.label ?? p.leftId;
          const r = right.find((x) => x.id === p.rightId)?.label ?? p.rightId;
          return `${l} ↔ ${r}`;
        })
        .join('; ');
    }
  } catch {
    /* ignore */
  }
  return '(open Edit to review)';
}

const inputStyle: CSSProperties = {
  padding: '0.7rem 0.9rem',
  borderRadius: 12,
  border: '1px solid var(--hairline)',
  width: '100%',
  background: 'var(--bg-0)',
};

const labelStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
  fontSize: 13,
};

const fieldsetStyle: CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: 14,
  padding: '0.85rem 1rem 1rem',
  margin: 0,
  display: 'grid',
  gap: 8,
};

const legendStyle: CSSProperties = {
  padding: '0 6px',
  fontSize: 12,
  color: 'var(--ink-muted)',
};

const fileBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.65rem 1rem',
  borderRadius: 12,
  border: '1px solid var(--hairline)',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 14,
};
