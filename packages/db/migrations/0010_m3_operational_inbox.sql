-- M3-01: tenant-isolated operational inbox model.

CREATE TABLE flowdesk.business_hours_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  timezone text NOT NULL,
  weekly_schedule jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(weekly_schedule) = 'object'),
  holiday_dates date[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, name),
  UNIQUE (organization_id, id)
);

CREATE TABLE flowdesk.sla_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  first_response_seconds integer NOT NULL CHECK (first_response_seconds > 0),
  resolution_seconds integer NOT NULL CHECK (resolution_seconds > 0),
  pause_while_waiting boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, name),
  UNIQUE (organization_id, id)
);

CREATE TABLE flowdesk.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, slug),
  UNIQUE (organization_id, id)
);

CREATE TABLE flowdesk.team_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  team_id uuid NOT NULL,
  user_id uuid NOT NULL,
  capacity integer NOT NULL DEFAULT 10 CHECK (capacity BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  removed_at timestamptz,
  FOREIGN KEY (organization_id, team_id) REFERENCES flowdesk.teams(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES flowdesk.memberships(organization_id, user_id) ON DELETE RESTRICT,
  UNIQUE (organization_id, team_id, user_id)
);

CREATE TABLE flowdesk.queues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  team_id uuid,
  business_hours_policy_id uuid,
  sla_policy_id uuid,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  routing_strategy text NOT NULL DEFAULT 'manual'
    CHECK (routing_strategy IN ('manual', 'round_robin', 'least_loaded')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, team_id) REFERENCES flowdesk.teams(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, business_hours_policy_id)
    REFERENCES flowdesk.business_hours_policies(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, sla_policy_id)
    REFERENCES flowdesk.sla_policies(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, slug),
  UNIQUE (organization_id, id)
);

CREATE TABLE flowdesk.queue_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  queue_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'agent' CHECK (role IN ('agent', 'supervisor')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  removed_at timestamptz,
  FOREIGN KEY (organization_id, queue_id) REFERENCES flowdesk.queues(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES flowdesk.memberships(organization_id, user_id) ON DELETE RESTRICT,
  UNIQUE (organization_id, queue_id, user_id)
);

CREATE TABLE flowdesk.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
  color text NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, name),
  UNIQUE (organization_id, id)
);

ALTER TABLE flowdesk.conversations
  ADD COLUMN queue_id uuid,
  ADD COLUMN team_id uuid,
  ADD COLUMN waiting_reason text,
  ADD COLUMN bot_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN first_response_due_at timestamptz,
  ADD COLUMN resolution_due_at timestamptz,
  ADD COLUMN resolved_at timestamptz,
  ADD CONSTRAINT conversations_org_id_unique UNIQUE (organization_id, id),
  ADD CONSTRAINT conversations_queue_fk FOREIGN KEY (organization_id, queue_id)
    REFERENCES flowdesk.queues(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT conversations_team_fk FOREIGN KEY (organization_id, team_id)
    REFERENCES flowdesk.teams(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT conversations_waiting_reason_length
    CHECK (waiting_reason IS NULL OR length(waiting_reason) BETWEEN 1 AND 500),
  ADD CONSTRAINT conversations_resolved_at_state
    CHECK (resolved_at IS NULL OR status IN ('resolved', 'closed'));

ALTER TABLE flowdesk.messages
  ADD CONSTRAINT messages_org_id_unique UNIQUE (organization_id, id);

CREATE TABLE flowdesk.conversation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  edited_at timestamptz,
  FOREIGN KEY (organization_id, conversation_id)
    REFERENCES flowdesk.conversations(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, author_user_id)
    REFERENCES flowdesk.memberships(organization_id, user_id) ON DELETE RESTRICT
);

CREATE TABLE flowdesk.conversation_tags (
  organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  added_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, conversation_id, tag_id),
  FOREIGN KEY (organization_id, conversation_id)
    REFERENCES flowdesk.conversations(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, tag_id)
    REFERENCES flowdesk.tags(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, added_by_user_id)
    REFERENCES flowdesk.memberships(organization_id, user_id) ON DELETE RESTRICT
);

CREATE TABLE flowdesk.conversation_read_markers (
  organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  last_read_message_id uuid,
  last_read_at timestamptz,
  marked_unread boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, conversation_id, user_id),
  FOREIGN KEY (organization_id, conversation_id)
    REFERENCES flowdesk.conversations(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id)
    REFERENCES flowdesk.memberships(organization_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, last_read_message_id)
    REFERENCES flowdesk.messages(organization_id, id) ON DELETE SET NULL (last_read_message_id)
);

CREATE TABLE flowdesk.saved_filters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, user_id)
    REFERENCES flowdesk.memberships(organization_id, user_id) ON DELETE CASCADE,
  UNIQUE (organization_id, user_id, name)
);

CREATE UNIQUE INDEX saved_filters_one_default_idx
  ON flowdesk.saved_filters (organization_id, user_id) WHERE is_default;
CREATE INDEX team_memberships_user_active_idx
  ON flowdesk.team_memberships (organization_id, user_id, team_id) WHERE status = 'active';
CREATE INDEX queue_memberships_user_active_idx
  ON flowdesk.queue_memberships (organization_id, user_id, queue_id) WHERE status = 'active';
CREATE INDEX queues_team_active_idx
  ON flowdesk.queues (organization_id, team_id, id) WHERE status = 'active';
