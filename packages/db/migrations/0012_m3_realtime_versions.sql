-- M3-03: monotonic tenant projection versions for recoverable realtime hints.

CREATE TABLE flowdesk.realtime_versions (
  organization_id uuid PRIMARY KEY REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO flowdesk.realtime_versions (organization_id, version)
SELECT id, 0 FROM flowdesk.organizations
ON CONFLICT (organization_id) DO NOTHING;

CREATE OR REPLACE FUNCTION flowdesk.bump_realtime_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE target_organization_id uuid;
BEGIN
  target_organization_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  INSERT INTO flowdesk.realtime_versions (organization_id, version)
  VALUES (target_organization_id, 1)
  ON CONFLICT (organization_id)
  DO UPDATE SET version = flowdesk.realtime_versions.version + 1,
                updated_at = clock_timestamp();
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER conversations_bump_realtime_version
AFTER INSERT OR UPDATE OR DELETE ON flowdesk.conversations
FOR EACH ROW EXECUTE FUNCTION flowdesk.bump_realtime_version();

CREATE TRIGGER messages_bump_realtime_version
AFTER INSERT OR UPDATE OR DELETE ON flowdesk.messages
FOR EACH ROW EXECUTE FUNCTION flowdesk.bump_realtime_version();

ALTER TABLE flowdesk.realtime_versions OWNER TO flowdesk_migrator;
GRANT SELECT, INSERT, UPDATE ON flowdesk.realtime_versions TO flowdesk_runtime;
GRANT SELECT ON flowdesk.realtime_versions TO flowdesk_reporting;
ALTER TABLE flowdesk.realtime_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.realtime_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY realtime_versions_tenant ON flowdesk.realtime_versions
  USING (organization_id = flowdesk.current_organization_id())
  WITH CHECK (organization_id = flowdesk.current_organization_id());
