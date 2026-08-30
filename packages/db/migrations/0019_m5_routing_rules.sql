-- Migration 0019: M5 Automated Conversation Routing Rules and Audit Logs
-- Adds support for tenant-isolated routing rules, condition matching, and routing execution logs.

CREATE TABLE IF NOT EXISTS flowdesk.routing_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(trim(name)) >= 1 AND length(name) <= 200),
    priority integer NOT NULL DEFAULT 100 CHECK (priority >= 0),
    conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
    target_queue_id uuid,
    target_team_id uuid,
    target_user_id uuid REFERENCES flowdesk.users(id) ON DELETE SET NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (organization_id, target_queue_id) REFERENCES flowdesk.queues(organization_id, id) ON DELETE SET NULL,
    FOREIGN KEY (organization_id, target_team_id) REFERENCES flowdesk.teams(organization_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS flowdesk.routing_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL REFERENCES flowdesk.conversations(id) ON DELETE CASCADE,
    matched_rule_id uuid REFERENCES flowdesk.routing_rules(id) ON DELETE SET NULL,
    target_queue_id uuid,
    target_team_id uuid,
    target_user_id uuid REFERENCES flowdesk.users(id) ON DELETE SET NULL,
    reason text NOT NULL CHECK (length(trim(reason)) > 0),
    routed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (organization_id, target_queue_id) REFERENCES flowdesk.queues(organization_id, id) ON DELETE SET NULL,
    FOREIGN KEY (organization_id, target_team_id) REFERENCES flowdesk.teams(organization_id, id) ON DELETE SET NULL
);

-- Indexes for efficient rule lookup and execution logs
CREATE INDEX IF NOT EXISTS idx_routing_rules_org_priority ON flowdesk.routing_rules(organization_id, priority ASC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_routing_rules_org_active ON flowdesk.routing_rules(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_routing_logs_org_conv ON flowdesk.routing_logs(organization_id, conversation_id);

-- Enforce Row Level Security (RLS) on routing tables
ALTER TABLE flowdesk.routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.routing_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE flowdesk.routing_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.routing_logs FORCE ROW LEVEL SECURITY;

-- Tenant isolation RLS policies
DROP POLICY IF EXISTS tenant_isolation_routing_rules ON flowdesk.routing_rules;
CREATE POLICY tenant_isolation_routing_rules ON flowdesk.routing_rules
    FOR ALL
    TO PUBLIC
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());

DROP POLICY IF EXISTS tenant_isolation_routing_logs ON flowdesk.routing_logs;
CREATE POLICY tenant_isolation_routing_logs ON flowdesk.routing_logs
    FOR ALL
    TO PUBLIC
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());

-- Ownership & Permission Grants
ALTER TABLE flowdesk.routing_rules OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.routing_logs OWNER TO flowdesk_migrator;

GRANT SELECT, INSERT, UPDATE, DELETE ON
    flowdesk.routing_rules,
    flowdesk.routing_logs
TO flowdesk_runtime;
