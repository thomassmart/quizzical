import { describe, expect, it } from 'vitest';
import { computePreparedStatus } from './questionStatus.js';

describe('computePreparedStatus', () => {
  it('returns draft when not approving', () => {
    expect(
      computePreparedStatus({
        approve: false,
        eventState: 'lobby',
        snapshotCount: 5,
      }),
    ).toBe('draft');
  });

  it('returns approved for draft/ready events with no snapshot', () => {
    expect(
      computePreparedStatus({
        approve: true,
        eventState: 'draft',
        snapshotCount: 0,
      }),
    ).toBe('approved');
    expect(
      computePreparedStatus({
        approve: true,
        eventState: 'ready',
        snapshotCount: 0,
      }),
    ).toBe('approved');
  });

  it('returns reserved once a play snapshot exists (prepared night)', () => {
    expect(
      computePreparedStatus({
        approve: true,
        eventState: 'ready',
        snapshotCount: 1,
      }),
    ).toBe('reserved');
  });

  it('returns reserved when the event has left Prep', () => {
    for (const eventState of ['lobby', 'live', 'marking', 'finished']) {
      expect(
        computePreparedStatus({
          approve: true,
          eventState,
          snapshotCount: 0,
        }),
      ).toBe('reserved');
    }
  });
});
