import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition } from './transitions.js';

describe('event transitions', () => {
  it('allows draft → ready → lobby → rules → section_active', () => {
    expect(canTransition('draft', 'ready')).toBe(true);
    expect(canTransition('ready', 'lobby')).toBe(true);
    expect(canTransition('lobby', 'rules')).toBe(true);
    expect(canTransition('rules', 'section_active')).toBe(true);
    expect(canTransition('lobby', 'section_active')).toBe(false);
  });

  it('prevents double-start style jumps', () => {
    expect(canTransition('lobby', 'answer_open')).toBe(false);
    expect(canTransition('draft', 'answer_open')).toBe(false);
    expect(canTransition('finished', 'lobby')).toBe(false);
  });

  it('allows abandon from active states', () => {
    expect(canTransition('answer_open', 'abandoned')).toBe(true);
    expect(canTransition('section_marking', 'abandoned')).toBe(true);
  });

  it('assertTransition throws on invalid', () => {
    expect(() => assertTransition('finished', 'lobby')).toThrow(/Invalid/);
  });
});
