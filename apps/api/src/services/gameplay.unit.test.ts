import { describe, expect, it } from 'vitest';
import { hashPayload } from '../util/normalize.js';
import { normalizeWording } from '../util/normalize.js';

describe('idempotent payload hashing', () => {
  it('identical payloads hash equal', () => {
    expect(hashPayload({ optionId: 'a' })).toBe(hashPayload({ optionId: 'a' }));
  });

  it('different payloads hash differently', () => {
    expect(hashPayload({ optionId: 'a' })).not.toBe(
      hashPayload({ optionId: 'b' }),
    );
  });
});

describe('duplicate wording normalization', () => {
  it('treats punctuation/case variants as exact duplicates', () => {
    expect(normalizeWording('What is Paris?')).toBe(
      normalizeWording('what is paris'),
    );
  });
});
