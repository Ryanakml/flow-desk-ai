-- Migration 0020: M6 Developer Integrations (API Keys and Outbound Webhook Subscriptions)

CREATE TABLE IF NOT EXISTS flowdesk.api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(trim(name)) >= 1 AND length(name) <= 200),
    key_prefix text NOT NULL CHECK (length(key_prefix) >= 4),
    key_hash text NOT NULL CHECK (length(key_hash) = 64),
    scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by_user_id uuid REFERENCES flowdesk.users(id) ON DELETE SET NULL,
    expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS flowdesk.webhook_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(trim(name)) >= 1 AND length(name) <= 200),
    url text NOT NULL CHECK (length(url) >= 8),
    secret text NOT NULL CHECK (length(secret) >= 16),
    events jsonb NOT NULL DEFAULT '[]'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Indexes for efficient lookup
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON flowdesk.api_keys(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON flowdesk.api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_webhook_subs_org ON flowdesk.webhook_subscriptions(organization_id, created_at DESC);

-- Enable RLS
ALTER TABLE flowdesk.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.api_keys FORCE ROW LEVEL SECURITY;

ALTER TABLE flowdesk.webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.webhook_subscriptions FORCE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS tenant_isolation_api_keys ON flowdesk.api_keys;
CREATE POLICY tenant_isolation_api_keys ON flowdesk.api_keys
    FOR ALL
    TO PUBLIC
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());

DROP POLICY IF EXISTS tenant_isolation_webhook_subscriptions ON flowdesk.webhook_subscriptions;
CREATE POLICY tenant_isolation_webhook_subscriptions ON flowdesk.webhook_subscriptions
    FOR ALL
    TO PUBLIC
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());
