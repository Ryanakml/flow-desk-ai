-- Migration 0013: M3 WhatsApp Templates Data Model, Versions, and Sync Tracking

CREATE TABLE IF NOT EXISTS flowdesk.whatsapp_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    channel_id uuid NOT NULL REFERENCES flowdesk.channels(id) ON DELETE CASCADE,
    name text NOT NULL,
    category text NOT NULL CHECK (category IN ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_whatsapp_templates_channel_name UNIQUE (channel_id, name)
);

CREATE TABLE IF NOT EXISTS flowdesk.whatsapp_template_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id uuid NOT NULL REFERENCES flowdesk.whatsapp_templates(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    provider_template_id text NOT NULL,
    language text NOT NULL,
    status text NOT NULL CHECK (status IN ('APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL')),
    rejected_reason text,
    components jsonb NOT NULL DEFAULT '[]'::jsonb,
    variable_count integer NOT NULL DEFAULT 0,
    payload_hash text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_whatsapp_template_versions_template_lang UNIQUE (template_id, language)
);

CREATE TABLE IF NOT EXISTS flowdesk.whatsapp_template_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_version_id uuid NOT NULL REFERENCES flowdesk.whatsapp_template_versions(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    from_status text CHECK (from_status IS NULL OR from_status IN ('APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL')),
    to_status text NOT NULL CHECK (to_status IN ('APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL')),
    reason text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS flowdesk.whatsapp_template_sync_cursors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    channel_id uuid NOT NULL REFERENCES flowdesk.channels(id) ON DELETE CASCADE,
    cursor text,
    last_synced_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_whatsapp_template_sync_cursors_channel UNIQUE (channel_id)
);

-- Enable and Force Row-Level Security
ALTER TABLE flowdesk.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.whatsapp_templates FORCE ROW LEVEL SECURITY;

ALTER TABLE flowdesk.whatsapp_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.whatsapp_template_versions FORCE ROW LEVEL SECURITY;

ALTER TABLE flowdesk.whatsapp_template_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.whatsapp_template_status_history FORCE ROW LEVEL SECURITY;

ALTER TABLE flowdesk.whatsapp_template_sync_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.whatsapp_template_sync_cursors FORCE ROW LEVEL SECURITY;

-- Tenant Isolation Policies
DROP POLICY IF EXISTS whatsapp_templates_tenant_isolation ON flowdesk.whatsapp_templates;
CREATE POLICY whatsapp_templates_tenant_isolation ON flowdesk.whatsapp_templates
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());

DROP POLICY IF EXISTS whatsapp_template_versions_tenant_isolation ON flowdesk.whatsapp_template_versions;
CREATE POLICY whatsapp_template_versions_tenant_isolation ON flowdesk.whatsapp_template_versions
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());

DROP POLICY IF EXISTS whatsapp_template_status_history_tenant_isolation ON flowdesk.whatsapp_template_status_history;
CREATE POLICY whatsapp_template_status_history_tenant_isolation ON flowdesk.whatsapp_template_status_history
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());

DROP POLICY IF EXISTS whatsapp_template_sync_cursors_tenant_isolation ON flowdesk.whatsapp_template_sync_cursors;
CREATE POLICY whatsapp_template_sync_cursors_tenant_isolation ON flowdesk.whatsapp_template_sync_cursors
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());

-- Indexes for Query Performance
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_org_channel ON flowdesk.whatsapp_templates (organization_id, channel_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_template_versions_org_template ON flowdesk.whatsapp_template_versions (organization_id, template_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_template_versions_provider ON flowdesk.whatsapp_template_versions (organization_id, provider_template_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_template_versions_status ON flowdesk.whatsapp_template_versions (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_template_status_history_version ON flowdesk.whatsapp_template_status_history (organization_id, template_version_id, created_at DESC);
