/** Host-facing label — no draft/committed wording. */
export function eventStateLabel(state: string): string {
  switch (state) {
    case 'draft':
    case 'ready':
      return 'Prep';
    case 'lobby':
      return 'Lobby';
    case 'rules':
      return 'Rules';
    case 'section_active':
      return 'Section';
    case 'question_revealed':
      return 'Question up';
    case 'answer_open':
      return 'Answers open';
    case 'answer_closed':
      return 'Answers closed';
    case 'section_marking':
      return 'Marking';
    case 'section_reveal':
      return 'Reveal';
    case 'finished':
      return 'Finished';
    case 'abandoned':
      return 'Abandoned';
    default:
      return state;
  }
}