CREATE INDEX conversations_inbox_queue_idx
  ON flowdesk.conversations (organization_id, queue_id, status, priority, last_message_at DESC, id DESC);
CREATE INDEX conversations_inbox_team_idx
  ON flowdesk.conversations (organization_id, team_id, status, last_message_at DESC, id DESC);
CREATE INDEX conversations_sla_due_idx
  ON flowdesk.conversations (organization_id, resolution_due_at, id)
  WHERE status NOT IN ('resolved', 'closed') AND resolution_due_at IS NOT NULL;
CREATE INDEX conversation_notes_timeline_idx
  ON flowdesk.conversation_notes (organization_id, conversation_id, created_at, id);
CREATE INDEX conversation_tags_tag_idx
  ON flowdesk.conversation_tags (organization_id, tag_id, conversation_id);
CREATE INDEX conversation_read_markers_user_idx
  ON flowdesk.conversation_read_markers (organization_id, user_id, marked_unread, updated_at DESC);

CREATE OR REPLACE FUNCTION flowdesk.capture_m3_conversation_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.queue_id IS DISTINCT FROM OLD.queue_id THEN
    INSERT INTO flowdesk.conversation_events (organization_id, conversation_id, event_type, payload)
    VALUES (NEW.organization_id, NEW.id, 'conversation.queue_changed',
            jsonb_build_object('from', OLD.queue_id, 'to', NEW.queue_id));
  END IF;
  IF NEW.team_id IS DISTINCT FROM OLD.team_id THEN
    INSERT INTO flowdesk.conversation_events (organization_id, conversation_id, event_type, payload)
    VALUES (NEW.organization_id, NEW.id, 'conversation.team_changed',
            jsonb_build_object('from', OLD.team_id, 'to', NEW.team_id));
  END IF;
  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    INSERT INTO flowdesk.conversation_events (organization_id, conversation_id, event_type, payload)
    VALUES (NEW.organization_id, NEW.id, 'conversation.priority_changed',
            jsonb_build_object('from', OLD.priority, 'to', NEW.priority));
  END IF;
  IF NEW.waiting_reason IS DISTINCT FROM OLD.waiting_reason THEN
    INSERT INTO flowdesk.conversation_events (organization_id, conversation_id, event_type, payload)
    VALUES (NEW.organization_id, NEW.id, 'conversation.waiting_changed',
            jsonb_build_object('from', OLD.waiting_reason, 'to', NEW.waiting_reason));
  END IF;
  IF NEW.bot_paused IS DISTINCT FROM OLD.bot_paused THEN
    INSERT INTO flowdesk.conversation_events (organization_id, conversation_id, event_type, payload)
    VALUES (NEW.organization_id, NEW.id, 'conversation.bot_pause_changed',
            jsonb_build_object('paused', NEW.bot_paused));
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER conversations_capture_m3_lifecycle
AFTER UPDATE OF queue_id, team_id, priority, waiting_reason, bot_paused ON flowdesk.conversations
FOR EACH ROW EXECUTE FUNCTION flowdesk.capture_m3_conversation_lifecycle();

CREATE OR REPLACE FUNCTION flowdesk.capture_conversation_note() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO flowdesk.conversation_events
    (organization_id, conversation_id, event_type, actor_user_id, payload)
  VALUES (NEW.organization_id, NEW.conversation_id, 'conversation.note_added',
          NEW.author_user_id, jsonb_build_object('note_id', NEW.id));
  RETURN NEW;
END $$;

CREATE TRIGGER conversation_notes_capture_lifecycle
AFTER INSERT ON flowdesk.conversation_notes
FOR EACH ROW EXECUTE FUNCTION flowdesk.capture_conversation_note();

ALTER TABLE flowdesk.business_hours_policies OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.sla_policies OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.teams OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.team_memberships OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.queues OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.queue_memberships OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.tags OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.conversation_notes OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.conversation_tags OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.conversation_read_markers OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.saved_filters OWNER TO flowdesk_migrator;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  flowdesk.business_hours_policies, flowdesk.sla_policies,
  flowdesk.teams, flowdesk.team_memberships, flowdesk.queues, flowdesk.queue_memberships,
  flowdesk.tags, flowdesk.conversation_notes, flowdesk.conversation_tags,
  flowdesk.conversation_read_markers, flowdesk.saved_filters
TO flowdesk_runtime;
GRANT SELECT ON
  flowdesk.business_hours_policies, flowdesk.sla_policies,
  flowdesk.teams, flowdesk.team_memberships, flowdesk.queues, flowdesk.queue_memberships,
  flowdesk.tags, flowdesk.conversation_notes, flowdesk.conversation_tags,
  flowdesk.conversation_read_markers, flowdesk.saved_filters
TO flowdesk_reporting;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'business_hours_policies', 'sla_policies', 'teams', 'team_memberships',
    'queues', 'queue_memberships', 'tags', 'conversation_notes',
    'conversation_tags', 'conversation_read_markers', 'saved_filters'
  ] LOOP
    EXECUTE format('ALTER TABLE flowdesk.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE flowdesk.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON flowdesk.%I USING (organization_id = flowdesk.current_organization_id()) WITH CHECK (organization_id = flowdesk.current_organization_id())',
      table_name || '_tenant', table_name
    );
  END LOOP;
END $$;
