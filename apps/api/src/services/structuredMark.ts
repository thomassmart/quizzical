import { normalizeAnswerSpec, type AnswerSpec } from '@quizzical/shared';

export interface StructuredResult {
  correctness: 'correct' | 'incorrect' | 'partial' | 'unanswered';
  partialFraction?: number;
}

/** Loose compare for pub trivia: ignore case, spaces, punctuation, and leading articles. */
function normalizeShortAnswer(s: string, caseSensitive = false): string {
  const stripped = s.trim().replace(/^(the|a|an)\s+/i, '');
  const compact = stripped.replace(/[^a-zA-Z0-9]+/g, '');
  return caseSensitive ? compact : compact.toLowerCase();
}

export function evaluateStructured(
  answerSpec: AnswerSpec,
  payload: unknown,
): StructuredResult {
  if (payload === null || payload === undefined || payload === '') {
    return { correctness: 'unanswered' };
  }

  const spec = normalizeAnswerSpec(answerSpec.format, answerSpec);
  switch (spec.format) {
    case 'multiple_choice': {
      const selected = Array.isArray((payload as { selected?: string[] }).selected)
        ? (payload as { selected: string[] }).selected
        : typeof (payload as { optionId?: string }).optionId === 'string'
          ? [(payload as { optionId: string }).optionId]
          : [];
      if (!selected.length) return { correctness: 'unanswered' };
      const correct = new Set(spec.data.correctOptionIds);
      const sel = new Set(selected);
      const allCorrect =
        sel.size === correct.size && [...sel].every((id) => correct.has(id));
      return { correctness: allCorrect ? 'correct' : 'incorrect' };
    }
    case 'short_answer': {
      const text = String((payload as { text?: string }).text ?? payload ?? '');
      if (!text.trim()) return { correctness: 'unanswered' };
      const cs = spec.data.caseSensitive ?? false;
      const norm = normalizeShortAnswer(text, cs);
      const ok = spec.data.acceptedAnswers.some(
        (a) => normalizeShortAnswer(a, cs) === norm,
      );
      return { correctness: ok ? 'correct' : 'incorrect' };
    }
    case 'ordered_list': {
      const order = (payload as { order?: string[] }).order ?? [];
      if (!order.length) return { correctness: 'unanswered' };
      const expected = spec.data.correctOrder;
      let correctCount = 0;
      for (let i = 0; i < expected.length; i++) {
        if (order[i] === expected[i]) correctCount++;
      }
      if (correctCount === expected.length) return { correctness: 'correct' };
      if (correctCount === 0) return { correctness: 'incorrect' };
      return {
        correctness: 'partial',
        partialFraction: correctCount / expected.length,
      };
    }
    case 'matching': {
      const pairs = (payload as { pairs?: { leftId: string; rightId: string }[] })
        .pairs ?? [];
      if (!pairs.length) return { correctness: 'unanswered' };
      const expected = new Map(
        spec.data.pairs.map((p) => [p.leftId, p.rightId]),
      );
      let correctCount = 0;
      for (const p of pairs) {
        if (expected.get(p.leftId) === p.rightId) correctCount++;
      }
      if (correctCount === expected.size && pairs.length === expected.size) {
        return { correctness: 'correct' };
      }
      if (correctCount === 0) return { correctness: 'incorrect' };
      return {
        correctness: 'partial',
        partialFraction: correctCount / expected.size,
      };
    }
    default:
      return { correctness: 'unanswered' };
  }
}
