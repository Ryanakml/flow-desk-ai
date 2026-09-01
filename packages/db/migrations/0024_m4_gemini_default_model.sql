-- Gemini is the recommended shared provider for M4 development. OpenAI remains selectable through
-- worker runtime configuration. Existing tenant rows are preserved; completed bot runs record the
-- actual runtime model used by the worker.
ALTER TABLE flowdesk.bot_configs
  ALTER COLUMN model SET DEFAULT 'gemini-3.7-flash';
