-- M6: Platform-owned Meta App onboarding through WhatsApp Embedded Signup.
-- A Meta Phone Number ID and WABA must have exactly one FlowDesk tenant owner.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM flowdesk.channels
    GROUP BY phone_number_id
    HAVING count(DISTINCT organization_id) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce global WhatsApp phone ownership: a phone_number_id is assigned to multiple organizations. Resolve duplicate channels before applying migration 0021.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM flowdesk.channels
    GROUP BY waba_id
    HAVING count(DISTINCT organization_id) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce global WABA ownership: a waba_id is assigned to multiple organizations. Resolve duplicate channels before applying migration 0021.';
  END IF;
END;
$$;

ALTER TABLE flowdesk.channels
  ADD CONSTRAINT channels_phone_number_id_global_unique UNIQUE (phone_number_id);

CREATE TABLE flowdesk.whatsapp_business_accounts (
  waba_id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO flowdesk.whatsapp_business_accounts (waba_id, organization_id)
SELECT waba_id, min(organization_id::text)::uuid
FROM flowdesk.channels
GROUP BY waba_id
ON CONFLICT (waba_id) DO NOTHING;

CREATE INDEX whatsapp_business_accounts_org_idx
  ON flowdesk.whatsapp_business_accounts (organization_id, waba_id);

ALTER TABLE flowdesk.whatsapp_business_accounts OWNER TO flowdesk_migrator;
GRANT SELECT, INSERT, UPDATE, DELETE ON flowdesk.whatsapp_business_accounts TO flowdesk_runtime;
GRANT SELECT ON flowdesk.whatsapp_business_accounts TO flowdesk_reporting;
ALTER TABLE flowdesk.whatsapp_business_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.whatsapp_business_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_business_accounts_tenant ON flowdesk.whatsapp_business_accounts
  USING (organization_id = flowdesk.current_organization_id())
  WITH CHECK (organization_id = flowdesk.current_organization_id());

CREATE TABLE flowdesk.whatsapp_embedded_signup_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  created_by_user_id uuid REFERENCES flowdesk.users(id) ON DELETE SET NULL,
  state_hash text NOT NULL UNIQUE CHECK (length(state_hash) = 64),
  status text NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated', 'processing', 'completed', 'failed', 'expired')),
  failure_code text,
  expires_at timestamptz NOT NULL,
  processing_started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX whatsapp_embedded_signup_attempts_org_status_idx
  ON flowdesk.whatsapp_embedded_signup_attempts (organization_id, status, expires_at DESC);

ALTER TABLE flowdesk.whatsapp_embedded_signup_attempts OWNER TO flowdesk_migrator;
GRANT SELECT, INSERT, UPDATE, DELETE ON flowdesk.whatsapp_embedded_signup_attempts TO flowdesk_runtime;
ALTER TABLE flowdesk.whatsapp_embedded_signup_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.whatsapp_embedded_signup_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_embedded_signup_attempts_tenant
  ON flowdesk.whatsapp_embedded_signup_attempts
  USING (organization_id = flowdesk.current_organization_id())
  WITH CHECK (organization_id = flowdesk.current_organization_id());
