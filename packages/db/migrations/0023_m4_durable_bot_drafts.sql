-- M4-R3/R4: durable AI draft jobs and approval-safe audit state.

ALTER TABLE flowdesk.bot_runs
  DROP CONSTRAINT IF EXISTS bot_runs_status_check;

UPDATE flowdesk.bot_runs
SET status = CASE status
  WHEN 'started' THEN 'processing'
  WHEN 'failed' THEN 'provider_failed'
  WHEN 'fallback_no_evidence' THEN 'no_evidence'
  ELSE status
END;

ALTER TABLE flowdesk.bot_runs
  ADD CONSTRAINT bot_runs_status_check CHECK (
    status IN (
      'queued', 'processing', 'completed', 'no_evidence', 'safety_blocked',
      'budget_exceeded', 'provider_failed', 'stale', 'cancelled', 'off'
    )
  ),
  ADD COLUMN IF NOT EXISTS requested_by_user_id uuid REFERENCES flowdesk.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS prompt_version text NOT NULL DEFAULT 'm4-v1',
  ADD COLUMN IF NOT EXISTS config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS input_message_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS error_code text;

-- Establish an initial immutable boundary for organizations that already had active
-- knowledge before durable ingestion started creating versions.
INSERT INTO flowdesk.knowledge_versions (
  organization_id, version_number, title, snapshot_metadata
)
SELECT source.organization_id,
       1,
       'Knowledge snapshot',
       jsonb_build_object(
         'activeSourceCount', COUNT(*),
         'activeSourceIds', jsonb_agg(source.id ORDER BY source.id)
       )
FROM flowdesk.knowledge_sources AS source
WHERE source.status = 'active'
  AND source.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM flowdesk.knowledge_versions AS version
    WHERE version.organization_id = source.organization_id
  )
GROUP BY source.organization_id
ON CONFLICT (organization_id, version_number) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS bot_runs_one_active_trigger_unique
  ON flowdesk.bot_runs (organization_id, conversation_id, trigger_message_id)
  WHERE trigger_message_id IS NOT NULL AND status IN ('queued', 'processing');

CREATE INDEX IF NOT EXISTS bot_runs_claim_idx
  ON flowdesk.bot_runs (available_at, created_at)
  WHERE status = 'queued';

CREATE OR REPLACE FUNCTION flowdesk.claim_bot_draft_runs(input_limit integer)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  conversation_id uuid,
  attempts integer,
  max_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, flowdesk
AS $$
BEGIN
  IF input_limit < 1 OR input_limit > 50 THEN
    RAISE EXCEPTION 'Bot draft claim limit must be between 1 and 50';
  END IF;

  UPDATE flowdesk.bot_runs AS run
  SET status = 'provider_failed',
      error_code = 'WORKER_LEASE_EXPIRED',
      error_detail = 'Draft generation stopped after the worker lease expired.',
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE run.status = 'processing'
    AND run.claimed_at < clock_timestamp() - interval '2 minutes'
    AND run.attempts >= run.max_attempts;

  RETURN QUERY
  WITH candidates AS (
    SELECT run.id
    FROM flowdesk.bot_runs AS run
    WHERE (run.status = 'queued'
           OR (run.status = 'processing'
               AND run.claimed_at < clock_timestamp() - interval '2 minutes'))
      AND run.attempts < run.max_attempts
      AND run.available_at <= clock_timestamp()
    ORDER BY run.available_at ASC, run.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT input_limit
  ), claimed AS (
    UPDATE flowdesk.bot_runs AS run
    SET status = 'processing',
        attempts = run.attempts + 1,
        claimed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    FROM candidates
    WHERE run.id = candidates.id
    RETURNING run.id, run.organization_id, run.conversation_id,
              run.attempts, run.max_attempts
  )
  SELECT claimed.id, claimed.organization_id, claimed.conversation_id,
         claimed.attempts, claimed.max_attempts
  FROM claimed;
END $$;

ALTER FUNCTION flowdesk.claim_bot_draft_runs(integer) OWNER TO flowdesk_system;
REVOKE ALL ON FUNCTION flowdesk.claim_bot_draft_runs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flowdesk.claim_bot_draft_runs(integer) TO flowdesk_runtime;
GRANT SELECT, UPDATE ON flowdesk.bot_runs TO flowdesk_system;
GRANT SELECT, INSERT, UPDATE ON flowdesk.realtime_versions TO flowdesk_system;

DROP TRIGGER IF EXISTS bot_runs_bump_realtime_version ON flowdesk.bot_runs;
CREATE TRIGGER bot_runs_bump_realtime_version
AFTER INSERT OR UPDATE ON flowdesk.bot_runs
FOR EACH ROW EXECUTE FUNCTION flowdesk.bump_realtime_version();
