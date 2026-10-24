import { describe, expect, it } from 'vitest';
import { computePreparedStatus } from '../services/questionStatus.js';

/**
 * create_question 500s were caused by (a) missing reveal_image_id column and
 * (b) unchecked section lookup throwing on sections[0]!. The status helper
 * below is what the route uses after a successful insert.
 */
describe('create_question status behaviour', () => {
  it('approves into reserved when the event is already prepared', () => {
    expect(
      computePreparedStatus({
        approve: true,
        eventState: 'ready',
        snapshotCount: 12,
      }),
    ).toBe('reserved');
  });

  it('keeps draft when approve is false even on a prepared event', () => {
    expect(
      computePreparedStatus({
        approve: false,
        eventState: 'lobby',
        snapshotCount: 12,
      }),
    ).toBe('draft');
  });
});
