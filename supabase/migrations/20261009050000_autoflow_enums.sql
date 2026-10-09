-- AutoFlow end-to-end: new enum values (kept in their own migration because a new
-- enum value cannot be used in the same transaction that adds it).
ALTER TYPE public.timeline_event_type ADD VALUE IF NOT EXISTS 'automation';
ALTER TYPE public.timeline_event_type ADD VALUE IF NOT EXISTS 'document_request';
ALTER TYPE public.timeline_event_type ADD VALUE IF NOT EXISTS 'decision';
