-- M3-02: durable SLA response completion for every outbound agent path.

ALTER TABLE flowdesk.conversations
  ADD COLUMN first_responded_at timestamptz,
  ADD COLUMN sla_paused_at timestamptz,
  ADD COLUMN first_response_remaining_seconds integer
    CHECK (first_response_remaining_seconds IS NULL OR first_response_remaining_seconds >= 0),
  ADD COLUMN resolution_remaining_seconds integer
    CHECK (resolution_remaining_seconds IS NULL OR resolution_remaining_seconds >= 0);

CREATE OR REPLACE FUNCTION flowdesk.capture_first_agent_response() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.direction = 'outbound' AND NEW.sender_type = 'agent' THEN
    UPDATE flowdesk.conversations
    SET first_responded_at = COALESCE(first_responded_at, NEW.created_at),
        updated_at = clock_timestamp()
    WHERE organization_id = NEW.organization_id AND id = NEW.conversation_id
      AND first_responded_at IS NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER messages_capture_first_agent_response
AFTER INSERT ON flowdesk.messages
FOR EACH ROW EXECUTE FUNCTION flowdesk.capture_first_agent_response();
