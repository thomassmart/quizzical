import { describe, expect, it } from 'vitest';
import { scoreAnswer } from '@quizzical/shared';

describe('irreversible wager scoring contract', () => {
  it('incorrect wager loses twice base', () => {
    expect(
      scoreAnswer({
        basePoints: 1,
        correctness: 'incorrect',
        isFirstFullyCorrect: false,
        isBonusSection: false,
        isWager: true,
      }).total,
    ).toBe(-2);
  });

  it('wager is mutually exclusive with bonus multipliers in scoring input', () => {
    // Engine rejects wager in bonus section; if both flags set, wager path wins
    const r = scoreAnswer({
      basePoints: 1,
      correctness: 'correct',
      isFirstFullyCorrect: true,
      isBonusSection: true,
      isWager: true,
    });
    expect(r.total).toBe(4);
  });
});
