-- Migration 0016: M3 Media Lifecycle — Deletion, Tombstoning, and Retention
-- Adds soft-deletion columns to flowdesk.attachments for retention policy enforcement.

ALTER TABLE flowdesk.attachments
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_reason text;

-- Index for retention expiry job: quickly find expired, non-deleted attachments
CREATE INDEX IF NOT EXISTS idx_attachments_org_status_deleted
  ON flowdesk.attachments (organization_id, status, deleted_at)
  WHERE deleted_at IS NULL;

-- Index for cleanup reconciliation: recently deleted attachments
CREATE INDEX IF NOT EXISTS idx_attachments_deleted_at
  ON flowdesk.attachments (deleted_at)
  WHERE deleted_at IS NOT NULL;

ALTER TABLE flowdesk.attachments OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.attachment_upload_sessions OWNER TO flowdesk_migrator;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  flowdesk.attachments, flowdesk.attachment_upload_sessions TO flowdesk_runtime;
GRANT SELECT ON flowdesk.attachments, flowdesk.attachment_upload_sessions TO flowdesk_reporting;

GRANT SELECT ON flowdesk.attachments TO flowdesk_system;

CREATE OR REPLACE FUNCTION flowdesk.claim_attachment_scan_events(input_limit integer)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  aggregate_type text,
  aggregate_id uuid,
  event_type text,
  payload jsonb,
  correlation_id uuid,
  causation_id uuid,
  occurred_at timestamptz,
  attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, flowdesk
AS $$
BEGIN
  IF input_limit < 1 OR input_limit > 100 THEN
    RAISE EXCEPTION 'Attachment scan claim limit must be between 1 and 100';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT event.id
    FROM flowdesk.outbox_events AS event
    WHERE event.event_type = 'attachment.uploaded'
      AND event.published_at IS NULL
      AND event.available_at <= clock_timestamp()
      AND (event.claimed_until IS NULL OR event.claimed_until < clock_timestamp())
    ORDER BY event.occurred_at
    FOR UPDATE SKIP LOCKED
    LIMIT input_limit
  ), claimed AS (
    UPDATE flowdesk.outbox_events AS event
    SET claim_token = gen_random_uuid(),
        claimed_until = clock_timestamp() + interval '30 seconds'
    FROM candidates
    WHERE event.id = candidates.id
    RETURNING event.id, event.organization_id, event.aggregate_type,
      event.aggregate_id, event.event_type, event.payload, event.correlation_id,
      event.causation_id, event.occurred_at, event.attempts
  )
  SELECT claimed.id, claimed.organization_id, claimed.aggregate_type,
    claimed.aggregate_id, claimed.event_type, claimed.payload,
    claimed.correlation_id, claimed.causation_id, claimed.occurred_at, claimed.attempts
  FROM claimed;
END $$;

ALTER FUNCTION flowdesk.claim_attachment_scan_events(integer) OWNER TO flowdesk_system;
REVOKE ALL ON FUNCTION flowdesk.claim_attachment_scan_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flowdesk.claim_attachment_scan_events(integer) TO flowdesk_runtime;

CREATE OR REPLACE FUNCTION flowdesk.list_attachment_retention_candidates(
  clean_before timestamptz,
  rejected_before timestamptz,
  candidate_limit integer DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  storage_key text,
  status text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, flowdesk
AS $$
  SELECT attachment.id, attachment.organization_id, attachment.storage_key,
         attachment.status, attachment.created_at
  FROM flowdesk.attachments AS attachment
  WHERE attachment.deleted_at IS NULL
    AND (
      (attachment.status = 'rejected' AND attachment.created_at < rejected_before)
      OR (attachment.status IN ('clean', 'quarantine') AND attachment.created_at < clean_before)
    )
  ORDER BY attachment.created_at
  LIMIT GREATEST(1, LEAST(candidate_limit, 500))
$$;

ALTER FUNCTION flowdesk.list_attachment_retention_candidates(timestamptz, timestamptz, integer)
  OWNER TO flowdesk_system;
REVOKE ALL ON FUNCTION flowdesk.list_attachment_retention_candidates(timestamptz, timestamptz, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flowdesk.list_attachment_retention_candidates(timestamptz, timestamptz, integer)
  TO flowdesk_runtime;
