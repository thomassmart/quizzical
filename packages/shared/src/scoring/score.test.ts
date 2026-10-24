import { describe, expect, it } from 'vitest';
import {
  compareReceiptOrder,
  formatScore,
  pickSpeedWinner,
  scoreAnswer,
} from './score.js';

describe('ordinary scoring (base 1)', () => {
  it('correct = +1', () => {
    const r = scoreAnswer({
      basePoints: 1,
      correctness: 'correct',
      isFirstFullyCorrect: false,
      isBonusSection: false,
      isWager: false,
    });
    expect(r.total).toBe(1);
    expect(r.answerPoints).toBe(1);
    expect(r.speedPoints).toBe(0);
  });

  it('correct and first = +2', () => {
    const r = scoreAnswer({
      basePoints: 1,
      correctness: 'correct',
      isFirstFullyCorrect: true,
      isBonusSection: false,
      isWager: false,
    });
    expect(r.total).toBe(2);
    expect(r.speedPoints).toBe(1);
  });

  it('incorrect = 0', () => {
    expect(
      scoreAnswer({
        basePoints: 1,
        correctness: 'incorrect',
        isFirstFullyCorrect: false,
        isBonusSection: false,
        isWager: false,
      }).total,
    ).toBe(0);
  });

  it('unanswered = 0', () => {
    expect(
      scoreAnswer({
        basePoints: 1,
        correctness: 'unanswered',
        isFirstFullyCorrect: false,
        isBonusSection: false,
        isWager: false,
      }).total,
    ).toBe(0);
  });
});

describe('bonus section (base 1)', () => {
  it('correct = +2', () => {
    const r = scoreAnswer({
      basePoints: 1,
      correctness: 'correct',
      isFirstFullyCorrect: false,
      isBonusSection: true,
      isWager: false,
    });
    expect(r.total).toBe(2);
    expect(r.bonusEffect).toBe(2);
  });

  it('correct and first = +3', () => {
    const r = scoreAnswer({
      basePoints: 1,
      correctness: 'correct',
      isFirstFullyCorrect: true,
      isBonusSection: true,
      isWager: false,
    });
    expect(r.total).toBe(3);
    expect(r.bonusEffect).toBe(2);
    expect(r.speedPoints).toBe(1);
  });

  it('incorrect = -1', () => {
    expect(
      scoreAnswer({
        basePoints: 1,
        correctness: 'incorrect',
        isFirstFullyCorrect: false,
        isBonusSection: true,
        isWager: false,
      }).total,
    ).toBe(-1);
  });

  it('unanswered = 0', () => {
    expect(
      scoreAnswer({
        basePoints: 1,
        correctness: 'unanswered',
        isFirstFullyCorrect: false,
        isBonusSection: true,
        isWager: false,
      }).total,
    ).toBe(0);
  });
});

