-- Migration 0015: M3 Media Quarantine & Attachment Upload Sessions
-- Enforces private quarantine, status tracking, and tenant isolation for media assets.

CREATE TABLE IF NOT EXISTS flowdesk.attachments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    uploader_user_id uuid REFERENCES flowdesk.users(id) ON DELETE SET NULL,
    file_name text NOT NULL,
    content_type text NOT NULL,
    detected_mime_type text,
    byte_size bigint NOT NULL CHECK (byte_size > 0),
    sha256_checksum text,
    storage_key text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'quarantine' CHECK (status IN ('quarantine', 'clean', 'rejected')),
    quarantine_reason text,
    scanned_at timestamptz,
    scanner_name text,
    scan_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flowdesk.attachment_upload_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    attachment_id uuid NOT NULL REFERENCES flowdesk.attachments(id) ON DELETE CASCADE,
    uploader_user_id uuid REFERENCES flowdesk.users(id) ON DELETE SET NULL,
    upload_url text NOT NULL,
    expires_at timestamptz NOT NULL,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Force Row-Level Security
ALTER TABLE flowdesk.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.attachments FORCE ROW LEVEL SECURITY;

ALTER TABLE flowdesk.attachment_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.attachment_upload_sessions FORCE ROW LEVEL SECURITY;

-- Tenant Isolation Policies
DROP POLICY IF EXISTS attachments_tenant_isolation ON flowdesk.attachments;
CREATE POLICY attachments_tenant_isolation ON flowdesk.attachments
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());

DROP POLICY IF EXISTS attachment_upload_sessions_tenant_isolation ON flowdesk.attachment_upload_sessions;
CREATE POLICY attachment_upload_sessions_tenant_isolation ON flowdesk.attachment_upload_sessions
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());

-- Indexes for performance and quarantine processing
CREATE INDEX IF NOT EXISTS idx_attachments_org_status ON flowdesk.attachments (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_attachments_org_created ON flowdesk.attachments (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_org_attachment ON flowdesk.attachment_upload_sessions (organization_id, attachment_id);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_org_expires ON flowdesk.attachment_upload_sessions (organization_id, expires_at);
