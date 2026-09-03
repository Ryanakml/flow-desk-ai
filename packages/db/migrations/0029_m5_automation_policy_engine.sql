-- Migration 0029: M5 Automation Policy Configuration, Versioning, Simulator, and Decision Traces
-- Supports immutable published policy versions, draft lifecycle, fail-closed rule evaluation, and decision traces.

CREATE TABLE IF NOT EXISTS flowdesk.automation_policies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    version integer NOT NULL CHECK (version >= 1),
    status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
    name text NOT NULL DEFAULT 'Default Policy' CHECK (length(trim(name)) >= 1 AND length(name) <= 200),
    rules jsonb NOT NULL DEFAULT '[]'::jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by_user_id uuid REFERENCES flowdesk.users(id) ON DELETE SET NULL,
    published_by_user_id uuid REFERENCES flowdesk.users(id) ON DELETE SET NULL,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT automation_policies_org_version_key UNIQUE (organization_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS automation_policies_single_published_per_org
    ON flowdesk.automation_policies (organization_id) WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_automation_policies_org_status
    ON flowdesk.automation_policies (organization_id, status, version DESC);

-- Enforce immutability of published rules and archived policies
CREATE OR REPLACE FUNCTION flowdesk.enforce_automation_policy_immutability()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'published' AND NEW.status = 'published' AND OLD.rules::text <> NEW.rules::text THEN
    RAISE EXCEPTION 'Cannot modify rules of a published automation policy; create a new draft version instead'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'archived' THEN
    RAISE EXCEPTION 'Cannot modify an archived automation policy'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS automation_policy_immutability_trigger ON flowdesk.automation_policies;
CREATE TRIGGER automation_policy_immutability_trigger
  BEFORE UPDATE ON flowdesk.automation_policies
  FOR EACH ROW
  EXECUTE FUNCTION flowdesk.enforce_automation_policy_immutability();

-- Enhance routing_logs with structured decision trace, policy version, and inputs snapshot
ALTER TABLE flowdesk.routing_logs
  ADD COLUMN IF NOT EXISTS policy_id uuid REFERENCES flowdesk.automation_policies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS policy_version integer,
  ADD COLUMN IF NOT EXISTS decision_trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS inputs_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_routing_logs_policy ON flowdesk.routing_logs (organization_id, policy_id, policy_version);

-- Enable RLS
ALTER TABLE flowdesk.automation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.automation_policies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_automation_policies ON flowdesk.automation_policies;
CREATE POLICY tenant_isolation_automation_policies ON flowdesk.automation_policies
    FOR ALL
    TO PUBLIC
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());

-- Ownership and grants
ALTER TABLE flowdesk.automation_policies OWNER TO flowdesk_migrator;
GRANT SELECT, INSERT, UPDATE, DELETE ON flowdesk.automation_policies TO flowdesk_runtime;
GRANT SELECT ON flowdesk.automation_policies TO flowdesk_reporting;
