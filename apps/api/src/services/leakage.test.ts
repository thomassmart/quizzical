import { describe, expect, it } from 'vitest';
import type { WallboardSnapshot, TeamPlaySnapshot } from '@quizzical/shared';

/** Contract tests: role payloads must not leak secrets. */
describe('role payload leakage contracts', () => {
  it('wallboard snapshot type omits sensitive fields', () => {
    const wall: WallboardSnapshot = {
      role: 'wallboard',
      eventId: 'e',
      eventCode: 'ABC',
      eventName: 'Night',
      seriesName: 'Series',
      state: 'lobby',
    };
    expect(wall).not.toHaveProperty('pin');
    expect(wall).not.toHaveProperty('hostNotes');
    expect(wall).not.toHaveProperty('llmSuggestion');
    expect(JSON.stringify(wall)).not.toMatch(/pin_hash|rubric|answerSpec|"pin"/);
  });

  it('team snapshot omits keys and host-only fields', () => {
    const team: TeamPlaySnapshot = {
      role: 'team',
      eventId: 'e',
      teamId: 't',
      teamName: 'Pandas',
      avatarId: 'red-panda',
      state: 'answer_open',
      answerWindowOpen: true,
      paused: false,
      wagersRemaining: 2,
      wagerActive: false,
      bonusSectionId: null,
      inBonusSection: false,
      bonusLocked: true,
      connected: true,
      submissionAuthority: true,
      questionWording: 'Capital of France?',
      optionLabels: [{ id: 'a', label: 'Paris' }],
    };
    expect(team).not.toHaveProperty('rubric');
    expect(team).not.toHaveProperty('correctOptionIds');
    expect(team).not.toHaveProperty('hostNotes');
    expect(team).not.toHaveProperty('pin');
    expect(JSON.stringify(team)).not.toMatch(/answerSpec|pin_hash/);
  });

  it('wall reveal may include revealFact and answer image but never hostNotes', () => {
    const wall: WallboardSnapshot = {
      role: 'wallboard',
      eventId: 'e',
      eventCode: 'ABC',
      eventName: 'Night',
      seriesName: 'Series',
      state: 'section_reveal',
      revealAnswer: {
        index: 0,
        total: 4,
        wording: 'Capital of France?',
        correctDisplay: 'Paris',
        revealFact: 'Paris has been the capital since the 12th century.',
        imageUrl: '/media/reveal-img',
      },
    };
    expect(wall.revealAnswer?.revealFact).toBeTruthy();
    expect(wall.revealAnswer?.imageUrl).toBeTruthy();
    expect(wall).not.toHaveProperty('hostNotes');
    expect(JSON.stringify(wall)).not.toMatch(/hostNotes/);
  });

  it('live wall question must not expose answer-sheet reveal image fields', () => {
    const wall: WallboardSnapshot = {
      role: 'wallboard',
      eventId: 'e',
      eventCode: 'ABC',
      eventName: 'Night',
      seriesName: 'Series',
      state: 'question_revealed',
      questionWording: 'Capital of France?',
      mediaImageUrl: '/media/prompt-img',
    };
    expect(wall.mediaImageUrl).toBe('/media/prompt-img');
    expect(wall).not.toHaveProperty('revealAnswer');
    expect(JSON.stringify(wall)).not.toMatch(/revealImageId|reveal_image/);
  });

  it('team revealCard may show correct answer only during reveal', () => {
    const team: TeamPlaySnapshot = {
      role: 'team',
      eventId: 'e',
      teamId: 't',
      teamName: 'Pandas',
      avatarId: 'red-panda',
      state: 'section_reveal',
      answerWindowOpen: false,
      paused: false,
      wagersRemaining: 1,
      wagerActive: false,
      bonusSectionId: null,
      inBonusSection: false,
      bonusLocked: true,
      connected: true,
      submissionAuthority: true,
      revealPhase: 'answers',
      revealCard: {
        index: 0,
        total: 4,
        wording: 'Capital of France?',
        correctDisplay: 'Paris',
        yourAnswerDisplay: 'Paris',
        markOutcome: 'correct',
        revealFact: 'Paris has been the capital since the 12th century.',
      },
    };
    expect(team.revealCard?.correctDisplay).toBe('Paris');
    expect(team).not.toHaveProperty('hostNotes');
    expect(JSON.stringify(team)).not.toMatch(/hostNotes|answerSpec/);
  });
});
