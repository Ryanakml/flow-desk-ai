-- M6 runtime repair: grant least-privilege access to developer integration tables.

GRANT SELECT, INSERT, UPDATE, DELETE ON
  flowdesk.api_keys,
  flowdesk.webhook_subscriptions
TO flowdesk_runtime;

GRANT SELECT ON
  flowdesk.api_keys,
  flowdesk.webhook_subscriptions
TO flowdesk_reporting;
