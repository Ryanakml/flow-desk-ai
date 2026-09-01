-- M5 #178: explicitly opt-in AUTO mode and durable bot-run to outbound linkage.

ALTER TABLE flowdesk.bot_configs DROP CONSTRAINT IF EXISTS bot_configs_mode_check;
ALTER TABLE flowdesk.bot_configs
  ADD CONSTRAINT bot_configs_mode_check CHECK (mode IN ('off', 'draft', 'auto'));

ALTER TABLE flowdesk.bot_runs DROP CONSTRAINT IF EXISTS bot_runs_mode_check;
ALTER TABLE flowdesk.bot_runs
  ADD CONSTRAINT bot_runs_mode_check CHECK (mode IN ('off', 'draft', 'auto'));

ALTER TABLE flowdesk.bot_runs DROP CONSTRAINT IF EXISTS bot_runs_operator_action_check;
ALTER TABLE flowdesk.bot_runs
  ADD CONSTRAINT bot_runs_operator_action_check
    CHECK (operator_action IN ('approved', 'edited', 'rejected', 'ignored', 'auto_sent'));

CREATE UNIQUE INDEX IF NOT EXISTS messages_one_auto_outbound_per_bot_run
  ON flowdesk.messages (organization_id, ((metadata->>'aiBotRunId')))
  WHERE direction = 'outbound' AND metadata->>'aiBotRunId' IS NOT NULL;

