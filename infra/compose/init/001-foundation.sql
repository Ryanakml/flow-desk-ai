CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS flowdesk_seed;

CREATE TABLE IF NOT EXISTS flowdesk_seed.synthetic_fixtures (
  fixture_type text PRIMARY KEY,
  fixture_id uuid NOT NULL,
  label text NOT NULL CHECK (label LIKE 'Synthetic%')
);

INSERT INTO flowdesk_seed.synthetic_fixtures (fixture_type, fixture_id, label)
VALUES
  ('organization', '00000000-0000-7000-8000-000000000001', 'Synthetic Organization'),
  ('user', '00000000-0000-7000-8000-000000000002', 'Synthetic Operator'),
  ('message', '00000000-0000-7000-8000-000000000003', 'Synthetic Message')
ON CONFLICT (fixture_type) DO NOTHING;

