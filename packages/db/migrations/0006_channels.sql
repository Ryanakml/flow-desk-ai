-- M2-01: Channels table and tenant isolation RLS policy.

CREATE TABLE flowdesk.channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('whatsapp')),
  name text NOT NULL CHECK (length(trim(name)) >= 1 AND length(name) <= 100),
  phone_number_id text NOT NULL,
  waba_id text NOT NULL,
  encrypted_credentials text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'connecting', 'active', 'degraded', 'disconnected')),
  status_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, phone_number_id)
);

CREATE INDEX channels_org_status_idx ON flowdesk.channels (organization_id, status, id);
CREATE INDEX channels_phone_number_id_idx ON flowdesk.channels (phone_number_id);

ALTER TABLE flowdesk.channels OWNER TO flowdesk_migrator;
GRANT SELECT, INSERT, UPDATE, DELETE ON flowdesk.channels TO flowdesk_runtime;
GRANT SELECT ON flowdesk.channels TO flowdesk_reporting;

ALTER TABLE flowdesk.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.channels FORCE ROW LEVEL SECURITY;

CREATE POLICY channels_tenant ON flowdesk.channels
  USING (organization_id = flowdesk.current_organization_id())
  WITH CHECK (organization_id = flowdesk.current_organization_id());
