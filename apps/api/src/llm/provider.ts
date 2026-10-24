import { config, llmConfigured } from '../config.js';
import {
  PUB_TRIVIA_BRIEF,
  PUB_TRIVIA_EVIDENCE,
  PUB_TRIVIA_MARK_BRIEF,
  PUB_TRIVIA_PLATFORM_CONTRACT,
  PUB_TRIVIA_THEME_BRIEF,
  composeHostNotes,
  composeRevealFact,
  type ProposedHostMeta,
} from './pubTriviaEditor.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface MarkSuggestion {
  correctness: 'correct' | 'incorrect' | 'partial';
  partialFraction?: number;
  justification: string;
  uncertainty: 'low' | 'medium' | 'high';
}

export interface ProposedQuestion extends ProposedHostMeta {
  format: 'multiple_choice' | 'short_answer' | 'ordered_list' | 'matching';
  wording: string;
  answerSpec: unknown;
  rubric: string;
  difficulty: 'easy' | 'medium' | 'hard';
  themeTags: string[];
  points: number;
  timingSeconds: number;
  sourceReferences?: string[];
}

export { composeHostNotes, composeRevealFact };

function llmEndpoint(path: string): string {
  // Accept either https://host or https://host/v1 as LLM_BASE_URL
  const base = config.llm.baseUrl.replace(/\/$/, '');
  const root = base.endsWith('/v1') ? base.slice(0, -3) : base;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${root}${normalizedPath}`;
}

async function llmFetch(path: string, body: unknown): Promise<unknown> {
  if (!llmConfigured()) {
    throw new LlmUnavailableError('LLM not configured');
  }
  const url = llmEndpoint(path);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.llm.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new LlmUnavailableError(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export class LlmUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}

export async function chatJson<T>(
  messages: ChatMessage[],
  model = config.llm.chatModel,
): Promise<T> {
  const tryModel = async (m: string) => {
    const data = (await llmFetch('/v1/chat/completions', {
      model: m,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages,
    })) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new LlmUnavailableError('Empty LLM response');
    return JSON.parse(content) as T;
  };

  try {
    return await tryModel(model);
  } catch (e) {
    if (model !== config.llm.fallbackChatModel) {
      return tryModel(config.llm.fallbackChatModel);
    }
    throw e;
  }
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!llmConfigured() || texts.length === 0) {
    return texts.map(() => []);
  }
  const data = (await llmFetch('/v1/embeddings', {
    model: config.llm.embedModel,
    input: texts,
  })) as { data?: { embedding: number[]; index: number }[] };
  const rows = data.data ?? [];
  return texts.map((_, i) => rows.find((r) => r.index === i)?.embedding ?? []);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Sanitize untrusted team answers before inclusion in prompts.
 * Strip instruction-like patterns; wrap as data, never as instructions.
 */
export function sanitizeUntrustedAnswer(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return s
    .replace(/```/g, '')
    .replace(/\b(ignore|disregard|system prompt|instructions)\b/gi, '[filtered]')
    .slice(0, 2000);
}

export interface SectionThemeSuggestion {
  title: string;
  theme: string;
  difficulty: 'easy' | 'medium' | 'hard';
  blurb: string;
}

/** Fallback when LLM is unavailable — 2/6 Aussie (~30%), rest global. */
export const DEFAULT_SECTION_SUGGESTIONS: SectionThemeSuggestion[] = [
  {
    title: 'General Knowledge',
    theme: 'General Knowledge',
    difficulty: 'medium',
    blurb: 'A warm-up mix across everyday topics',
  },
  {
    title: 'Film & TV',
    theme: 'Film & TV',
    difficulty: 'easy',
    blurb: 'Movies, series, and screen moments everyone argues about',
  },
  {
    title: 'Music Charts',
    theme: 'Music',
    difficulty: 'medium',
    blurb: 'Hits, albums, and artists from across the decades',
  },
  {
    title: 'World Geography',
    theme: 'Geography',
    difficulty: 'medium',
    blurb: 'Capitals, coasts, rivers, and famous places',
  },
  {
    title: 'Sydney & NSW',
    theme: 'Sydney & NSW',
    difficulty: 'medium',
    blurb: 'Landmarks, suburbs, ferries, and local lore',
  },
  {
    title: 'Aussie Sport',
    theme: 'Australian Sport',
    difficulty: 'easy',
    blurb: 'NRL, AFL, cricket, and backyard classics',
  },
];

export async function suggestSectionThemes(input: {
  eventName: string;
  seriesName: string;
  existingThemes: string[];
  seriesHistoryThemes: string[];
  count?: number;
}): Promise<SectionThemeSuggestion[]> {
  const count = input.count ?? 6;
  const auTarget = Math.max(1, Math.round(count * 0.3));
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: PUB_TRIVIA_THEME_BRIEF,
    },
    {
      role: 'user',
      content: JSON.stringify({
        eventName: input.eventName,
        seriesName: input.seriesName,
        existingThemes: input.existingThemes,
        seriesHistoryThemes: input.seriesHistoryThemes.slice(0, 40),
        count,
        localeMix: {
          au: auTarget,
          global: count - auTarget,
          rule: 'Exactly this many au vs global themes — do not over-index on Australia',
        },
      }),
    },
  ];
  const result = await chatJson<{ suggestions: SectionThemeSuggestion[] }>(
    messages,
  );
  return (result.suggestions ?? []).filter(
    (s) => s.title?.trim() && s.theme?.trim(),
  );
}

export async function generateSectionQuestions(input: {
  theme: string;
  count: number;
  difficulty: string;
  excludedSummaries: string[];
}): Promise<ProposedQuestion[]> {
  // Medium sections get a full pub mix; easy/hard sections stay biased.
  const difficultyTarget =
    input.difficulty === 'easy' || input.difficulty === 'hard'
      ? input.difficulty
      : 'mixed';
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${PUB_TRIVIA_BRIEF}

${PUB_TRIVIA_EVIDENCE}

${PUB_TRIVIA_PLATFORM_CONTRACT}`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        theme: input.theme,
        count: input.count,
        /** mixed = ~30% easy / 50% medium / 20% hard across the batch */
        difficultyTarget,
        sectionDifficultyHint: input.difficulty,
        excluded: input.excludedSummaries.slice(0, 40),
        reminder:
          'Player wording only in wording. Host reveal/adjudication in explanation/hostNotes/rejectAnswers. evidenceStatus must be needs_review.',
      }),
    },
  ];
  const result = await chatJson<{ questions: ProposedQuestion[] }>(messages);
  const questions = result.questions ?? [];
  // Hard-enforce honesty: never persist LLM "verified" claims
  return questions.map((q) => ({
    ...q,
    evidenceStatus: 'needs_review',
    sourceReferences: [],
  }));
}

export async function suggestMark(input: {
  wording: string;
  rubric: string;
  acceptedAnswers: string[];
  submitted: unknown;
  hostNotes?: string | null;
}): Promise<MarkSuggestion> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: PUB_TRIVIA_MARK_BRIEF,
    },
    {
      role: 'user',
      content: JSON.stringify({
        question: input.wording,
        rubric: input.rubric,
        acceptedAnswers: input.acceptedAnswers,
        hostNotes: input.hostNotes ?? null,
        SUBMITTED_ANSWER: sanitizeUntrustedAnswer(input.submitted),
      }),
    },
  ];
  return chatJson<MarkSuggestion>(messages);
}
