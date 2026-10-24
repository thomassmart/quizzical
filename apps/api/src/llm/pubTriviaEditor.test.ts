import { describe, expect, it } from 'vitest';
import { composeHostNotes, composeRevealFact } from './pubTriviaEditor.js';

describe('composeRevealFact', () => {
  it('returns trimmed explanation for the wall', () => {
    expect(
      composeRevealFact({ explanation: '  It opened in 1973.  ' }),
    ).toBe('It opened in 1973.');
  });

  it('returns null when empty', () => {
    expect(composeRevealFact({})).toBeNull();
    expect(composeRevealFact({ explanation: '   ' })).toBeNull();
  });
});

describe('composeHostNotes', () => {
  it('keeps adjudication private and omits Reveal lines', () => {
    const notes = composeHostNotes({
      explanation: 'It opened in 1973.',
      answerRequirements: 'Full official name',
      rejectAnswers: [{ answer: 'Harbour Bridge', reason: 'Wrong landmark' }],
      hostNotes: 'Stress “Opera”',
      evidenceStatus: 'verified',
    });
    expect(notes).not.toContain('Reveal:');
    expect(notes).not.toContain('It opened in 1973.');
    expect(notes).toContain('Require: Full official name');
    expect(notes).toContain('- Harbour Bridge: Wrong landmark');
    expect(notes).toContain('Stress “Opera”');
    expect(notes).toMatch(/needs_review/);
    expect(notes).not.toMatch(/Evidence: verified/);
  });

  it('works with empty meta', () => {
    const notes = composeHostNotes({});
    expect(notes).toMatch(/needs_review/);
  });
});
