-- Migration 0033: resolve automation safety global kill switch via flowdesk_system capability
-- Fixes M5 #177: global killswitch rows were invisible to resolve_automation_safety
-- because flowdesk.automation_safety_controls has FORCE RLS with a policy excluding
-- global rows, while the function was owned by flowdesk_migrator (NOBYPASSRLS).
-- By granting SELECT to flowdesk_system (BYPASSRLS) and transferring function ownership,
-- the narrow security-definer boundary can safely inspect global stops without exposing
-- global rows directly to flowdesk_runtime.

GRANT USAGE ON SCHEMA flowdesk TO flowdesk_system;
GRANT SELECT ON flowdesk.automation_safety_controls TO flowdesk_system;

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
    AND (control.expires_at IS NULL OR control.expires_at > now())
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

ALTER FUNCTION flowdesk.resolve_automation_safety(uuid, uuid, uuid, uuid) OWNER TO flowdesk_system;
REVOKE ALL ON FUNCTION flowdesk.resolve_automation_safety(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flowdesk.resolve_automation_safety(uuid, uuid, uuid, uuid)
  TO flowdesk_runtime, flowdesk_system, flowdesk_reporting;
