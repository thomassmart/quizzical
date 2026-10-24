/** Host-facing labels for question.status values. */
export function questionStatusLabel(status: string): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'proposed':
      return 'Needs review';
    case 'approved':
      return 'Ready';
    case 'reserved':
      return 'In night';
    case 'used':
      return 'Played';
    case 'revealed_abandoned':
      return 'Shown, unused';
    case 'dismissed':
      return 'Dismissed';
    default:
      return status;
  }
}
