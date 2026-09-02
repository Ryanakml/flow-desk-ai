-- Migration 0028: durable M5 automation safety controls and takeover cancellation support

CREATE TABLE IF NOT EXISTS flowdesk.automation_safety_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('global', 'tenant', 'bot', 'channel', 'conversation')),
  scope_id uuid,
  disabled boolean NOT NULL DEFAULT true,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  actor_user_id uuid REFERENCES flowdesk.users(id) ON DELETE SET NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (scope = 'global' AND organization_id IS NULL AND scope_id IS NULL)
    OR (scope = 'tenant' AND organization_id IS NOT NULL AND scope_id IS NULL)
    OR (scope IN ('bot', 'channel', 'conversation') AND organization_id IS NOT NULL AND scope_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS automation_safety_global_unique
  ON flowdesk.automation_safety_controls ((scope)) WHERE scope = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS automation_safety_tenant_unique
  ON flowdesk.automation_safety_controls (organization_id, scope) WHERE scope = 'tenant';
CREATE UNIQUE INDEX IF NOT EXISTS automation_safety_scoped_unique
  ON flowdesk.automation_safety_controls (organization_id, scope, scope_id)
  WHERE scope IN ('bot', 'channel', 'conversation');
CREATE INDEX IF NOT EXISTS automation_safety_active_lookup
  ON flowdesk.automation_safety_controls (organization_id, scope, scope_id, disabled, expires_at);

ALTER TABLE flowdesk.automation_safety_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.automation_safety_controls FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_automation_safety_controls ON flowdesk.automation_safety_controls;
CREATE POLICY tenant_isolation_automation_safety_controls
  ON flowdesk.automation_safety_controls
  FOR ALL
  TO PUBLIC
  USING (
    scope <> 'global'
    AND organization_id = flowdesk.current_organization_id()
  )
  WITH CHECK (
    scope <> 'global'
    AND organization_id = flowdesk.current_organization_id()
  );

ALTER TABLE flowdesk.automation_safety_controls OWNER TO flowdesk_migrator;
GRANT SELECT, INSERT, UPDATE, DELETE ON flowdesk.automation_safety_controls TO flowdesk_runtime;
GRANT SELECT ON flowdesk.automation_safety_controls TO flowdesk_reporting;

-- Resolve active safety state through a narrow SECURITY DEFINER boundary so a runtime tenant can
-- observe the global stop without receiving direct RLS access to the global row.
CREATE OR REPLACE FUNCTION flowdesk.resolve_automation_safety(
  input_organization_id uuid,
  input_bot_config_id uuid DEFAULT NULL,
  input_channel_id uuid DEFAULT NULL,
  input_conversation_id uuid DEFAULT NULL
)
RETURNS TABLE (
  control_id uuid,
  scope text,
  reason text,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = flowdesk, pg_temp
AS $$
  SELECT control.id, control.scope, control.reason, control.expires_at
  FROM flowdesk.automation_safety_controls AS control
  WHERE control.disabled = true
    AND (control.expires_at IS NULL OR control.expires_at > clock_timestamp())
    AND (
      control.scope = 'global'
      OR (control.scope = 'tenant' AND control.organization_id = input_organization_id)
      OR (
        control.scope = 'bot'
        AND control.organization_id = input_organization_id
        AND control.scope_id = input_bot_config_id
      )
      OR (
        control.scope = 'channel'
        AND control.organization_id = input_organization_id
        AND control.scope_id = input_channel_id
      )
      OR (
        control.scope = 'conversation'
        AND control.organization_id = input_organization_id
        AND control.scope_id = input_conversation_id
      )
    )
  ORDER BY CASE control.scope
    WHEN 'global' THEN 1
    WHEN 'tenant' THEN 2
    WHEN 'bot' THEN 3
    WHEN 'channel' THEN 4
    WHEN 'conversation' THEN 5
    ELSE 99 END
  LIMIT 1;
$$;

ALTER FUNCTION flowdesk.resolve_automation_safety(uuid, uuid, uuid, uuid) OWNER TO flowdesk_migrator;
REVOKE ALL ON FUNCTION flowdesk.resolve_automation_safety(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flowdesk.resolve_automation_safety(uuid, uuid, uuid, uuid)
  TO flowdesk_runtime, flowdesk_system, flowdesk_reporting;
