-- M5 #179: Fast monthly AI cost aggregation index on bot_runs

CREATE INDEX IF NOT EXISTS idx_bot_runs_org_created_at_cost
    ON flowdesk.bot_runs (organization_id, created_at DESC)
    INCLUDE (cost_estimate_microcents);
