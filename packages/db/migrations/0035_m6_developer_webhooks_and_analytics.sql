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

-- 4. Add verification_status to webhook_subscriptions
ALTER TABLE flowdesk.webhook_subscriptions
    ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'verified'
    CHECK (verification_status IN ('unverified', 'verified', 'failed'));

-- 5. Narrow System Functions for Bootstrap Authentication and Organization Discovery
GRANT USAGE ON SCHEMA flowdesk TO flowdesk_system;
GRANT SELECT ON flowdesk.api_keys, flowdesk.organizations TO flowdesk_system;

-- Narrow API key bootstrap authentication without weakening tenant FORCE RLS
CREATE OR REPLACE FUNCTION flowdesk.authenticate_api_key(p_key_hash text)
RETURNS TABLE (
    id uuid,
    organization_id uuid,
    name text,
    key_prefix text,
    scopes jsonb,
    created_by_user_id uuid,
    expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = flowdesk, pg_temp
AS $$
    SELECT id, organization_id, name, key_prefix, scopes, created_by_user_id, expires_at
    FROM flowdesk.api_keys
    WHERE key_hash = p_key_hash
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > clock_timestamp())
    LIMIT 1;
$$;

ALTER FUNCTION flowdesk.authenticate_api_key(text) OWNER TO flowdesk_system;
REVOKE ALL ON FUNCTION flowdesk.authenticate_api_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flowdesk.authenticate_api_key(text) TO flowdesk_runtime;

-- Narrow cross-tenant active organization discovery for background scheduler
CREATE OR REPLACE FUNCTION flowdesk.list_active_organization_ids()
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = flowdesk, pg_temp
AS $$
    SELECT id
    FROM flowdesk.organizations
    WHERE status = 'active'
      AND deleted_at IS NULL
    ORDER BY created_at ASC;
$$;

ALTER FUNCTION flowdesk.list_active_organization_ids() OWNER TO flowdesk_system;
REVOKE ALL ON FUNCTION flowdesk.list_active_organization_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flowdesk.list_active_organization_ids() TO flowdesk_runtime;

-- 6. Extend the existing narrow outbox claimer for developer webhook dispatches.
-- The worker already uses this SECURITY DEFINER function for durable queue claims;
-- M6 adds a third supported event type rather than granting direct cross-tenant queue access.
CREATE OR REPLACE FUNCTION flowdesk.claim_outbox_events(
    input_event_type text,
    input_limit integer
) RETURNS TABLE (
    id uuid,
    organization_id uuid,
    aggregate_type text,
    aggregate_id uuid,
    event_type text,
    payload jsonb,
    correlation_id uuid,
    causation_id uuid,
    occurred_at timestamptz,
    attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, flowdesk
AS $$
BEGIN
    IF input_event_type NOT IN (
        'webhook.received',
        'message.outbound.created',
        'developer.webhook.dispatch'
    ) THEN
        RAISE EXCEPTION 'Unsupported outbox event type';
    END IF;
    IF input_limit < 1 OR input_limit > 100 THEN
        RAISE EXCEPTION 'Outbox claim limit must be between 1 and 100';
    END IF;

    RETURN QUERY
    WITH candidates AS (
        SELECT event.id
        FROM flowdesk.outbox_events AS event
        WHERE event.event_type = input_event_type
          AND event.published_at IS NULL
          AND event.available_at <= clock_timestamp()
          AND (event.claimed_until IS NULL OR event.claimed_until < clock_timestamp())
        ORDER BY event.occurred_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT input_limit
    ), claimed AS (
        UPDATE flowdesk.outbox_events AS event
        SET claim_token = gen_random_uuid(),
            claimed_until = clock_timestamp() + interval '30 seconds'
        FROM candidates
        WHERE event.id = candidates.id
        RETURNING event.id, event.organization_id, event.aggregate_type,
          event.aggregate_id, event.event_type, event.payload, event.correlation_id,
          event.causation_id, event.occurred_at, event.attempts
    )
    SELECT claimed.id, claimed.organization_id, claimed.aggregate_type,
      claimed.aggregate_id, claimed.event_type, claimed.payload,
      claimed.correlation_id, claimed.causation_id, claimed.occurred_at,
      claimed.attempts
    FROM claimed;
END $$;

ALTER FUNCTION flowdesk.claim_outbox_events(text, integer) OWNER TO flowdesk_system;
REVOKE ALL ON FUNCTION flowdesk.claim_outbox_events(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flowdesk.claim_outbox_events(text, integer) TO flowdesk_runtime;

-- 7. Grants to Runtime and Reporting Roles
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

