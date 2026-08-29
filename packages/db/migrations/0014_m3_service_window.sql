-- 0014_m3_service_window.sql
-- M3-05: 24-hour service window eligibility and template rendering (TPL-ELIG-001)

-- 1. Add last_inbound_at to flowdesk.conversations
ALTER TABLE flowdesk.conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;

-- 2. Backfill last_inbound_at from existing customer inbound messages
UPDATE flowdesk.conversations c
SET last_inbound_at = (
  SELECT MAX(m.sent_at)
  FROM flowdesk.messages m
  WHERE m.conversation_id = c.id
    AND m.direction = 'inbound'
    AND m.sender_type = 'customer'
)
WHERE c.last_inbound_at IS NULL;

-- 3. Create index for fast window querying and sorting
CREATE INDEX IF NOT EXISTS conversations_org_last_inbound_idx
  ON flowdesk.conversations (organization_id, last_inbound_at DESC NULLS LAST);
