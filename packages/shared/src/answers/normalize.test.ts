import { describe, expect, it } from 'vitest';
import { normalizeAnswerSpec } from './normalize.js';

describe('normalizeAnswerSpec matching', () => {
  it('keeps canonical left/right/pairs', () => {
    const spec = normalizeAnswerSpec('matching', {
      format: 'matching',
      data: {
        left: [{ id: 'l1', label: 'Newton' }],
        right: [{ id: 'r1', label: 'Gravity' }],
        pairs: [{ leftId: 'l1', rightId: 'r1' }],
      },
    });
    expect(spec).toEqual({
      format: 'matching',
      data: {
        left: [{ id: 'l1', label: 'Newton' }],
        right: [{ id: 'r1', label: 'Gravity' }],
        pairs: [{ leftId: 'l1', rightId: 'r1' }],
      },
    });
  });

  it('coerces LLM pairs + correctPairs with right labels', () => {
    const spec = normalizeAnswerSpec('matching', {
      format: 'matching',
      data: {
        pairs: [
          { id: '1', label: '1977' },
          { id: '2', label: '1984' },
        ],
        correctPairs: [
          { left: '1', right: 'Apple II' },
          { left: '2', right: 'Macintosh' },
        ],
      },
    });
    expect(spec.format).toBe('matching');
    if (spec.format !== 'matching') return;
    expect(spec.data.left.map((l) => l.label)).toEqual(['1977', '1984']);
    expect(spec.data.right.map((r) => r.label)).toEqual([
      'Apple II',
      'Macintosh',
    ]);
    expect(spec.data.pairs).toHaveLength(2);
    expect(spec.data.pairs[0]?.leftId).toBe('1');
    expect(
      spec.data.right.find((r) => r.id === spec.data.pairs[0]?.rightId)?.label,
    ).toBe('Apple II');
  });

  it('coerces short_answer correctAnswer', () => {
    const spec = normalizeAnswerSpec('short_answer', {
      format: 'short_answer',
      data: { correctAnswer: 'The Terminator' },
    });
    expect(spec).toEqual({
      format: 'short_answer',
      data: { acceptedAnswers: ['The Terminator'], caseSensitive: false },
    });
  });
});
