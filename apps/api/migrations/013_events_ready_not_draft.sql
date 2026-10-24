-- Drop the prep "draft" concept: events awaiting lobby are "ready".
UPDATE events SET state = 'ready' WHERE state = 'draft';

-- Questions are live as soon as they are added (no draft/proposed gate).
UPDATE questions
SET status = 'approved', updated_at = now()
WHERE status IN ('draft', 'proposed');
