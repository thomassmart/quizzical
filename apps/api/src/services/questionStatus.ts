import { query } from '../db/client.js';

/**
 * Status for a newly created/imported/approved question.
 * Matches freeze behaviour: once an event is past Prep (or already has a play
 * snapshot), questions join the night as `reserved` rather than bare `approved`.
 */
export async function statusForNewQuestion(
  eventId: string,
  approve: boolean,
): Promise<'draft' | 'approved' | 'reserved'> {
  if (!approve) return 'draft';
  const prepared = await eventIsPrepared(eventId);
  return prepared ? 'reserved' : 'approved';
}

/** True when the event has left Prep or already locked a play snapshot. */
export async function eventIsPrepared(eventId: string): Promise<boolean> {
  const { rows } = await query<{ state: string; snap_count: string }>(
    `SELECT e.state,
       (SELECT COUNT(*)::text FROM event_snapshots WHERE event_id = e.id) AS snap_count
     FROM events e WHERE e.id = $1`,
    [eventId],
  );
  const ev = rows[0];
  if (!ev) return false;
  return !['draft', 'ready'].includes(ev.state) || Number(ev.snap_count) > 0;
}

/**
 * Pure helper for tests / docs — same rules as eventIsPrepared without DB.
 */
export function computePreparedStatus(input: {
  approve: boolean;
  eventState: string;
  snapshotCount: number;
}): 'draft' | 'approved' | 'reserved' {
  if (!input.approve) return 'draft';
  const prepared =
    !['draft', 'ready'].includes(input.eventState) || input.snapshotCount > 0;
  return prepared ? 'reserved' : 'approved';
}
