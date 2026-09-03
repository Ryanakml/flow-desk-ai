-- Migration 0032: Add matched_policy_rule_id to flowdesk.routing_logs (#180 defect)
-- Supports string-identified embedded rules from automation policies without violating foreign key constraints on flowdesk.routing_rules.

ALTER TABLE flowdesk.routing_logs
  ADD COLUMN IF NOT EXISTS matched_policy_rule_id text;
