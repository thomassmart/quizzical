import type { EventState } from '../types/index.js';

/** Valid directed transitions for live event control. */
const TRANSITIONS: Record<EventState, EventState[]> = {
  draft: ['ready', 'abandoned'],
  ready: ['lobby', 'draft', 'abandoned'],
  lobby: ['rules', 'abandoned'],
  rules: ['section_active', 'abandoned'],
  section_active: ['question_revealed', 'section_marking', 'abandoned'],
  question_revealed: ['answer_open', 'answer_closed', 'abandoned'],
  answer_open: ['answer_closed', 'abandoned'],
  answer_closed: ['question_revealed', 'section_marking', 'abandoned'],
  section_marking: ['section_reveal', 'abandoned'],
  section_reveal: ['section_active', 'finished', 'abandoned'],
  finished: [],
  abandoned: [],
};

export function canTransition(from: EventState, to: EventState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: EventState, to: EventState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid event transition: ${from} → ${to}`);
  }
}

export function allowedTransitions(from: EventState): EventState[] {
  return [...(TRANSITIONS[from] ?? [])];
}
