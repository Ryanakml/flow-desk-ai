# M3 operational inbox model

Migration `0010_m3_operational_inbox.sql` adds the durable routing and agent-state model used by M3. Every tenant-owned table has a non-null `organization_id`, a tenant policy, and both enabled and forced row-level security.

## Ownership and routing

- `teams` and `team_memberships` represent organizational grouping and agent capacity.
- `queues` bind an optional team, SLA policy, and business-hours policy to one routing strategy.
- `queue_memberships` are the authoritative per-user visibility boundary. A removed membership is excluded immediately by `listVisibleQueues`; browser state is never treated as authorization.
- Composite tenant foreign keys prevent a known identifier from another tenant being attached to a local record.

## Conversation operations

`conversations` gains queue/team routing, waiting reason, bot-pause state, and response/resolution deadlines. Inbox and SLA indexes support tenant-first cursor queries. Existing optimistic `version` remains the write precondition and is exercised by the M3-02 mutation API.

Private notes, tags, per-agent read markers, and saved filters live in separate normalized tables. A private note cannot enter `messages` or `outbound_intents`; its trigger records only a metadata-only `conversation.note_added` timeline event. Conversation routing, priority, waiting, and bot-pause changes also append lifecycle events.

## Lifecycle rules

- Membership rows are retained with `removed` status so authorization changes are auditable.
- Teams and queues are archived instead of deleted during ordinary operation.
- Notes remain internal records; editing records `edited_at` and deletion is not exposed to runtime workflows.
- Business-hour holiday dates and weekly schedules are policy inputs. SLA deadline calculation and pause/resume semantics are centralized in M3-02 rather than database triggers.
