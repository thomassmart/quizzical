import { describe, expect, it } from 'vitest';
import {
  diversifyTopicHits,
  spoilerTermsFromQuestions,
  subjectKeyFromTitle,
  titleLooksLikeSpoiler,
  topicSearchQueries,
} from './topicImages.js';

describe('topicSearchQueries', () => {
  it('widens Movie Hits into several distinct cinema queries', () => {
    const qs = topicSearchQueries('Movie Hits', 'Movie Hits');
    expect(qs.length).toBeGreaterThanOrEqual(4);
    expect(qs.some((q) => /cinema|film|movie|clapper|projector/i.test(q))).toBe(
      true,
    );
  });

  it('widens Global Pop Icons beyond a single artist search', () => {
    const qs = topicSearchQueries('Global Pop Icons', 'Global Pop Icons');
    expect(qs.length).toBeGreaterThanOrEqual(4);
    expect(qs.some((q) => /vinyl|concert|microphone|guitar|festival/i.test(q))).toBe(
      true,
    );
  });
});

describe('subjectKeyFromTitle + diversifyTopicHits', () => {
  it('collapses Great Gatsby movie-set variants to one subject', () => {
    const a = subjectKeyFromTitle('Great Gatsby Movie Set 2013');
    const b = subjectKeyFromTitle('The Great Gatsby Movie Set');
    expect(a).toBe(b);
  });

  it('caps results at two per subject', () => {
    const hits = Array.from({ length: 8 }, (_, i) => ({
      url: `https://example.com/${i}.jpg`,
      thumb: `https://example.com/${i}.jpg`,
      alt: `Great Gatsby Movie Set ${i}`,
      score: 10 - i,
      subject: subjectKeyFromTitle(`Great Gatsby Movie Set ${i}`),
      sourceQuery: 'movie',
    }));
    // Force same subject
    for (const h of hits) h.subject = 'great gatsby';
    const picked = diversifyTopicHits(hits, 12, { perSubject: 2, perQuery: 10 });
    expect(picked.length).toBe(2);
  });

  it('interleaves subjects so one query cannot dominate', () => {
    const hits = [
      ...Array.from({ length: 5 }, (_, i) => ({
        url: `https://ex.com/gatsby-${i}.jpg`,
        thumb: `https://ex.com/gatsby-${i}.jpg`,
        alt: `Gatsby still ${i}`,
        score: 9,
        subject: 'gatsby',
        sourceQuery: 'movie set',
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        url: `https://ex.com/cinema-${i}.jpg`,
        thumb: `https://ex.com/cinema-${i}.jpg`,
        alt: `Cinema seats ${i}`,
        score: 8,
        subject: 'cinema seats',
        sourceQuery: 'cinema seats',
      })),
    ];
    const picked = diversifyTopicHits(hits, 6, { perSubject: 2, perQuery: 3 });
    const subjects = new Set(
      picked.map((p) => subjectKeyFromTitle(p.alt).split(' ')[0]),
    );
    expect(picked.length).toBeGreaterThan(2);
    expect(subjects.size).toBeGreaterThan(1);
  });
});

describe('spoiler filtering', () => {
  it('extracts accepted answers and option labels as spoiler terms', () => {
    const terms = spoilerTermsFromQuestions([
      {
        wording: 'Who wrote The Great Gatsby?',
        answer_spec: {
          format: 'short_answer',
          data: { acceptedAnswers: ['F. Scott Fitzgerald', 'Fitzgerald'] },
        },
      },
      {
        wording: 'Pick the singer',
        answer_spec: {
          format: 'multiple_choice',
          data: {
            options: [
              { id: 'a', label: 'Cody Simpson' },
              { id: 'b', label: 'Someone Else' },
            ],
          },
        },
        media_alt: 'Cody Simpson portrait',
      },
    ]);
    expect(terms.some((t) => t.includes('fitzgerald'))).toBe(true);
    expect(terms.some((t) => t.includes('cody') || t.includes('simpson'))).toBe(
      true,
    );
  });

  it('flags titles that match spoiler terms', () => {
    expect(
      titleLooksLikeSpoiler('Cody Simpson on stage', ['cody simpson', 'fitzgerald']),
    ).toBe(true);
    expect(
      titleLooksLikeSpoiler('vinyl record collection', ['cody simpson', 'fitzgerald']),
    ).toBe(false);
  });
});
