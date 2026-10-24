import { describe, expect, it } from 'vitest';
import { evaluateStructured } from './structuredMark.js';

describe('structured marking', () => {
  it('scores multiple choice', () => {
    const spec = {
      format: 'multiple_choice' as const,
      data: {
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        correctOptionIds: ['b'],
      },
    };
    expect(evaluateStructured(spec, { optionId: 'b' }).correctness).toBe(
      'correct',
    );
    expect(evaluateStructured(spec, { optionId: 'a' }).correctness).toBe(
      'incorrect',
    );
  });

  it('scores short answer with alternatives', () => {
    const spec = {
      format: 'short_answer' as const,
      data: { acceptedAnswers: ['7', 'seven'] },
    };
    expect(evaluateStructured(spec, { text: 'Seven' }).correctness).toBe(
      'correct',
    );
    expect(evaluateStructured(spec, { text: '8' }).correctness).toBe(
      'incorrect',
    );
  });

  it('scores short answer ignoring spaces and punctuation', () => {
    const spec = {
      format: 'short_answer' as const,
      data: { acceptedAnswers: ['Coathanger', 'The Coathanger'] },
    };
    expect(evaluateStructured(spec, { text: 'coat hanger' }).correctness).toBe(
      'correct',
    );
    expect(evaluateStructured(spec, { text: 'the coat-hanger' }).correctness).toBe(
      'correct',
    );
    expect(evaluateStructured(spec, { text: 'harbour bridge' }).correctness).toBe(
      'incorrect',
    );
  });

  it('partial credit on ordered list', () => {
    const spec = {
      format: 'ordered_list' as const,
      data: {
        items: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ],
        correctOrder: ['a', 'b', 'c'],
      },
    };
    const r = evaluateStructured(spec, { order: ['a', 'c', 'b'] });
    expect(r.correctness).toBe('partial');
    expect(r.partialFraction).toBeCloseTo(1 / 3);
  });
});
