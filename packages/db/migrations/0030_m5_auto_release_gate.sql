-- Migration 0030: M5 AUTO release gate, staged tenant enablement, and safety evidence (#179)

-- 1. Create auto_release_gates table
CREATE TABLE IF NOT EXISTS flowdesk.auto_release_gates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    bot_config_id UUID NOT NULL REFERENCES flowdesk.bot_configs(id) ON DELETE CASCADE,
    policy_id UUID REFERENCES flowdesk.automation_policies(id) ON DELETE SET NULL,
    policy_version INTEGER NOT NULL DEFAULT 1,
    cohort VARCHAR(50) NOT NULL DEFAULT 'beta' CHECK (cohort IN ('internal', 'beta', 'general')),
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paused', 'revoked')),
    eval_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
    approvals JSONB NOT NULL DEFAULT '[]'::jsonb,
    sampling_rate NUMERIC(4,3) NOT NULL DEFAULT 0.100,
    rate_limit_per_hour INTEGER NOT NULL DEFAULT 60,
    monthly_cost_ceiling_cents INTEGER NOT NULL DEFAULT 50000,
    rollback_owner VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_auto_release_gates_org_bot
    ON flowdesk.auto_release_gates(organization_id, bot_config_id, status);

-- 2. Extend bot_configs with opt-in flags, consent, disclosure, and ceilings
ALTER TABLE flowdesk.bot_configs
    ADD COLUMN IF NOT EXISTS auto_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS customer_consent_required BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS ai_disclosure_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS rate_limit_per_hour INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN IF NOT EXISTS monthly_cost_ceiling_cents INTEGER NOT NULL DEFAULT 50000,
    ADD COLUMN IF NOT EXISTS active_release_gate_id UUID REFERENCES flowdesk.auto_release_gates(id) ON DELETE SET NULL;

-- 3. Row-Level Security
ALTER TABLE flowdesk.auto_release_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.auto_release_gates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auto_release_gates_tenant ON flowdesk.auto_release_gates;
CREATE POLICY auto_release_gates_tenant ON flowdesk.auto_release_gates
    FOR ALL
    USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- 4. Permissions
ALTER TABLE flowdesk.auto_release_gates OWNER TO flowdesk_migrator;
GRANT SELECT, INSERT, UPDATE, DELETE ON flowdesk.auto_release_gates TO flowdesk_runtime;
