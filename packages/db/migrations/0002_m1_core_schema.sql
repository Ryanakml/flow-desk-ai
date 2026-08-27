-- M1-02: additive core schema. Tenant RLS is installed by M1-03 before runtime use.
CREATE SCHEMA IF NOT EXISTS flowdesk;
ALTER SCHEMA flowdesk OWNER TO flowdesk_migrator;
GRANT USAGE ON SCHEMA flowdesk TO flowdesk_runtime, flowdesk_reporting;

CREATE TABLE flowdesk.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  timezone text NOT NULL DEFAULT 'UTC', locale text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);

CREATE TABLE flowdesk.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE flowdesk.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES flowdesk.users(id) ON DELETE RESTRICT,
  provider text NOT NULL, subject text NOT NULL, email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (provider, subject)
);

CREATE TABLE flowdesk.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_.-]{1,62}$'), label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, key)
);
CREATE INDEX roles_organization_id_idx ON flowdesk.roles (organization_id, id);

CREATE TABLE flowdesk.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES flowdesk.users(id) ON DELETE RESTRICT, role_id uuid NOT NULL REFERENCES flowdesk.roles(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  invited_at timestamptz, accepted_at timestamptz, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX memberships_organization_id_idx ON flowdesk.memberships (organization_id, status, id);
CREATE INDEX memberships_user_id_idx ON flowdesk.memberships (user_id, status, id);

CREATE TABLE flowdesk.organization_settings (
  organization_id uuid PRIMARY KEY REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb, version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE flowdesk.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES flowdesk.users(id) ON DELETE RESTRICT, action text NOT NULL, target_type text NOT NULL, target_id uuid,
  result text NOT NULL CHECK (result IN ('allowed', 'denied', 'failed')), correlation_id uuid, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX audit_logs_organization_occurred_idx ON flowdesk.audit_logs (organization_id, occurred_at DESC, id);

CREATE TABLE flowdesk.idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES flowdesk.users(id) ON DELETE RESTRICT, route text NOT NULL, key text NOT NULL,
  request_fingerprint text NOT NULL, response_status integer, response_body jsonb, completed_at timestamptz, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE (organization_id, actor_user_id, route, key)
);
CREATE INDEX idempotency_keys_expiry_idx ON flowdesk.idempotency_keys (expires_at);

CREATE TABLE flowdesk.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  aggregate_type text NOT NULL, aggregate_id uuid NOT NULL, event_type text NOT NULL, schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  payload jsonb NOT NULL, correlation_id uuid, causation_id uuid, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz, attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0), last_error text,
  CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX outbox_events_unpublished_idx ON flowdesk.outbox_events (occurred_at, id) WHERE published_at IS NULL;

ALTER TABLE flowdesk.organizations OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.users OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.identities OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.roles OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.memberships OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.organization_settings OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.audit_logs OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.idempotency_keys OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.outbox_events OWNER TO flowdesk_migrator;
