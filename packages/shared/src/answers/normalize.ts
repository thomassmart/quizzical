import type {
  AnswerSpec,
  MatchingSpec,
  MultipleChoiceSpec,
  OrderedListSpec,
  QuestionFormat,
  ShortAnswerSpec,
} from '../types/index.js';

type LabelItem = { id: string; label: string };

function asItems(value: unknown): LabelItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, idx) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const id = String(row.id ?? row.key ?? `i${idx + 1}`);
      const label = String(row.label ?? row.text ?? row.name ?? id);
      return { id, label };
    })
    .filter((x): x is LabelItem => Boolean(x));
}

function ensureRightByLabel(
  right: LabelItem[],
  label: string,
): { right: LabelItem[]; rightId: string } {
  const existing = right.find(
    (r) => r.label === label || r.id === label,
  );
  if (existing) return { right, rightId: existing.id };
  const rightId = `r${right.length + 1}`;
  return {
    right: [...right, { id: rightId, label }],
    rightId,
  };
}

/** Infer format when the LLM omits it but leaves shape clues. */
export function inferFormatFromAnswerSpec(
  raw: unknown,
): QuestionFormat | null {
  const root =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  if (typeof root.format === 'string' && root.format) {
    return root.format as QuestionFormat;
  }
  const data =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : root;
  if (Array.isArray(data.options) && (data.correctOptionIds || data.correctOptionId)) {
    return 'multiple_choice';
  }
  if (
    Array.isArray(data.acceptedAnswers) ||
    typeof data.correctAnswer === 'string' ||
    typeof data.answer === 'string'
  ) {
    return 'short_answer';
  }
  if (Array.isArray(data.correctOrder) || Array.isArray(data.items)) {
    return 'ordered_list';
  }
  if (
    Array.isArray(data.left) ||
    Array.isArray(data.pairs) ||
    Array.isArray(data.correctPairs)
  ) {
    return 'matching';
  }
  return null;
}

/** Coerce LLM / legacy answerSpec shapes into the canonical AnswerSpec. */
export function normalizeAnswerSpec(
  format: QuestionFormat | string,
  raw: unknown,
): AnswerSpec {
  const root =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const data =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : root;
  const fmt = String(
    root.format ?? format ?? inferFormatFromAnswerSpec(raw) ?? 'short_answer',
  ) as QuestionFormat;

  switch (fmt) {
    case 'multiple_choice': {
      const options = asItems(data.options);
      const correctOptionIds = Array.isArray(data.correctOptionIds)
        ? data.correctOptionIds.map(String)
        : Array.isArray(data.correctAnswers)
          ? data.correctAnswers.map(String)
          : data.correctOptionId
            ? [String(data.correctOptionId)]
            : [];
      const normalized: MultipleChoiceSpec = { options, correctOptionIds };
      return { format: 'multiple_choice', data: normalized };
    }
    case 'short_answer': {
      let acceptedAnswers: string[] = [];
      if (Array.isArray(data.acceptedAnswers)) {
        acceptedAnswers = data.acceptedAnswers.map(String).filter(Boolean);
      } else if (typeof data.correctAnswer === 'string') {
        acceptedAnswers = [data.correctAnswer];
      } else if (Array.isArray(data.answers)) {
        acceptedAnswers = data.answers.map(String).filter(Boolean);
      } else if (typeof data.answer === 'string') {
        acceptedAnswers = [data.answer];
      }
      const normalized: ShortAnswerSpec = {
        acceptedAnswers,
        caseSensitive: Boolean(data.caseSensitive),
      };
      return { format: 'short_answer', data: normalized };
    }
    case 'ordered_list': {
      const items = asItems(data.items ?? data.options);
      const correctOrder = Array.isArray(data.correctOrder)
        ? data.correctOrder.map(String)
        : items.map((i) => i.id);
      const normalized: OrderedListSpec = { items, correctOrder };
      return { format: 'ordered_list', data: normalized };
    }
    case 'matching': {
      return { format: 'matching', data: normalizeMatching(data) };
    }
    default:
      return {
        format: 'short_answer',
        data: { acceptedAnswers: [] },
      };
  }
}

function normalizeMatching(data: Record<string, unknown>): MatchingSpec {
  const canonicalPairs = Array.isArray(data.pairs)
    ? data.pairs.filter(
        (p) =>
          p &&
          typeof p === 'object' &&
          'leftId' in (p as object) &&
          'rightId' in (p as object),
      )
    : [];

  if (
    Array.isArray(data.left) &&
    Array.isArray(data.right) &&
    canonicalPairs.length
  ) {
    return {
      left: asItems(data.left),
      right: asItems(data.right),
      pairs: canonicalPairs.map((p) => {
        const row = p as { leftId: string; rightId: string };
        return { leftId: String(row.leftId), rightId: String(row.rightId) };
      }),
    };
  }

  // LLM variant A: pairs = left prompts, correctPairs = {left, right:label}
  // LLM variant B: pairs = left, options = right, correctPairs = {pairId, optionId}
  let left = asItems(data.left);
  let right = asItems(data.right);

  const labeledPairs = asItems(data.pairs);
  if (!left.length && labeledPairs.length) left = labeledPairs;
  if (!right.length) right = asItems(data.options ?? data.rightItems);

  const correctRaw = Array.isArray(data.correctPairs)
    ? data.correctPairs
    : Array.isArray(data.matches)
      ? data.matches
      : [];

  const pairs: { leftId: string; rightId: string }[] = [];

  for (const raw of correctRaw) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;

    if (row.leftId != null && row.rightId != null) {
      pairs.push({
        leftId: String(row.leftId),
        rightId: String(row.rightId),
      });
      continue;
    }

    if (row.pairId != null && row.optionId != null) {
      pairs.push({
        leftId: String(row.pairId),
        rightId: String(row.optionId),
      });
      continue;
    }

    if (row.left != null && row.right != null) {
      const leftKey = String(row.left);
      const rightKey = String(row.right);
      const leftItem =
        left.find((l) => l.id === leftKey) ??
        left.find((l) => l.label === leftKey);
      const leftId = leftItem?.id ?? leftKey;
      if (!leftItem) {
        left = [...left, { id: leftId, label: leftKey }];
      }
      const ensured = ensureRightByLabel(right, rightKey);
      right = ensured.right;
      pairs.push({ leftId, rightId: ensured.rightId });
    }
  }

  // If still no right column, invent from pair rightIds
  if (!right.length && pairs.length) {
    right = pairs.map((p) => ({
      id: p.rightId,
      label: p.rightId,
    }));
  }

  return { left, right, pairs };
}
