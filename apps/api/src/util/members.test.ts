import { describe, expect, it } from 'vitest';
import { normalizeMemberNames } from './members.js';

describe('normalizeMemberNames', () => {
  it('splits lines and commas, trims, dedupes', () => {
    expect(
      normalizeMemberNames('Alex\nSam, Jordan\n alex '),
    ).toEqual(['Alex', 'Sam', 'Jordan']);
  });

  it('caps length and count', () => {
    const long = 'x'.repeat(50);
    expect(normalizeMemberNames([long, 'Ok']).length).toBe(1);
    expect(normalizeMemberNames(Array.from({ length: 20 }, (_, i) => `P${i}`))).toHaveLength(
      12,
    );
  });
});
