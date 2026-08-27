-- M1-04: FlowDesk-managed opaque sessions and one-time OIDC authorization transactions.
CREATE TABLE flowdesk.auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES flowdesk.users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
  revoked_at timestamptz, rotated_from_id uuid REFERENCES flowdesk.auth_sessions(id) ON DELETE RESTRICT,
  user_agent_hash text, ip_hash text, CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_user_active_idx ON flowdesk.auth_sessions (user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE flowdesk.oidc_authorization_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), state_hash text NOT NULL UNIQUE, nonce_hash text NOT NULL,
  code_verifier_hash text NOT NULL, return_to text NOT NULL DEFAULT '/', expires_at timestamptz NOT NULL,
  consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK (expires_at > created_at)
);
CREATE INDEX oidc_authorization_transactions_expiry_idx ON flowdesk.oidc_authorization_transactions (expires_at);
ALTER TABLE flowdesk.auth_sessions OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.oidc_authorization_transactions OWNER TO flowdesk_migrator;
GRANT SELECT, INSERT, UPDATE, DELETE ON flowdesk.auth_sessions, flowdesk.oidc_authorization_transactions TO flowdesk_runtime;
GRANT SELECT ON flowdesk.auth_sessions, flowdesk.oidc_authorization_transactions TO flowdesk_reporting;
