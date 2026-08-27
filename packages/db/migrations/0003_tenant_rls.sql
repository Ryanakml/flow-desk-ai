-- M1-03: tenant policies. Runtime queries require transaction-scoped app.organization_id.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA flowdesk TO flowdesk_runtime;

ALTER TABLE flowdesk.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.organization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.roles FORCE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.organization_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.idempotency_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.outbox_events FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION flowdesk.current_organization_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid $$;

CREATE POLICY organizations_tenant ON flowdesk.organizations
  USING (id = flowdesk.current_organization_id()) WITH CHECK (id = flowdesk.current_organization_id());
CREATE POLICY roles_tenant ON flowdesk.roles
  USING (organization_id = flowdesk.current_organization_id()) WITH CHECK (organization_id = flowdesk.current_organization_id());
CREATE POLICY memberships_tenant ON flowdesk.memberships
  USING (organization_id = flowdesk.current_organization_id()) WITH CHECK (organization_id = flowdesk.current_organization_id());
CREATE POLICY organization_settings_tenant ON flowdesk.organization_settings
  USING (organization_id = flowdesk.current_organization_id()) WITH CHECK (organization_id = flowdesk.current_organization_id());
CREATE POLICY audit_logs_tenant ON flowdesk.audit_logs
  USING (organization_id = flowdesk.current_organization_id()) WITH CHECK (organization_id = flowdesk.current_organization_id());
CREATE POLICY idempotency_keys_tenant ON flowdesk.idempotency_keys
  USING (organization_id = flowdesk.current_organization_id()) WITH CHECK (organization_id = flowdesk.current_organization_id());
CREATE POLICY outbox_events_tenant ON flowdesk.outbox_events
  USING (organization_id = flowdesk.current_organization_id()) WITH CHECK (organization_id = flowdesk.current_organization_id());
