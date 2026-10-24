/**
 * Authoritative scoring rules for Quizzical.
 *
 * Ordinary (base B):
 *   correct: +B | correct+first: +B+1 | incorrect/unanswered: 0
 *
 * Bonus section:
 *   correct: 2B | correct+first: 2B+1 | incorrect: -1 | unanswered: 0
 *
 * Wager (cannot be used in bonus section):
 *   correct: 2*(earned answer+speed) | incorrect/unanswered: -2B
 *   Example first-correct wager on 1pt: (1+1)*2 = 4
 *
 * Partial credit applies only to ordinary (non-bonus, non-wager) answers.
 * Bonus/wager ambiguous cases should be flagged for host discretion.
 */

export type Correctness = 'correct' | 'incorrect' | 'unanswered' | 'partial';

export interface ScoreInput {
  basePoints: number;
  correctness: Correctness;
  /** Fraction 0–1 for ordinary partial credit only. Ignored for bonus/wager. */
  partialFraction?: number;
  isFirstFullyCorrect: boolean;
  isBonusSection: boolean;
  isWager: boolean;
}

export interface ScoreBreakdown {
  answerPoints: number;
  speedPoints: number;
  bonusEffect: number;
  wagerEffect: number;
  /** True when host should review rather than auto-apply multipliers */
  needsHostDiscretion: boolean;
  total: number;
}

function clampPartial(f: number | undefined): number {
  if (f === undefined || Number.isNaN(f)) return 0;
  return Math.min(1, Math.max(0, f));
}

/**
 * Compute points for a single team answer on one question.
 * Speed point is awarded only for fully correct answers (not partial).
 */
export function scoreAnswer(input: ScoreInput): ScoreBreakdown {
  const B = input.basePoints;
  const needsHostDiscretion =
    (input.isBonusSection || input.isWager) && input.correctness === 'partial';

  if (needsHostDiscretion) {
    return {
      answerPoints: 0,
      speedPoints: 0,
      bonusEffect: 0,
      wagerEffect: 0,
      needsHostDiscretion: true,
      total: 0,
    };
  }

  if (input.isWager) {
    return scoreWager(input, B);
  }
  if (input.isBonusSection) {
    return scoreBonus(input, B);
  }
  return scoreOrdinary(input, B);
}

function scoreOrdinary(input: ScoreInput, B: number): ScoreBreakdown {
  if (input.correctness === 'unanswered' || input.correctness === 'incorrect') {
    return zero();
  }
  if (input.correctness === 'partial') {
    const answerPoints = B * clampPartial(input.partialFraction);
    return {
      answerPoints,
      speedPoints: 0,
      bonusEffect: 0,
      wagerEffect: 0,
      needsHostDiscretion: false,
      total: answerPoints,
    };
  }
  // fully correct
  const speedPoints = input.isFirstFullyCorrect ? 1 : 0;
  return {
    answerPoints: B,
    speedPoints,
    bonusEffect: 0,
    wagerEffect: 0,
    needsHostDiscretion: false,
    total: B + speedPoints,
  };
}

function scoreBonus(input: ScoreInput, B: number): ScoreBreakdown {
  if (input.correctness === 'unanswered') return zero();
  if (input.correctness === 'incorrect') {
    return {
      answerPoints: 0,
      speedPoints: 0,
      bonusEffect: -1,
      wagerEffect: 0,
      needsHostDiscretion: false,
      total: -1,
    };
  }
  // correct (partial already flagged)
  const doubled = 2 * B;
  const speedPoints = input.isFirstFullyCorrect ? 1 : 0;
  return {
    answerPoints: 0,
    speedPoints,
    bonusEffect: doubled,
    wagerEffect: 0,
    needsHostDiscretion: false,
    total: doubled + speedPoints,
  };
}

function scoreWager(input: ScoreInput, B: number): ScoreBreakdown {
  if (input.correctness === 'unanswered' || input.correctness === 'incorrect') {
    return {
      answerPoints: 0,
      speedPoints: 0,
      bonusEffect: 0,
      wagerEffect: -2 * B,
      needsHostDiscretion: false,
      total: -2 * B,
    };
  }
  // correct: double (base + speed)
  const speedPoints = input.isFirstFullyCorrect ? 1 : 0;
  const earned = B + speedPoints;
  const wagerEffect = earned; // doubles: we store base in answer/speed and extra in wager
  // Spec: Correct: double the earned answer points, including the speed point.
  // Ledger: answerPoints=B, speedPoints=S, wagerEffect=(B+S) so total = 2*(B+S)
  return {
    answerPoints: B,
    speedPoints,
    bonusEffect: 0,
    wagerEffect,
    needsHostDiscretion: false,
    total: 2 * earned,
  };
}

function zero(): ScoreBreakdown {
  return {
    answerPoints: 0,
    speedPoints: 0,
    bonusEffect: 0,
    wagerEffect: 0,
    needsHostDiscretion: false,
    total: 0,
  };
}

/**
 * Display-only score formatting. Does not alter ledger values.
 * Integers render as whole numbers; fractional scores use one decimal
 * (e.g. 6⅓ → "6.3") so JS float noise never reaches the wall/host UI.
 */
export function formatScore(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const tenths = Math.round(n * 10) / 10;
  if (Number.isInteger(tenths) || Math.abs(tenths - Math.round(tenths)) < 1e-9) {
    return String(Math.round(tenths));
  }
  return tenths.toFixed(1);
}

/**
 * Deterministic tie-break for equal server receipt timestamps.
 * Lower teamId wins (stable lexicographic).
 */
export function compareReceiptOrder(
  a: { receivedAt: number; teamId: string },
  b: { receivedAt: number; teamId: string },
): number {
  if (a.receivedAt !== b.receivedAt) return a.receivedAt - b.receivedAt;
  return a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0;
}

/**
 * Pick the first fully correct team by server receipt order.
 */
export function pickSpeedWinner(
  entries: { teamId: string; receivedAt: number; fullyCorrect: boolean }[],
): string | null {
  const eligible = entries
    .filter((e) => e.fullyCorrect)
    .sort(compareReceiptOrder);
  return eligible[0]?.teamId ?? null;
}
