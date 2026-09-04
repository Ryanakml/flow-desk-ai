-- Migration 0035: M6 Developer Webhooks Delivery Engine and Analytics Aggregates

-- 1. Developer Webhook Deliveries Table
CREATE TABLE IF NOT EXISTS flowdesk.webhook_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    subscription_id uuid NOT NULL REFERENCES flowdesk.webhook_subscriptions(id) ON DELETE CASCADE,
    event_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'dead_letter')),
    attempt_count integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 5,
    next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    delivered_at timestamptz,
    response_status_code integer,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_webhook_subscription_event UNIQUE (subscription_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org_created
    ON flowdesk.webhook_deliveries (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending
    ON flowdesk.webhook_deliveries (status, next_attempt_at)
    WHERE status IN ('pending', 'failed');

ALTER TABLE flowdesk.webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.webhook_deliveries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_webhook_deliveries ON flowdesk.webhook_deliveries;
CREATE POLICY tenant_isolation_webhook_deliveries ON flowdesk.webhook_deliveries
    FOR ALL
    TO PUBLIC
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());

-- 2. Hourly Analytics Aggregates Table
CREATE TABLE IF NOT EXISTS flowdesk.analytics_aggregates_hourly (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    bucket_start timestamptz NOT NULL,
    inbound_count integer NOT NULL DEFAULT 0,
    outbound_count integer NOT NULL DEFAULT 0,
    bot_count integer NOT NULL DEFAULT 0,
    human_count integer NOT NULL DEFAULT 0,
    conversations_created integer NOT NULL DEFAULT 0,
    conversations_resolved integer NOT NULL DEFAULT 0,
    first_response_count integer NOT NULL DEFAULT 0,
    first_response_total_seconds integer NOT NULL DEFAULT 0,
    resolution_count integer NOT NULL DEFAULT 0,
    resolution_total_seconds integer NOT NULL DEFAULT 0,
    sla_met_count integer NOT NULL DEFAULT 0,
    sla_breach_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_analytics_aggregates_hourly_org_bucket UNIQUE (organization_id, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_analytics_aggregates_org_bucket
    ON flowdesk.analytics_aggregates_hourly (organization_id, bucket_start DESC);

ALTER TABLE flowdesk.analytics_aggregates_hourly ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.analytics_aggregates_hourly FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_analytics_aggregates_hourly ON flowdesk.analytics_aggregates_hourly;
CREATE POLICY tenant_isolation_analytics_aggregates_hourly ON flowdesk.analytics_aggregates_hourly
    FOR ALL
    TO PUBLIC
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());

-- 3. Analytics Aggregation Watermarks Table
CREATE TABLE IF NOT EXISTS flowdesk.analytics_watermarks (
    organization_id uuid PRIMARY KEY REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    last_aggregated_at timestamptz NOT NULL DEFAULT to_timestamp(0),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE flowdesk.analytics_watermarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.analytics_watermarks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_analytics_watermarks ON flowdesk.analytics_watermarks;
CREATE POLICY tenant_isolation_analytics_watermarks ON flowdesk.analytics_watermarks
    FOR ALL
    TO PUBLIC
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());

-- 4. Grants to Runtime and Reporting Roles
GRANT SELECT, INSERT, UPDATE, DELETE ON
    flowdesk.webhook_deliveries,
    flowdesk.analytics_aggregates_hourly,
    flowdesk.analytics_watermarks
TO flowdesk_runtime;

GRANT SELECT ON
    flowdesk.webhook_deliveries,
    flowdesk.analytics_aggregates_hourly,
    flowdesk.analytics_watermarks
TO flowdesk_reporting;
