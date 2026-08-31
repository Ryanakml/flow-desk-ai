-- M4-R2: durable, tenant-isolated knowledge ingestion jobs.

ALTER TABLE flowdesk.knowledge_sources
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_sources_org_dedupe_unique
  ON flowdesk.knowledge_sources (organization_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS flowdesk.knowledge_ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES flowdesk.knowledge_sources(id) ON DELETE CASCADE,
  dedupe_key text NOT NULL,
  input_text text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claimed_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_detail text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS knowledge_ingestion_jobs_claim_idx
  ON flowdesk.knowledge_ingestion_jobs (available_at, created_at)
  WHERE status = 'queued';

ALTER TABLE flowdesk.knowledge_ingestion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.knowledge_ingestion_jobs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_ingestion_jobs_tenant ON flowdesk.knowledge_ingestion_jobs;
CREATE POLICY knowledge_ingestion_jobs_tenant ON flowdesk.knowledge_ingestion_jobs
  USING (organization_id = flowdesk.current_organization_id())
  WITH CHECK (organization_id = flowdesk.current_organization_id());

ALTER TABLE flowdesk.knowledge_ingestion_jobs OWNER TO flowdesk_migrator;
GRANT SELECT, INSERT, UPDATE, DELETE ON flowdesk.knowledge_ingestion_jobs TO flowdesk_runtime;
GRANT SELECT ON flowdesk.knowledge_ingestion_jobs TO flowdesk_reporting;
GRANT SELECT, UPDATE ON flowdesk.knowledge_ingestion_jobs TO flowdesk_system;
GRANT SELECT, UPDATE ON flowdesk.knowledge_sources TO flowdesk_system;

CREATE OR REPLACE FUNCTION flowdesk.claim_knowledge_ingestion_jobs(input_limit integer)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  source_id uuid,
  attempts integer,
  max_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, flowdesk
AS $$
BEGIN
  IF input_limit < 1 OR input_limit > 50 THEN
    RAISE EXCEPTION 'Knowledge ingestion claim limit must be between 1 and 50';
  END IF;

  WITH exhausted AS (
    UPDATE flowdesk.knowledge_ingestion_jobs AS job
    SET status = 'failed', error_code = 'WORKER_LEASE_EXPIRED',
        error_detail = 'Knowledge ingestion stopped after the worker lease expired.',
        completed_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE job.status = 'processing'
      AND job.claimed_at < clock_timestamp() - interval '2 minutes'
      AND job.attempts >= job.max_attempts
    RETURNING job.source_id
  )
  UPDATE flowdesk.knowledge_sources AS source
  SET status = 'failed', status_reason = 'Knowledge ingestion worker lease expired.',
      updated_at = clock_timestamp()
  FROM exhausted
  WHERE source.id = exhausted.source_id;

  RETURN QUERY
  WITH candidates AS (
    SELECT job.id
    FROM flowdesk.knowledge_ingestion_jobs AS job
    WHERE (job.status = 'queued'
           OR (job.status = 'processing'
               AND job.claimed_at < clock_timestamp() - interval '2 minutes'))
      AND job.attempts < job.max_attempts
      AND job.available_at <= clock_timestamp()
    ORDER BY job.available_at ASC, job.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT input_limit
  ), claimed AS (
    UPDATE flowdesk.knowledge_ingestion_jobs AS job
    SET status = 'processing',
        attempts = job.attempts + 1,
        claimed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    FROM candidates
    WHERE job.id = candidates.id
    RETURNING job.id, job.organization_id, job.source_id, job.attempts, job.max_attempts
  )
  SELECT claimed.id, claimed.organization_id, claimed.source_id,
         claimed.attempts, claimed.max_attempts
  FROM claimed;
END $$;

ALTER FUNCTION flowdesk.claim_knowledge_ingestion_jobs(integer) OWNER TO flowdesk_system;
REVOKE ALL ON FUNCTION flowdesk.claim_knowledge_ingestion_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flowdesk.claim_knowledge_ingestion_jobs(integer) TO flowdesk_runtime;