describe('wager (base 1)', () => {
  it('correct = +2', () => {
    const r = scoreAnswer({
      basePoints: 1,
      correctness: 'correct',
      isFirstFullyCorrect: false,
      isBonusSection: false,
      isWager: true,
    });
    expect(r.total).toBe(2);
  });

  it('correct and first = +4', () => {
    const r = scoreAnswer({
      basePoints: 1,
      correctness: 'correct',
      isFirstFullyCorrect: true,
      isBonusSection: false,
      isWager: true,
    });
    expect(r.total).toBe(4);
  });

  it('incorrect = -2', () => {
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

  it('unanswered = -2', () => {
    expect(
      scoreAnswer({
        basePoints: 1,
        correctness: 'unanswered',
        isFirstFullyCorrect: false,
        isBonusSection: false,
        isWager: true,
      }).total,
    ).toBe(-2);
  });
});

describe('variable question values', () => {
  it('ordinary first correct on 3pt = 4', () => {
    const r = scoreAnswer({
      basePoints: 3,
      correctness: 'correct',
      isFirstFullyCorrect: true,
      isBonusSection: false,
      isWager: false,
    });
    expect(r.total).toBe(4);
  });

  it('bonus first correct on 2pt = 5', () => {
    const r = scoreAnswer({
      basePoints: 2,
      correctness: 'correct',
      isFirstFullyCorrect: true,
      isBonusSection: true,
      isWager: false,
    });
    expect(r.total).toBe(5); // 4 + 1 speed
  });

  it('wager incorrect on 3pt = -6', () => {
    expect(
      scoreAnswer({
        basePoints: 3,
        correctness: 'incorrect',
        isFirstFullyCorrect: false,
        isBonusSection: false,
        isWager: true,
      }).total,
    ).toBe(-6);
  });
});

describe('partial credit', () => {
  it('ordinary half credit on 2pt = 1', () => {
    const r = scoreAnswer({
      basePoints: 2,
      correctness: 'partial',
      partialFraction: 0.5,
      isFirstFullyCorrect: false,
      isBonusSection: false,
      isWager: false,
    });
    expect(r.total).toBe(1);
    expect(r.speedPoints).toBe(0);
  });

  it('partial does not qualify for speed', () => {
    const r = scoreAnswer({
      basePoints: 1,
      correctness: 'partial',
      partialFraction: 1,
      isFirstFullyCorrect: true,
      isBonusSection: false,
      isWager: false,
    });
    expect(r.speedPoints).toBe(0);
  });

  it('bonus partial flags host discretion', () => {
    const r = scoreAnswer({
      basePoints: 1,
      correctness: 'partial',
      partialFraction: 0.5,
      isFirstFullyCorrect: false,
      isBonusSection: true,
      isWager: false,
    });
    expect(r.needsHostDiscretion).toBe(true);
    expect(r.total).toBe(0);
  });

  it('wager partial flags host discretion', () => {
    const r = scoreAnswer({
      basePoints: 1,
      correctness: 'partial',
      isFirstFullyCorrect: false,
      isBonusSection: false,
      isWager: true,
    });
    expect(r.needsHostDiscretion).toBe(true);
  });
});

describe('speed winner selection', () => {
  it('picks earliest fully correct', () => {
    const winner = pickSpeedWinner([
      { teamId: 'b', receivedAt: 200, fullyCorrect: true },
      { teamId: 'a', receivedAt: 100, fullyCorrect: true },
      { teamId: 'c', receivedAt: 50, fullyCorrect: false },
    ]);
    expect(winner).toBe('a');
  });

  it('tie-breaks equal timestamps by teamId', () => {
    expect(
      compareReceiptOrder(
        { receivedAt: 10, teamId: 'team-z' },
        { receivedAt: 10, teamId: 'team-a' },
      ),
    ).toBeGreaterThan(0);
    const winner = pickSpeedWinner([
      { teamId: 'team-z', receivedAt: 10, fullyCorrect: true },
      { teamId: 'team-a', receivedAt: 10, fullyCorrect: true },
    ]);
    expect(winner).toBe('team-a');
  });

  it('returns null when none fully correct', () => {
    expect(
      pickSpeedWinner([{ teamId: 'a', receivedAt: 1, fullyCorrect: false }]),
    ).toBeNull();
  });
});

describe('formatScore', () => {
  it('renders integers as whole numbers', () => {
    expect(formatScore(0)).toBe('0');
    expect(formatScore(6)).toBe('6');
    expect(formatScore(6.0)).toBe('6');
    expect(formatScore(-1)).toBe('-1');
  });

  it('renders fractional scores to one decimal', () => {
    expect(formatScore(6.333333333333333)).toBe('6.3');
    expect(formatScore(1 / 3)).toBe('0.3');
    expect(formatScore(6.5)).toBe('6.5');
    expect(formatScore(2.25)).toBe('2.3');
  });

  it('handles non-finite input', () => {
    expect(formatScore(Number.NaN)).toBe('0');
    expect(formatScore(Number.POSITIVE_INFINITY)).toBe('0');
  });
});
